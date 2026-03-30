using System.Text;
using MovieCrawler.Backend;

var builder = WebApplication.CreateBuilder(args);

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

builder.Services.AddSingleton<CatalogParser>();
builder.Services.AddSingleton<CatalogCache>();
builder.Services.AddSingleton<DirectoryDownloadResolver>();
builder.Services.AddHostedService<CatalogWarmupService>();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddHttpClient("catalog", client =>
{
    client.Timeout = TimeSpan.FromSeconds(30);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("MovieCrawler/1.0");
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("frontend", policy =>
    {
        policy.AllowAnyOrigin()
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

app.UseCors("frontend");

app.MapGet("/api/catalog", (CatalogCache cache, string? q, string? type, string? sort, string? order) =>
{
    var catalog = cache.Current;
    if (catalog is null)
    {
        return Results.Problem(
            detail: cache.LastError ?? "Catalog not loaded yet.",
            statusCode: StatusCodes.Status503ServiceUnavailable,
            title: "Catalog unavailable",
            extensions: new Dictionary<string, object?>
            {
                ["sourceUrl"] = cache.SourceUrl
            });
    }

    IEnumerable<CatalogItem> items = catalog.Items;

    if (!string.IsNullOrWhiteSpace(q))
    {
        items = items.Where(item => item.Title.Contains(q, StringComparison.OrdinalIgnoreCase));
    }

    if (!string.IsNullOrWhiteSpace(type) && !type.Equals("all", StringComparison.OrdinalIgnoreCase))
    {
        items = type.Equals("tvSeries", StringComparison.OrdinalIgnoreCase)
            ? items.Where(item => item.Type == TitleType.TvSeries)
            : items.Where(item => item.Type == TitleType.Movie);
    }

    var sortKey = string.IsNullOrWhiteSpace(sort) ? "rate" : sort;
    var ascending = string.Equals(order, "asc", StringComparison.OrdinalIgnoreCase);
    if (sortKey.Equals("rate", StringComparison.OrdinalIgnoreCase))
    {
        items = ascending
            ? items.OrderBy(item => item.ImdbRate)
            : items.OrderByDescending(item => item.ImdbRate);
    }
    else if (sortKey.Equals("votes", StringComparison.OrdinalIgnoreCase))
    {
        items = ascending
            ? items.OrderBy(item => item.ImdbVotes)
            : items.OrderByDescending(item => item.ImdbVotes);
    }
    else if (sortKey.Equals("date", StringComparison.OrdinalIgnoreCase) || sortKey.Equals("year", StringComparison.OrdinalIgnoreCase))
    {
        items = ascending
            ? items.OrderBy(item => item.Year ?? 0)
            : items.OrderByDescending(item => item.Year ?? 0);
    }

    var itemList = items.ToList();
    var meta = new CatalogMeta
    {
        FetchedAt = catalog.Meta.FetchedAt,
        SourceUrl = catalog.Meta.SourceUrl,
        ItemCount = itemList.Count
    };

    return Results.Ok(new Catalog
    {
        Meta = meta,
        Items = itemList
    });
});

app.MapPost("/api/catalog/reload", async (CatalogCache cache, CancellationToken cancellationToken) =>
{
    var success = await cache.ReloadAsync(cancellationToken).ConfigureAwait(false);
    var catalog = cache.Current;
    if (!success || catalog is null)
    {
        return Results.Problem(
            detail: cache.LastError ?? "Reload failed.",
            statusCode: StatusCodes.Status500InternalServerError,
            title: "Reload failed",
            extensions: new Dictionary<string, object?>
            {
                ["sourceUrl"] = cache.SourceUrl
            });
    }

    return Results.Ok(new
    {
        meta = catalog.Meta,
        status = "reloaded"
    });
});

app.MapGet("/api/catalog/status", (CatalogCache cache) =>
{
    return Results.Ok(new
    {
        hasCatalog = cache.Current is not null,
        lastError = cache.LastError,
        fetch = cache.LastFetchInfo
    });
});

app.MapPost("/api/download-links/resolve", async (
    ResolveDownloadLinksRequest? request,
    DirectoryDownloadResolver resolver,
    CancellationToken cancellationToken) =>
{
    var urls = (request?.Urls ?? [])
        .Where(url => !string.IsNullOrWhiteSpace(url))
        .Select(url => url.Trim())
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToList();

    if (urls.Count == 0)
    {
        return Results.BadRequest(new
        {
            error = "At least one URL is required."
        });
    }

    var results = await resolver.ResolveAsync(urls, cancellationToken).ConfigureAwait(false);
    return Results.Ok(new ResolveDownloadLinksResponse
    {
        Results = results
    });
});

app.Run();
