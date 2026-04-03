using Microsoft.EntityFrameworkCore;

namespace MovieCrawler.Backend;

public sealed class CatalogQueryService(
    AppDbContext db,
    CatalogSnapshotCache snapshotCache,
    CatalogSyncService syncService)
{
    public async Task<Catalog?> GetCatalogAsync(CancellationToken cancellationToken)
    {
        if (snapshotCache.Current is not null)
        {
            return snapshotCache.Current;
        }

        await syncService.HydrateSnapshotAsync(snapshotCache.LastFetchInfo, cancellationToken).ConfigureAwait(false);
        return snapshotCache.Current;
    }

    public async Task<CatalogItem?> GetTitleByImdbCodeAsync(string imdbCode, CancellationToken cancellationToken)
    {
        var catalog = await GetCatalogAsync(cancellationToken).ConfigureAwait(false);
        return catalog?.Items.FirstOrDefault(item => item.ImdbCode.Equals(imdbCode, StringComparison.OrdinalIgnoreCase));
    }

    public Task<bool> HasAnyTitlesAsync(CancellationToken cancellationToken)
        => db.Titles.AnyAsync(cancellationToken);
}
