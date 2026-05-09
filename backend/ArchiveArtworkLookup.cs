using System.Text.Json;
using System.Text.Json.Serialization;

namespace MovieCrawler.Backend;

public sealed class ArchiveArtworkLookup
{
    private readonly string _archivePath;
    private readonly ILogger<ArchiveArtworkLookup>? _logger;
    private readonly Lazy<IReadOnlyDictionary<string, string>> _artworkByImdbId;

    public ArchiveArtworkLookup(IHostEnvironment environment, ILogger<ArchiveArtworkLookup> logger)
        : this(Path.Combine(environment.ContentRootPath, "donyaye_serial_archive.json"), logger)
    {
    }

    public ArchiveArtworkLookup(string archivePath, ILogger<ArchiveArtworkLookup>? logger = null)
    {
        _archivePath = archivePath;
        _logger = logger;
        _artworkByImdbId = new Lazy<IReadOnlyDictionary<string, string>>(LoadArtwork, LazyThreadSafetyMode.ExecutionAndPublication);
    }

    public string? FindImageUrl(string imdbId)
    {
        if (string.IsNullOrWhiteSpace(imdbId))
        {
            return null;
        }

        return _artworkByImdbId.Value.TryGetValue(imdbId.Trim(), out var imageUrl)
            ? imageUrl
            : null;
    }

    public Catalog Enrich(Catalog catalog)
    {
        return catalog with
        {
            Items = catalog.Items
                .Select(item => item with { ImageUrl = FindImageUrl(item.ImdbCode) })
                .ToList()
        };
    }

    private IReadOnlyDictionary<string, string> LoadArtwork()
    {
        if (!File.Exists(_archivePath))
        {
            _logger?.LogWarning("Artwork archive file was not found at {ArchivePath}", _archivePath);
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }

        try
        {
            using var stream = File.OpenRead(_archivePath);
            var entries = JsonSerializer.Deserialize<List<ArchiveArtworkEntry>>(stream) ?? [];
            var lookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            foreach (var entry in entries)
            {
                var imdbId = entry.ImdbId?.Trim();
                var imageUrl = entry.ImageUrl?.Trim();
                if (string.IsNullOrWhiteSpace(imdbId) || string.IsNullOrWhiteSpace(imageUrl))
                {
                    continue;
                }

                lookup[imdbId] = imageUrl;
            }

            _logger?.LogInformation("Loaded {Count} artwork URLs from {ArchivePath}", lookup.Count, _archivePath);
            return lookup;
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Failed to load artwork archive from {ArchivePath}", _archivePath);
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private sealed record ArchiveArtworkEntry
    {
        [JsonPropertyName("imdb_id")]
        public string? ImdbId { get; init; }

        [JsonPropertyName("image_url")]
        public string? ImageUrl { get; init; }
    }
}
