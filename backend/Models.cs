using System.Text.Json.Serialization;

namespace MovieCrawler.Backend;

public sealed record Catalog
{
    public required CatalogMeta Meta { get; init; }
    public required List<CatalogItem> Items { get; init; }
}

public sealed record CatalogMeta
{
    public required DateTimeOffset FetchedAt { get; init; }
    public required string SourceUrl { get; init; }
    public required int ItemCount { get; init; }
}

public sealed record CatalogFetchInfo
{
    public DateTimeOffset? FetchedAt { get; init; }
    public string? SourceUrl { get; init; }
    public string? ContentType { get; init; }
    public int? ContentLength { get; init; }
    public string? Snippet { get; init; }
}

public sealed record CatalogItem
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public int? Year { get; init; }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public required TitleType Type { get; init; }

    public required string ImdbCode { get; init; }
    public required double ImdbRate { get; init; }
    public required int ImdbVotes { get; init; }
    public bool IsDubbed { get; init; }

    public string? Summary { get; init; }
    public string? Duration { get; init; }
    public string? CountryOrigin { get; init; }
    public List<string> Genres { get; init; } = [];
    public List<string> Stars { get; init; } = [];
    public string? AgeRating { get; init; }
    public string? PosterUrl { get; init; }
    public string? CoverUrl { get; init; }

    public List<DownloadGroup> Downloads { get; init; } = [];
    public List<SeasonGroup> Seasons { get; init; } = [];
}

public enum TitleType
{
    Movie,
    TvSeries
}

public sealed record DownloadGroup
{
    public required string Label { get; init; }
    public List<DownloadLink> Links { get; init; } = [];
}

public sealed record SeasonGroup
{
    public required int SeasonNumber { get; init; }
    public List<DownloadGroup> Groups { get; init; } = [];
}

public sealed record DownloadLink
{
    public required string Label { get; init; }
    public required string Url { get; init; }
    public string? Size { get; init; }
    public string? ParentGroupName { get; init; }
    public int? SeasonNumber { get; init; }
    public int? EpisodeNumber { get; init; }
}

public sealed record ResolveDownloadLinksRequest
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public TitleType? TitleType { get; init; }

    public List<string> Urls { get; init; } = [];
}

public sealed record ResolveDownloadLinksResponse
{
    public required List<ResolvedDirectoryLinks> Results { get; init; }
}

public sealed record ResolvedDirectoryLinks
{
    public required string Url { get; init; }
    public List<DownloadLink> Links { get; init; } = [];
    public string? Error { get; init; }
}

public sealed record RegisterRequest
{
    public string Mobile { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
}

public sealed record LoginRequest
{
    public string Mobile { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
}

public sealed record ChangePasswordRequest
{
    public string CurrentPassword { get; init; } = string.Empty;
    public string NewPassword { get; init; } = string.Empty;
}

public sealed record AuthResponse
{
    public required string Token { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
    public required UserProfileDto User { get; init; }
}

public sealed record UserProfileDto
{
    public required int Id { get; init; }
    public required string Mobile { get; init; }
    public required int Subscription { get; init; }
    public DateTimeOffset? SubscriptionExpiresAt { get; init; }
    public required bool HasActiveSubscription { get; init; }
    public required long RemainingSeconds { get; init; }
}

public sealed record SubscriptionPlanDto
{
    public required string Code { get; init; }
    public required string Title { get; init; }
    public required int DurationMonths { get; init; }
    public required int PriceToman { get; init; }
    public required string PaymentUrl { get; init; }
}

public sealed record GenreDto
{
    public required string Id { get; init; }
    public required string Label { get; init; }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public required TitleType TitleType { get; init; }

    public required int Count { get; init; }
}

public sealed record CatalogSyncResult
{
    public required int Inserted { get; init; }
    public required int Updated { get; init; }
    public required int Unchanged { get; init; }
    public required DateTimeOffset SyncedAt { get; init; }
}

public sealed record TokenIssueResult
{
    public required string Token { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
}
