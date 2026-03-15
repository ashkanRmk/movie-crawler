using System.Text;
using MovieCrawler.Backend;

var builder = WebApplication.CreateBuilder(args);

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

builder.Services.AddSingleton<CatalogParser>();
builder.Services.AddSingleton<CatalogCache>();
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
        policy.WithOrigins("http://localhost:5173")
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
    if (sortKey.Equals("rate", StringComparison.OrdinalIgnoreCase))
    {
        items = string.Equals(order, "asc", StringComparison.OrdinalIgnoreCase)
            ? items.OrderBy(item => item.ImdbRate)
            : items.OrderByDescending(item => item.ImdbRate);
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

app.Run();
