namespace MovieCrawler.Backend;

public sealed class CatalogSnapshotCache
{
    private readonly object _sync = new();
    private Catalog? _catalog;
    private CatalogFetchInfo? _lastFetchInfo;
    private string? _lastError;

    public Catalog? Current
    {
        get
        {
            lock (_sync)
            {
                return _catalog;
            }
        }
    }

    public CatalogFetchInfo? LastFetchInfo
    {
        get
        {
            lock (_sync)
            {
                return _lastFetchInfo;
            }
        }
    }

    public string? LastError
    {
        get
        {
            lock (_sync)
            {
                return _lastError;
            }
        }
    }

    public void SetCatalog(Catalog catalog, CatalogFetchInfo? fetchInfo, string? lastError = null)
    {
        lock (_sync)
        {
            _catalog = catalog;
            _lastFetchInfo = fetchInfo;
            _lastError = lastError;
        }
    }

    public void SetError(string? error, CatalogFetchInfo? fetchInfo = null)
    {
        lock (_sync)
        {
            _lastError = error;
            if (fetchInfo is not null)
            {
                _lastFetchInfo = fetchInfo;
            }
        }
    }

    public void Clear()
    {
        lock (_sync)
        {
            _catalog = null;
        }
    }
}
