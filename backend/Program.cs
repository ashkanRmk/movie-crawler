using System.Net;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using MovieCrawler.Backend;

var builder = WebApplication.CreateBuilder(args);

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? "Host=localhost;Port=5432;Database=3kans;Username=myuser;Password=mypassword";

builder.Services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connectionString));
builder.Services.AddSingleton<CatalogParser>();
builder.Services.AddSingleton<CatalogSnapshotCache>();
builder.Services.AddSingleton<TvSeriesDirectoryLinksCache>();
builder.Services.AddSingleton<IDirectoryDownloadResolver, DirectoryDownloadResolver>();
builder.Services.AddScoped<CatalogProjectionService>();
builder.Services.AddScoped<CatalogSyncService>();
builder.Services.AddScoped<CatalogQueryService>();
builder.Services.AddScoped<GenreCatalogService>();
builder.Services.AddScoped<DownloadLinksResolveService>();
builder.Services.AddSingleton<JwtTokenService>();

builder.Services.AddHttpClient("catalog", client =>
{
    client.Timeout = TimeSpan.FromSeconds(30);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("MovieCrawler/1.0");
})
.ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
{
    MaxConnectionsPerServer = 64,
    PooledConnectionLifetime = TimeSpan.FromMinutes(10),
    PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2),
    AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli
});

var authIssuer = builder.Configuration["Auth:Issuer"] ?? "movie-crawler";
var authAudience = builder.Configuration["Auth:Audience"] ?? "movie-crawler-client";
var authSecret = builder.Configuration["Auth:JwtKey"] ?? "CHANGE_ME_TO_LONG_RANDOM_SECRET_FOR_PRODUCTION";
var authKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(authSecret));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = authIssuer,
            ValidAudience = authAudience,
            IssuerSigningKey = authKey,
            ClockSkew = TimeSpan.FromMinutes(2)
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddCors(options =>
{
    options.AddPolicy("frontend", policy =>
    {
        policy.AllowAnyOrigin()
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

app.UseCors("frontend");
app.UseAuthentication();
app.UseAuthorization();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();

    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
    try
    {
        var syncService = scope.ServiceProvider.GetRequiredService<CatalogSyncService>();
        var (_, fetchInfo) = await syncService.SyncAsync(CancellationToken.None);
        logger.LogInformation("Startup sync completed. fetchedAt={FetchedAt}", fetchInfo.FetchedAt);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Startup sync failed.");
    }
}

app.MapGet("/api/catalog", async (
    CatalogQueryService queryService,
    CatalogSnapshotCache snapshotCache,
    string? q,
    string? type,
    string? sort,
    string? order,
    CancellationToken cancellationToken) =>
{
    var catalog = await queryService.GetCatalogAsync(cancellationToken).ConfigureAwait(false);
    if (catalog is null)
    {
        return Results.Problem(
            detail: snapshotCache.LastError ?? "Catalog not loaded yet.",
            statusCode: StatusCodes.Status503ServiceUnavailable,
            title: "Catalog unavailable",
            extensions: new Dictionary<string, object?>
            {
                ["sourceUrl"] = snapshotCache.LastFetchInfo?.SourceUrl
            });
    }

    IEnumerable<CatalogItem> items = catalog.Items;

    if (!string.IsNullOrWhiteSpace(q))
    {
        var needle = q.Trim();
        items = items.Where(item => MatchesQuery(item, needle));
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
        items = ascending ? items.OrderBy(item => item.ImdbRate) : items.OrderByDescending(item => item.ImdbRate);
    }
    else if (sortKey.Equals("votes", StringComparison.OrdinalIgnoreCase))
    {
        items = ascending ? items.OrderBy(item => item.ImdbVotes) : items.OrderByDescending(item => item.ImdbVotes);
    }
    else if (sortKey.Equals("date", StringComparison.OrdinalIgnoreCase) || sortKey.Equals("year", StringComparison.OrdinalIgnoreCase))
    {
        items = ascending ? items.OrderBy(item => item.Year ?? 0) : items.OrderByDescending(item => item.Year ?? 0);
    }

    var list = items.ToList();

    return Results.Ok(new Catalog
    {
        Meta = new CatalogMeta
        {
            FetchedAt = catalog.Meta.FetchedAt,
            SourceUrl = catalog.Meta.SourceUrl,
            ItemCount = list.Count
        },
        Items = list
    });
});

app.MapGet("/api/catalog/{imdbCode}", async (
    string imdbCode,
    CatalogQueryService queryService,
    CancellationToken cancellationToken) =>
{
    var item = await queryService.GetTitleByImdbCodeAsync(imdbCode, cancellationToken).ConfigureAwait(false);
    return item is null ? Results.NotFound() : Results.Ok(item);
});

app.MapPost("/api/catalog/reload", async (
    CatalogSyncService syncService,
    TvSeriesDirectoryLinksCache directoryLinksCache,
    CancellationToken cancellationToken) =>
{
    var (result, _) = await syncService.SyncAsync(cancellationToken).ConfigureAwait(false);
    directoryLinksCache.Clear();

    return Results.Ok(new
    {
        status = "reloaded",
        result.Inserted,
        result.Updated,
        result.Unchanged,
        result.SyncedAt
    });
});

app.MapGet("/api/catalog/status", async (
    AppDbContext db,
    CatalogSnapshotCache snapshotCache,
    CancellationToken cancellationToken) =>
{
    var syncState = await db.CatalogSyncStates.AsNoTracking().FirstOrDefaultAsync(x => x.Id == 1, cancellationToken).ConfigureAwait(false);

    return Results.Ok(new
    {
        hasCatalog = snapshotCache.Current is not null,
        lastError = snapshotCache.LastError,
        fetch = snapshotCache.LastFetchInfo,
        sync = syncState is null ? null : new
        {
            syncState.LastSyncedAt,
            syncState.SourceUrl,
            syncState.LastError
        }
    });
});

app.MapPost("/api/auth/register", async (
    RegisterRequest request,
    AppDbContext db,
    JwtTokenService tokenService,
    CancellationToken cancellationToken) =>
{
    var mobile = NormalizeMobile(request.Mobile);
    var password = request.Password?.Trim() ?? string.Empty;

    if (string.IsNullOrWhiteSpace(mobile) || mobile.Length < 8 || password.Length < 6)
    {
        return Results.BadRequest(new { error = "Mobile or password is invalid." });
    }

    var exists = await db.Users.AnyAsync(x => x.Mobile == mobile, cancellationToken).ConfigureAwait(false);
    if (exists)
    {
        return Results.Conflict(new { error = "Mobile already registered." });
    }

    var now = DateTimeOffset.UtcNow;
    var user = new UserEntity
    {
        Mobile = mobile,
        PasswordHash = PasswordHasher.Hash(password),
        Subscription = 0,
        SubscriptionExpiresAt = null,
        CreatedAt = now,
        UpdatedAt = now
    };

    db.Users.Add(user);
    await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

    var token = tokenService.Issue(user);
    return Results.Ok(ToAuthResponse(user, token));
});

app.MapPost("/api/auth/login", async (
    LoginRequest request,
    AppDbContext db,
    JwtTokenService tokenService,
    CancellationToken cancellationToken) =>
{
    var mobile = NormalizeMobile(request.Mobile);
    var password = request.Password?.Trim() ?? string.Empty;

    var user = await db.Users.FirstOrDefaultAsync(x => x.Mobile == mobile, cancellationToken).ConfigureAwait(false);
    if (user is null || !PasswordHasher.Verify(password, user.PasswordHash))
    {
        return Results.Unauthorized();
    }

    var token = tokenService.Issue(user);
    return Results.Ok(ToAuthResponse(user, token));
});

app.MapGet("/api/auth/me", async (
    ClaimsPrincipal principal,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = principal.GetUserId();
    if (userId is null)
    {
        return Results.Unauthorized();
    }

    var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId, cancellationToken).ConfigureAwait(false);
    if (user is null)
    {
        return Results.Unauthorized();
    }

    return Results.Ok(ToUserProfile(user));
}).RequireAuthorization();

app.MapPost("/api/auth/change-password", async (
    ClaimsPrincipal principal,
    ChangePasswordRequest request,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = principal.GetUserId();
    if (userId is null)
    {
        return Results.Unauthorized();
    }

    var user = await db.Users.FirstOrDefaultAsync(x => x.Id == userId, cancellationToken).ConfigureAwait(false);
    if (user is null)
    {
        return Results.Unauthorized();
    }

    var newPassword = request.NewPassword?.Trim() ?? string.Empty;
    if (!PasswordHasher.Verify(request.CurrentPassword?.Trim() ?? string.Empty, user.PasswordHash))
    {
        return Results.BadRequest(new { error = "Current password is invalid." });
    }

    if (newPassword.Length < 6)
    {
        return Results.BadRequest(new { error = "New password is too short." });
    }

    user.PasswordHash = PasswordHasher.Hash(newPassword);
    user.UpdatedAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

    return Results.Ok(new { status = "password_changed" });
}).RequireAuthorization();

app.MapGet("/api/subscriptions/plans", async (AppDbContext db, IConfiguration configuration, CancellationToken cancellationToken) =>
{
    var oneMonthUrl = configuration["Payments:OneMonthUrl"] ?? "https://payping.ir/p/@rahmani/uxch4";
    var threeMonthUrl = configuration["Payments:ThreeMonthUrl"] ?? "https://payping.ir/p/@rahmani/sdfsdf";

    var plans = await db.SubscriptionPlans
        .AsNoTracking()
        .Where(x => x.IsActive)
        .OrderBy(x => x.DurationMonths)
        .Select(x => new SubscriptionPlanDto
        {
            Code = x.Code,
            Title = x.Title,
            DurationMonths = x.DurationMonths,
            PriceToman = x.PriceToman,
            PaymentUrl = x.Code == "three_month" ? threeMonthUrl : oneMonthUrl
        })
        .ToListAsync(cancellationToken)
        .ConfigureAwait(false);

    return Results.Ok(plans);
});

app.MapGet("/api/genres", async (
    GenreCatalogService genreService,
    string? type,
    CancellationToken cancellationToken) =>
{
    TitleType? titleType = null;
    if (!string.IsNullOrWhiteSpace(type))
    {
        titleType = type.Equals("tvSeries", StringComparison.OrdinalIgnoreCase)
            ? TitleType.TvSeries
            : TitleType.Movie;
    }

    var genres = await genreService.GetGenresAsync(titleType, cancellationToken).ConfigureAwait(false);
    return Results.Ok(genres);
});

app.MapPost("/api/download-links/resolve", async (
    ResolveDownloadLinksRequest? request,
    ClaimsPrincipal principal,
    AppDbContext db,
    DownloadLinksResolveService resolveService,
    CancellationToken cancellationToken) =>
{
    var userId = principal.GetUserId();
    if (userId is null)
    {
        return Results.Unauthorized();
    }

    var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId, cancellationToken).ConfigureAwait(false);
    if (user is null)
    {
        return Results.Unauthorized();
    }

    if (!HasActiveSubscription(user))
    {
        return Results.Forbid();
    }

    if ((request?.Urls ?? []).All(url => string.IsNullOrWhiteSpace(url)))
    {
        return Results.BadRequest(new
        {
            error = "At least one URL is required."
        });
    }

    var response = await resolveService.ResolveAsync(request, cancellationToken).ConfigureAwait(false);
    return Results.Ok(response);
}).RequireAuthorization();

app.Run();

static string NormalizeMobile(string? mobile)
{
    if (string.IsNullOrWhiteSpace(mobile))
    {
        return string.Empty;
    }

    var chars = mobile.Where(char.IsDigit).ToArray();
    return new string(chars);
}

static bool MatchesQuery(CatalogItem item, string needle)
{
    if (item.Title.Contains(needle, StringComparison.OrdinalIgnoreCase))
    {
        return true;
    }

    if (!string.IsNullOrWhiteSpace(item.CountryOrigin) && item.CountryOrigin.Contains(needle, StringComparison.OrdinalIgnoreCase))
    {
        return true;
    }

    if (!string.IsNullOrWhiteSpace(item.Duration) && item.Duration.Contains(needle, StringComparison.OrdinalIgnoreCase))
    {
        return true;
    }

    if (!string.IsNullOrWhiteSpace(item.AgeRating) && item.AgeRating.Contains(needle, StringComparison.OrdinalIgnoreCase))
    {
        return true;
    }

    if (!string.IsNullOrWhiteSpace(item.Summary) && item.Summary.Contains(needle, StringComparison.OrdinalIgnoreCase))
    {
        return true;
    }

    return item.Genres.Any(value => value.Contains(needle, StringComparison.OrdinalIgnoreCase))
        || item.Stars.Any(value => value.Contains(needle, StringComparison.OrdinalIgnoreCase));
}

static AuthResponse ToAuthResponse(UserEntity user, TokenIssueResult token)
{
    return new AuthResponse
    {
        Token = token.Token,
        ExpiresAt = token.ExpiresAt,
        User = ToUserProfile(user)
    };
}

static UserProfileDto ToUserProfile(UserEntity user)
{
    var now = DateTimeOffset.UtcNow;
    var hasActive = HasActiveSubscription(user, now);
    var remainingSeconds = hasActive && user.SubscriptionExpiresAt is not null
        ? Math.Max(0, (long)Math.Floor((user.SubscriptionExpiresAt.Value - now).TotalSeconds))
        : 0;

    return new UserProfileDto
    {
        Id = user.Id,
        Mobile = user.Mobile,
        Subscription = user.Subscription,
        SubscriptionExpiresAt = user.SubscriptionExpiresAt,
        HasActiveSubscription = hasActive,
        RemainingSeconds = remainingSeconds
    };
}

static bool HasActiveSubscription(UserEntity user, DateTimeOffset? now = null)
{
    if (user.Subscription is not 1 and not 3)
    {
        return false;
    }

    if (user.SubscriptionExpiresAt is null)
    {
        return false;
    }

    var current = now ?? DateTimeOffset.UtcNow;
    return user.SubscriptionExpiresAt.Value > current;
}
