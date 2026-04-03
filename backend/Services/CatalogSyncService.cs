using System.Net.Http.Headers;
using System.Text;
using Microsoft.EntityFrameworkCore;

namespace MovieCrawler.Backend;

public sealed class CatalogSyncService(
    AppDbContext db,
    IHttpClientFactory httpClientFactory,
    CatalogParser parser,
    CatalogProjectionService projection,
    CatalogSnapshotCache snapshotCache,
    IConfiguration configuration)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _sourceUrl = configuration["Catalog:SourceUrl"]
        ?? "https://dls2.iran-gamecenter-host.com/DonyayeSerial/donyaye_serial_all_archive.html";

    public async Task<(CatalogSyncResult Result, CatalogFetchInfo FetchInfo)> SyncAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var client = httpClientFactory.CreateClient("catalog");
            using var response = await client.GetAsync(_sourceUrl, cancellationToken).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
            var encoding = GetEncoding(response.Content.Headers) ?? Encoding.GetEncoding("windows-1252");
            var html = encoding.GetString(bytes);

            var fetchedAt = DateTimeOffset.UtcNow;
            var parsed = parser.Parse(html, _sourceUrl, fetchedAt);
            var report = await UpsertCatalogAsync(parsed, fetchedAt, cancellationToken).ConfigureAwait(false);

            var fetchInfo = new CatalogFetchInfo
            {
                FetchedAt = fetchedAt,
                SourceUrl = _sourceUrl,
                ContentType = response.Content.Headers.ContentType?.ToString(),
                ContentLength = bytes.Length,
                Snippet = html.Length <= 1000 ? html : html[..1000]
            };

            await HydrateSnapshotAsync(fetchInfo, cancellationToken).ConfigureAwait(false);
            return (report, fetchInfo);
        }
        catch (Exception ex)
        {
            var fetchInfo = new CatalogFetchInfo
            {
                FetchedAt = DateTimeOffset.UtcNow,
                SourceUrl = _sourceUrl,
                ContentType = null,
                ContentLength = null,
                Snippet = null
            };

            var state = await db.CatalogSyncStates.FirstOrDefaultAsync(x => x.Id == 1, cancellationToken).ConfigureAwait(false)
                ?? new CatalogSyncStateEntity { Id = 1, SourceUrl = _sourceUrl };
            state.LastSyncedAt = DateTimeOffset.UtcNow;
            state.SourceUrl = _sourceUrl;
            state.LastError = ex.Message;
            if (db.Entry(state).State == EntityState.Detached)
            {
                db.CatalogSyncStates.Add(state);
            }

            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            snapshotCache.SetError(ex.Message, fetchInfo);
            throw;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task HydrateSnapshotAsync(CatalogFetchInfo? fetchInfo, CancellationToken cancellationToken)
    {
        var state = await db.CatalogSyncStates.FirstOrDefaultAsync(x => x.Id == 1, cancellationToken).ConfigureAwait(false);
        var titles = await db.Titles
            .AsNoTracking()
            .Include(x => x.DownloadSections.OrderBy(section => section.SortOrder))
            .ThenInclude(section => section.Entries.OrderBy(entry => entry.SortOrder))
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var fetchedAt = state?.LastSyncedAt ?? DateTimeOffset.UtcNow;
        var sourceUrl = state?.SourceUrl ?? _sourceUrl;
        var catalog = projection.BuildCatalog(titles, fetchedAt, sourceUrl);

        snapshotCache.SetCatalog(catalog, fetchInfo ?? snapshotCache.LastFetchInfo, state?.LastError);
    }

    private async Task<CatalogSyncResult> UpsertCatalogAsync(Catalog parsed, DateTimeOffset syncedAt, CancellationToken cancellationToken)
    {
        var existingTitles = await db.Titles
            .Include(x => x.DownloadSections)
            .ThenInclude(section => section.Entries)
            .ToDictionaryAsync(x => x.ImdbCode, StringComparer.OrdinalIgnoreCase, cancellationToken)
            .ConfigureAwait(false);

        var inserted = 0;
        var updated = 0;
        var unchanged = 0;

        foreach (var item in parsed.Items)
        {
            var hash = projection.ComputeContentHash(item);
            if (!existingTitles.TryGetValue(item.ImdbCode, out var entity))
            {
                var newEntity = BuildTitleEntity(item, hash, syncedAt);
                db.Titles.Add(newEntity);
                inserted++;
                continue;
            }

            if (string.Equals(entity.ContentHash, hash, StringComparison.Ordinal))
            {
                unchanged++;
                continue;
            }

            ApplyItem(entity, item, hash, syncedAt);
            db.DownloadSections.RemoveRange(entity.DownloadSections);
            entity.DownloadSections = BuildSections(item);
            updated++;
        }

        var state = await db.CatalogSyncStates.FirstOrDefaultAsync(x => x.Id == 1, cancellationToken).ConfigureAwait(false)
            ?? new CatalogSyncStateEntity { Id = 1 };
        state.LastSyncedAt = syncedAt;
        state.SourceUrl = _sourceUrl;
        state.LastError = null;

        if (db.Entry(state).State == EntityState.Detached)
        {
            db.CatalogSyncStates.Add(state);
        }

        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        return new CatalogSyncResult
        {
            Inserted = inserted,
            Updated = updated,
            Unchanged = unchanged,
            SyncedAt = syncedAt
        };
    }

    private static TitleEntity BuildTitleEntity(CatalogItem item, string hash, DateTimeOffset now)
    {
        var entity = new TitleEntity
        {
            ImdbCode = item.ImdbCode,
            Title = item.Title,
            Year = item.Year,
            Type = item.Type.ToString(),
            ImdbRate = item.ImdbRate,
            ImdbVotes = item.ImdbVotes,
            IsDubbed = item.IsDubbed,
            ContentHash = hash,
            Summary = item.Summary,
            Duration = item.Duration,
            CountryOrigin = item.CountryOrigin,
            Genres = item.Genres.Count > 0 ? string.Join(',', item.Genres) : null,
            Stars = item.Stars.Count > 0 ? string.Join(',', item.Stars) : null,
            AgeRating = item.AgeRating,
            PosterUrl = item.PosterUrl,
            CoverUrl = item.CoverUrl,
            CreatedAt = now,
            UpdatedAt = now,
            DownloadSections = BuildSections(item)
        };

        return entity;
    }

    private static void ApplyItem(TitleEntity entity, CatalogItem item, string hash, DateTimeOffset now)
    {
        entity.Title = item.Title;
        entity.Year = item.Year;
        entity.Type = item.Type.ToString();
        entity.ImdbRate = item.ImdbRate;
        entity.ImdbVotes = item.ImdbVotes;
        entity.IsDubbed = item.IsDubbed;
        entity.ContentHash = hash;
        entity.UpdatedAt = now;

        if (!string.IsNullOrWhiteSpace(item.Summary))
        {
            entity.Summary = item.Summary;
        }

        if (!string.IsNullOrWhiteSpace(item.Duration))
        {
            entity.Duration = item.Duration;
        }

        if (!string.IsNullOrWhiteSpace(item.CountryOrigin))
        {
            entity.CountryOrigin = item.CountryOrigin;
        }

        if (item.Genres.Count > 0)
        {
            entity.Genres = string.Join(',', item.Genres);
        }

        if (item.Stars.Count > 0)
        {
            entity.Stars = string.Join(',', item.Stars);
        }

        if (!string.IsNullOrWhiteSpace(item.AgeRating))
        {
            entity.AgeRating = item.AgeRating;
        }

        if (!string.IsNullOrWhiteSpace(item.PosterUrl))
        {
            entity.PosterUrl = item.PosterUrl;
        }

        if (!string.IsNullOrWhiteSpace(item.CoverUrl))
        {
            entity.CoverUrl = item.CoverUrl;
        }
    }

    private static List<DownloadSectionEntity> BuildSections(CatalogItem item)
    {
        var sections = new List<DownloadSectionEntity>();

        for (var groupIndex = 0; groupIndex < item.Downloads.Count; groupIndex++)
        {
            var group = item.Downloads[groupIndex];
            sections.Add(new DownloadSectionEntity
            {
                Scope = "movie",
                SeasonNumber = null,
                Label = group.Label,
                SortOrder = groupIndex,
                Entries = group.Links
                    .Select((link, linkIndex) => new DownloadEntryEntity
                    {
                        Label = link.Label,
                        AbsoluteUrl = link.Url,
                        SizeRaw = link.Size,
                        SortOrder = linkIndex
                    })
                    .ToList()
            });
        }

        for (var seasonIndex = 0; seasonIndex < item.Seasons.Count; seasonIndex++)
        {
            var season = item.Seasons[seasonIndex];
            for (var groupIndex = 0; groupIndex < season.Groups.Count; groupIndex++)
            {
                var group = season.Groups[groupIndex];
                sections.Add(new DownloadSectionEntity
                {
                    Scope = "season",
                    SeasonNumber = season.SeasonNumber,
                    Label = group.Label,
                    SortOrder = (seasonIndex * 1000) + groupIndex,
                    Entries = group.Links
                        .Select((link, linkIndex) => new DownloadEntryEntity
                        {
                            Label = link.Label,
                            AbsoluteUrl = link.Url,
                            SizeRaw = link.Size,
                            SortOrder = linkIndex
                        })
                        .ToList()
                });
            }
        }

        return sections;
    }

    private static Encoding? GetEncoding(HttpContentHeaders headers)
    {
        var charset = headers.ContentType?.CharSet;
        if (string.IsNullOrWhiteSpace(charset))
        {
            return null;
        }

        try
        {
            return Encoding.GetEncoding(charset);
        }
        catch
        {
            return null;
        }
    }
}
