namespace MovieCrawler.Backend;

public sealed class CatalogWarmupService : BackgroundService
{
    private readonly CatalogCache _cache;
    private readonly ILogger<CatalogWarmupService> _logger;

    public CatalogWarmupService(CatalogCache cache, ILogger<CatalogWarmupService> logger)
    {
        _cache = cache;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await _cache.LoadAsync(stoppingToken).ConfigureAwait(false);
            if (_cache.Current is null)
            {
                _logger.LogError(
                    "Catalog warmup failed. Source: {SourceUrl}. Error: {Error}",
                    _cache.SourceUrl,
                    _cache.LastError);
            }
            else
            {
                _logger.LogInformation(
                    "Catalog warmup completed successfully. Source: {SourceUrl}. Items: {Count}. FetchedAt: {FetchedAt}",
                    _cache.Current.Meta.SourceUrl,
                    _cache.Current.Items.Count,
                    _cache.Current.Meta.FetchedAt);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Catalog warmup failed with unhandled exception. Source: {SourceUrl}", _cache.SourceUrl);
        }
    }
}
