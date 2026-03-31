using System.Collections.Concurrent;

namespace MovieCrawler.Backend;

public sealed class DownloadLinksResolveService(
    IDirectoryDownloadResolver resolver,
    TvSeriesDirectoryLinksCache cache)
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _keyLocks =
        new(StringComparer.OrdinalIgnoreCase);

    public async Task<ResolveDownloadLinksResponse> ResolveAsync(
        ResolveDownloadLinksRequest? request,
        CancellationToken cancellationToken)
    {
        var orderedUrls = BuildOrderedUrls(request?.Urls ?? []);
        if (orderedUrls.Count == 0)
        {
            return new ResolveDownloadLinksResponse
            {
                Results = []
            };
        }

        var isTvSeries = request?.TitleType == TitleType.TvSeries;
        if (!isTvSeries)
        {
            var directResults = await resolver.ResolveAsync(
                orderedUrls.Select(item => item.Url),
                cancellationToken).ConfigureAwait(false);

            return new ResolveDownloadLinksResponse
            {
                Results = ReorderResults(orderedUrls, directResults)
            };
        }

        var resultsByKey = new Dictionary<string, ResolvedDirectoryLinks>(StringComparer.OrdinalIgnoreCase);
        var unresolved = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in orderedUrls)
        {
            if (cache.TryGetByKey(item.Key, out var cached))
            {
                resultsByKey[item.Key] = cached;
                continue;
            }

            unresolved[item.Key] = item.Url;
        }

        if (unresolved.Count > 0)
        {
            var lockKeys = unresolved.Keys
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(key => key, StringComparer.Ordinal)
                .ToList();

            var acquiredLocks = new List<SemaphoreSlim>(lockKeys.Count);
            try
            {
                foreach (var key in lockKeys)
                {
                    var gate = _keyLocks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
                    await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
                    acquiredLocks.Add(gate);
                }

                var stillUnresolved = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var (key, url) in unresolved)
                {
                    if (cache.TryGetByKey(key, out var cached))
                    {
                        resultsByKey[key] = cached;
                        continue;
                    }

                    stillUnresolved[key] = url;
                }

                if (stillUnresolved.Count > 0)
                {
                    var resolvedMissing = await resolver.ResolveAsync(
                        stillUnresolved.Values,
                        cancellationToken).ConfigureAwait(false);

                    var resolvedByKey = resolvedMissing
                        .Where(result => !string.IsNullOrWhiteSpace(result.Url))
                        .GroupBy(result => TvSeriesDirectoryLinksCache.NormalizeKey(result.Url), StringComparer.OrdinalIgnoreCase)
                        .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

                    foreach (var (key, requestedUrl) in stillUnresolved)
                    {
                        var resolved = resolvedByKey.TryGetValue(key, out var existing)
                            ? existing
                            : new ResolvedDirectoryLinks
                            {
                                Url = requestedUrl,
                                Error = "Directory resolve response missing for requested URL.",
                                Links = []
                            };

                        cache.SetByKey(key, resolved);
                        resultsByKey[key] = resolved;
                    }
                }
            }
            finally
            {
                for (var i = acquiredLocks.Count - 1; i >= 0; i--)
                {
                    acquiredLocks[i].Release();
                }
            }
        }

        return new ResolveDownloadLinksResponse
        {
            Results = orderedUrls.Select(item =>
            {
                var resolved = resultsByKey[item.Key];
                return new ResolvedDirectoryLinks
                {
                    Url = item.Url,
                    Error = resolved.Error,
                    Links = resolved.Links.Select(link => new DownloadLink
                    {
                        Label = link.Label,
                        Url = link.Url,
                        Size = link.Size,
                        ParentGroupName = link.ParentGroupName,
                        SeasonNumber = link.SeasonNumber,
                        EpisodeNumber = link.EpisodeNumber
                    }).ToList()
                };
            }).ToList()
        };
    }

    private static List<(string Url, string Key)> BuildOrderedUrls(IEnumerable<string> urls)
    {
        var ordered = new List<(string Url, string Key)>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var rawUrl in urls)
        {
            var normalizedUrl = (rawUrl ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(normalizedUrl))
            {
                continue;
            }

            var key = TvSeriesDirectoryLinksCache.NormalizeKey(normalizedUrl);
            if (string.IsNullOrWhiteSpace(key) || !seen.Add(key))
            {
                continue;
            }

            ordered.Add((normalizedUrl, key));
        }

        return ordered;
    }

    private static List<ResolvedDirectoryLinks> ReorderResults(
        List<(string Url, string Key)> orderedUrls,
        List<ResolvedDirectoryLinks> results)
    {
        var resultByKey = results
            .Where(result => !string.IsNullOrWhiteSpace(result.Url))
            .GroupBy(result => TvSeriesDirectoryLinksCache.NormalizeKey(result.Url), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        return orderedUrls.Select(item =>
        {
            if (resultByKey.TryGetValue(item.Key, out var existing))
            {
                return existing with { Url = item.Url };
            }

            return new ResolvedDirectoryLinks
            {
                Url = item.Url,
                Error = "Directory resolve response missing for requested URL.",
                Links = []
            };
        }).ToList();
    }
}
