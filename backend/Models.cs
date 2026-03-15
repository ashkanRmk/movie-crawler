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
}
