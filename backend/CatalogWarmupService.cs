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
                _logger.LogWarning("Catalog warmup completed but cache is empty. Error: {Error}", _cache.LastError);
            }
            else
            {
                _logger.LogInformation("Catalog warmup completed. Items: {Count}", _cache.Current.Items.Count);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Catalog warmup failed.");
        }
    }
}
