using System.Collections.Concurrent;

namespace MovieCrawler.Backend;

public sealed class TvSeriesDirectoryLinksCache
{
    private readonly ConcurrentDictionary<string, ResolvedDirectoryLinks> _entries =
        new(StringComparer.OrdinalIgnoreCase);

    public static string NormalizeKey(string url)
    {
        var trimmed = (url ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return string.Empty;
        }

        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri))
        {
            return trimmed.TrimEnd('/').ToLowerInvariant();
        }

        var scheme = uri.Scheme.ToLowerInvariant();
        var host = uri.IdnHost.ToLowerInvariant();
        var path = uri.AbsolutePath.TrimEnd('/');
        if (string.IsNullOrEmpty(path))
        {
            path = "/";
        }

        path = path.ToLowerInvariant();

        var authority = uri.IsDefaultPort
            ? host
            : $"{host}:{uri.Port}";

        var query = uri.Query;
        var fragment = uri.Fragment;

        return $"{scheme}://{authority}{path}{query}{fragment}";
    }

    public bool TryGetByKey(string key, out ResolvedDirectoryLinks value)
    {
        if (_entries.TryGetValue(key, out var cached))
        {
            value = Clone(cached);
            return true;
        }

        value = new ResolvedDirectoryLinks { Url = string.Empty, Links = [] };
        return false;
    }

    public void SetByKey(string key, ResolvedDirectoryLinks value)
    {
        _entries[key] = Clone(value);
    }

    public void Clear()
    {
        _entries.Clear();
    }

    private static ResolvedDirectoryLinks Clone(ResolvedDirectoryLinks value)
    {
        return new ResolvedDirectoryLinks
        {
            Url = value.Url,
            Error = value.Error,
            Links = value.Links.Select(link => new DownloadLink
            {
                Label = link.Label,
                Url = link.Url,
                Size = link.Size,
                ParentGroupName = link.ParentGroupName,
                SeasonNumber = link.SeasonNumber,
                EpisodeNumber = link.EpisodeNumber
            }).ToList()
        };
    }
}
