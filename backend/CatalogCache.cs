using System.Net.Http.Headers;
using System.Text;

namespace MovieCrawler.Backend;

public sealed class CatalogCache
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly CatalogParser _parser;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly string _sourceUrl;

    private Catalog? _catalog;
    private string? _lastError;
    private CatalogFetchInfo? _lastFetchInfo;

    public CatalogCache(IHttpClientFactory httpClientFactory, CatalogParser parser, IConfiguration configuration)
    {
        _httpClientFactory = httpClientFactory;
        _parser = parser;
        _sourceUrl = configuration["Catalog:SourceUrl"]
            ?? "https://dls.iran-gamecenter-host.com/DonyayeSerial/offline_archive.html";
    }

    public Catalog? Current => _catalog;
    public string? LastError => _lastError;
    public string SourceUrl => _sourceUrl;
    public CatalogFetchInfo? LastFetchInfo => _lastFetchInfo;

    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        if (_catalog is not null)
        {
            return;
        }

        await ReloadAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<bool> ReloadAsync(CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var client = _httpClientFactory.CreateClient("catalog");
            using var response = await client.GetAsync(_sourceUrl, cancellationToken).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
            var encoding = GetEncoding(response.Content.Headers) ?? Encoding.GetEncoding("windows-1252");
            var html = encoding.GetString(bytes);

            var fetchedAt = DateTimeOffset.UtcNow;
            _catalog = _parser.Parse(html, _sourceUrl, fetchedAt);
            _lastFetchInfo = new CatalogFetchInfo
            {
                FetchedAt = fetchedAt,
                SourceUrl = _sourceUrl,
                ContentType = response.Content.Headers.ContentType?.ToString(),
                ContentLength = bytes.Length,
                Snippet = html.Length <= 1000 ? html : html[..1000]
            };
            _lastError = null;
            return true;
        }
        catch (Exception ex)
        {
            _lastError = ex.Message;
            _lastFetchInfo = new CatalogFetchInfo
            {
                FetchedAt = null,
                SourceUrl = _sourceUrl,
                ContentType = null,
                ContentLength = null,
                Snippet = null
            };
            return false;
        }
        finally
        {
            _lock.Release();
        }
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
