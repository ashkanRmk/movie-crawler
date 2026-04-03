using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;

namespace MovieCrawler.Backend;

public sealed class DownloadLinksResolveService
{
    private readonly IDirectoryDownloadResolver _resolver;
    private readonly TvSeriesDirectoryLinksCache _cache;
    private readonly IServiceScopeFactory? _scopeFactory;
    private readonly CatalogProjectionService? _projection;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _keyLocks =
        new(StringComparer.OrdinalIgnoreCase);

    public DownloadLinksResolveService(IDirectoryDownloadResolver resolver, TvSeriesDirectoryLinksCache cache)
    {
        _resolver = resolver;
        _cache = cache;
    }

    public DownloadLinksResolveService(
        IDirectoryDownloadResolver resolver,
        TvSeriesDirectoryLinksCache cache,
        IServiceScopeFactory scopeFactory,
        CatalogProjectionService projection)
        : this(resolver, cache)
    {
        _scopeFactory = scopeFactory;
        _projection = projection;
    }

    public async Task<ResolveDownloadLinksResponse> ResolveAsync(
        ResolveDownloadLinksRequest? request,
        CancellationToken cancellationToken)
    {
        var ordered = BuildOrderedUrls(request?.Urls ?? []);
        if (ordered.Count == 0)
        {
            return new ResolveDownloadLinksResponse { Results = [] };
        }

        if (_scopeFactory is null || _projection is null)
        {
            return await ResolveLegacyAsync(request, ordered, cancellationToken).ConfigureAwait(false);
        }

        var resultsByKey = new Dictionary<string, ResolvedDirectoryLinks>(StringComparer.OrdinalIgnoreCase);
        var unresolved = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in ordered)
        {
            if (_cache.TryGetByKey(item.Key, out var cached))
            {
                resultsByKey[item.Key] = cached;
                continue;
            }

            unresolved[item.Key] = item.Url;
        }

        if (unresolved.Count > 0)
        {
            await LoadFromDatabaseAsync(unresolved, resultsByKey, cancellationToken).ConfigureAwait(false);
            unresolved = unresolved
                .Where(pair => !resultsByKey.ContainsKey(pair.Key))
                .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
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

                var stillUnresolved = unresolved
                    .Where(pair => !resultsByKey.ContainsKey(pair.Key))
                    .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);

                if (stillUnresolved.Count > 0)
                {
                    await LoadFromDatabaseAsync(stillUnresolved, resultsByKey, cancellationToken).ConfigureAwait(false);
                    stillUnresolved = stillUnresolved
                        .Where(pair => !resultsByKey.ContainsKey(pair.Key))
                        .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
                }

                if (stillUnresolved.Count > 0)
                {
                    var resolvedMissing = await _resolver.ResolveAsync(
                        stillUnresolved.Values,
                        cancellationToken).ConfigureAwait(false);

                    var persisted = await PersistResolvedAsync(stillUnresolved, resolvedMissing, cancellationToken).ConfigureAwait(false);
                    foreach (var (key, value) in persisted)
                    {
                        _cache.SetByKey(key, value);
                        resultsByKey[key] = value;
                    }

                    foreach (var (key, url) in stillUnresolved)
                    {
                        if (resultsByKey.ContainsKey(key))
                        {
                            continue;
                        }

                        resultsByKey[key] = new ResolvedDirectoryLinks
                        {
                            Url = url,
                            Error = "Directory resolve response missing or failed.",
                            Links = []
                        };
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

        var results = ordered.Select(item =>
        {
            if (resultsByKey.TryGetValue(item.Key, out var resolved))
            {
                return Clone(resolved, item.Url);
            }

            return new ResolvedDirectoryLinks
            {
                Url = item.Url,
                Error = "Directory resolve response missing or failed.",
                Links = []
            };
        }).ToList();

        return new ResolveDownloadLinksResponse { Results = results };
    }

    private async Task LoadFromDatabaseAsync(
        Dictionary<string, string> unresolved,
        Dictionary<string, ResolvedDirectoryLinks> resultsByKey,
        CancellationToken cancellationToken)
    {
        if (unresolved.Count == 0 || _scopeFactory is null || _projection is null)
        {
            return;
        }

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var keys = unresolved.Keys.ToList();
        var dbRows = await db.ResolvedDirectories
            .AsNoTracking()
            .Include(x => x.Files)
            .Where(x => keys.Contains(x.DirectoryKey))
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        foreach (var row in dbRows)
        {
            if (row.Files.Count == 0)
            {
                continue;
            }

            var mapped = _projection.MapResolvedDirectory(row);
            _cache.SetByKey(row.DirectoryKey, mapped);
            resultsByKey[row.DirectoryKey] = mapped;
        }
    }

    private async Task<Dictionary<string, ResolvedDirectoryLinks>> PersistResolvedAsync(
        Dictionary<string, string> unresolved,
        List<ResolvedDirectoryLinks> resolvedMissing,
        CancellationToken cancellationToken)
    {
        var byKey = new Dictionary<string, ResolvedDirectoryLinks>(StringComparer.OrdinalIgnoreCase);
        if (_scopeFactory is null)
        {
            return byKey;
        }

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var resolvedByKey = resolvedMissing
            .Where(result => !string.IsNullOrWhiteSpace(result.Url) && string.IsNullOrWhiteSpace(result.Error))
            .GroupBy(result => NormalizeAbsoluteKey(result.Url), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        var now = DateTimeOffset.UtcNow;
        var keys = unresolved.Keys.ToList();
        var existingRows = await db.ResolvedDirectories
            .Include(x => x.Files)
            .Where(x => keys.Contains(x.DirectoryKey))
            .ToDictionaryAsync(x => x.DirectoryKey, StringComparer.OrdinalIgnoreCase, cancellationToken)
            .ConfigureAwait(false);

        foreach (var (key, requestedAbsolute) in unresolved)
        {
            if (!resolvedByKey.TryGetValue(key, out var resolved))
            {
                continue;
            }

            if (!existingRows.TryGetValue(key, out var entity))
            {
                entity = new ResolvedDirectoryEntity
                {
                    DirectoryKey = key,
                    DirectoryUrl = requestedAbsolute,
                    UpdatedAt = now
                };
                db.ResolvedDirectories.Add(entity);
            }
            else
            {
                db.ResolvedDirectoryFiles.RemoveRange(entity.Files);
                entity.Files.Clear();
                entity.DirectoryUrl = requestedAbsolute;
                entity.UpdatedAt = now;
            }

            entity.Files = resolved.Links
                .Where(link => !string.IsNullOrWhiteSpace(link.Url))
                .Select((link, index) => new ResolvedDirectoryFileEntity
                {
                    Label = link.Label,
                    AbsoluteUrl = link.Url,
                    SizeRaw = link.Size,
                    ParentGroupName = link.ParentGroupName,
                    SeasonNumber = link.SeasonNumber,
                    EpisodeNumber = link.EpisodeNumber,
                    SortOrder = index
                })
                .ToList();

            if (entity.Files.Count == 0)
            {
                continue;
            }

            byKey[key] = new ResolvedDirectoryLinks
            {
                Url = requestedAbsolute,
                Links = entity.Files.Select(file => new DownloadLink
                {
                    Label = file.Label,
                    Url = file.AbsoluteUrl,
                    Size = SizeLabelFormatter.Format(file.SizeRaw),
                    ParentGroupName = file.ParentGroupName,
                    SeasonNumber = file.SeasonNumber,
                    EpisodeNumber = file.EpisodeNumber
                }).ToList()
            };
        }

        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return byKey;
    }

    private async Task<ResolveDownloadLinksResponse> ResolveLegacyAsync(
        ResolveDownloadLinksRequest? request,
        List<OrderedUrl> orderedUrls,
        CancellationToken cancellationToken)
    {
        var isTvSeries = request?.TitleType == TitleType.TvSeries;
        if (!isTvSeries)
        {
            var directResults = await _resolver.ResolveAsync(
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
            if (_cache.TryGetByKey(item.Key, out var cached))
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

                var stillUnresolved = unresolved
                    .Where(pair => !resultsByKey.ContainsKey(pair.Key))
                    .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);

                foreach (var (key, requestedUrl) in stillUnresolved.ToList())
                {
                    if (_cache.TryGetByKey(key, out var cached))
                    {
                        resultsByKey[key] = Clone(cached, requestedUrl);
                        stillUnresolved.Remove(key);
                    }
                }

                if (stillUnresolved.Count > 0)
                {
                    var resolvedMissing = await _resolver.ResolveAsync(stillUnresolved.Values, cancellationToken).ConfigureAwait(false);
                    var resolvedByKey = resolvedMissing
                        .Where(result => !string.IsNullOrWhiteSpace(result.Url) && string.IsNullOrWhiteSpace(result.Error))
                        .GroupBy(result => NormalizeAbsoluteKey(result.Url), StringComparer.OrdinalIgnoreCase)
                        .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

                    foreach (var (key, requestedUrl) in stillUnresolved)
                    {
                        if (!resolvedByKey.TryGetValue(key, out var resolved))
                        {
                            resultsByKey[key] = new ResolvedDirectoryLinks
                            {
                                Url = requestedUrl,
                                Error = "Directory resolve response missing or failed.",
                                Links = []
                            };
                            continue;
                        }

                        _cache.SetByKey(key, resolved);
                        resultsByKey[key] = Clone(resolved, requestedUrl);
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
                return Clone(resolved, item.Url);
            }).ToList()
        };
    }

    private static List<OrderedUrl> BuildOrderedUrls(IEnumerable<string> urls)
    {
        var ordered = new List<OrderedUrl>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var rawUrl in urls)
        {
            var url = (rawUrl ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(url))
            {
                continue;
            }

            var key = NormalizeAbsoluteKey(url);
            if (string.IsNullOrWhiteSpace(key) || !seen.Add(key))
            {
                continue;
            }

            ordered.Add(new OrderedUrl(url, key));
        }

        return ordered;
    }

    private static string NormalizeAbsoluteKey(string url)
    {
        var trimmed = (url ?? string.Empty).Trim();
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri))
        {
            return trimmed.TrimEnd('/').ToLowerInvariant();
        }

        var scheme = uri.Scheme.ToLowerInvariant();
        var host = uri.IdnHost.ToLowerInvariant();
        var path = uri.AbsolutePath.TrimEnd('/').ToLowerInvariant();
        if (string.IsNullOrEmpty(path))
        {
            path = "/";
        }

        var authority = uri.IsDefaultPort ? host : $"{host}:{uri.Port}";
        return $"{scheme}://{authority}{path}{uri.Query}{uri.Fragment}";
    }

    private static List<ResolvedDirectoryLinks> ReorderResults(
        List<OrderedUrl> orderedUrls,
        List<ResolvedDirectoryLinks> results)
    {
        var resultByKey = results
            .Where(result => !string.IsNullOrWhiteSpace(result.Url) && string.IsNullOrWhiteSpace(result.Error))
            .GroupBy(result => NormalizeAbsoluteKey(result.Url), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        return orderedUrls.Select(item =>
        {
            if (resultByKey.TryGetValue(item.Key, out var existing))
            {
                return Clone(existing, item.Url);
            }

            return new ResolvedDirectoryLinks
            {
                Url = item.Url,
                Error = "Directory resolve response missing or failed.",
                Links = []
            };
        }).ToList();
    }

    private static ResolvedDirectoryLinks Clone(ResolvedDirectoryLinks value, string url)
    {
        return new ResolvedDirectoryLinks
        {
            Url = url,
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

    private sealed record OrderedUrl(string Url, string Key);
}
