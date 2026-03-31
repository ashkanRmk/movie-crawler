using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using MovieCrawler.Backend;
using Xunit;

namespace MovieCrawler.Backend.Tests;

public sealed class DownloadLinksResolveServiceTests
{
    [Fact]
    public async Task ResolveAsync_Caches_TvSeries_Results_Per_Url()
    {
        var resolver = new FakeResolver(urls => urls.Select(url => CreateResult(url)).ToList());
        var cache = new TvSeriesDirectoryLinksCache();
        var service = new DownloadLinksResolveService(resolver, cache);

        var request = new ResolveDownloadLinksRequest
        {
            TitleType = TitleType.TvSeries,
            Urls = ["https://example.com/series/show/s01/720p"]
        };

        var first = await service.ResolveAsync(request, CancellationToken.None);
        var second = await service.ResolveAsync(request, CancellationToken.None);

        Assert.Single(first.Results);
        Assert.Single(second.Results);
        Assert.Equal(1, resolver.CallCount);
    }

    [Fact]
    public async Task ResolveAsync_Resolves_Only_Missing_Urls_For_TvSeries()
    {
        var resolver = new FakeResolver(urls => urls.Select(url => CreateResult(url)).ToList());
        var cache = new TvSeriesDirectoryLinksCache();
        var service = new DownloadLinksResolveService(resolver, cache);

        var cachedOnly = new ResolveDownloadLinksRequest
        {
            TitleType = TitleType.TvSeries,
            Urls = ["https://example.com/a"]
        };

        await service.ResolveAsync(cachedOnly, CancellationToken.None);

        var mixed = new ResolveDownloadLinksRequest
        {
            TitleType = TitleType.TvSeries,
            Urls = ["https://example.com/a", "https://example.com/b"]
        };

        var response = await service.ResolveAsync(mixed, CancellationToken.None);

        Assert.Equal(2, response.Results.Count);
        Assert.Equal(2, resolver.CallCount);
        Assert.Single(resolver.Calls[1]);
        Assert.Equal("https://example.com/b", resolver.Calls[1][0]);
    }

    [Fact]
    public async Task ResolveAsync_Bypasses_Cache_For_Movies()
    {
        var resolver = new FakeResolver(urls => urls.Select(url => CreateResult(url)).ToList());
        var cache = new TvSeriesDirectoryLinksCache();
        var service = new DownloadLinksResolveService(resolver, cache);

        var request = new ResolveDownloadLinksRequest
        {
            TitleType = TitleType.Movie,
            Urls = ["https://example.com/movie/a"]
        };

        await service.ResolveAsync(request, CancellationToken.None);
        await service.ResolveAsync(request, CancellationToken.None);

        Assert.Equal(2, resolver.CallCount);
    }

    [Fact]
    public async Task ResolveAsync_Uses_SingleFlight_For_Concurrent_TvSeries_Requests()
    {
        var resolver = new FakeResolver(async urls =>
        {
            await Task.Delay(60);
            return urls.Select(url => CreateResult(url)).ToList();
        });

        var cache = new TvSeriesDirectoryLinksCache();
        var service = new DownloadLinksResolveService(resolver, cache);

        var request = new ResolveDownloadLinksRequest
        {
            TitleType = TitleType.TvSeries,
            Urls = ["https://example.com/series/concurrent"]
        };

        await Task.WhenAll(
            service.ResolveAsync(request, CancellationToken.None),
            service.ResolveAsync(request, CancellationToken.None));

        Assert.Equal(1, resolver.CallCount);
    }

    [Fact]
    public async Task ResolveAsync_ReResolves_After_Cache_Clear()
    {
        var resolver = new FakeResolver(urls => urls.Select(url => CreateResult(url)).ToList());
        var cache = new TvSeriesDirectoryLinksCache();
        var service = new DownloadLinksResolveService(resolver, cache);

        var request = new ResolveDownloadLinksRequest
        {
            TitleType = TitleType.TvSeries,
            Urls = ["https://example.com/series/reset"]
        };

        await service.ResolveAsync(request, CancellationToken.None);
        cache.Clear();
        await service.ResolveAsync(request, CancellationToken.None);

        Assert.Equal(2, resolver.CallCount);
    }

    [Fact]
    public async Task ResolveAsync_Returns_Results_In_Request_Order()
    {
        var resolver = new FakeResolver(urls => urls.AsEnumerable().Reverse().Select(url => CreateResult(url)).ToList());
        var cache = new TvSeriesDirectoryLinksCache();
        var service = new DownloadLinksResolveService(resolver, cache);

        var request = new ResolveDownloadLinksRequest
        {
            TitleType = TitleType.TvSeries,
            Urls = ["https://example.com/2", "https://example.com/1"]
        };

        var response = await service.ResolveAsync(request, CancellationToken.None);

        Assert.Equal("https://example.com/2", response.Results[0].Url);
        Assert.Equal("https://example.com/1", response.Results[1].Url);
    }

    private static ResolvedDirectoryLinks CreateResult(string url)
    {
        return new ResolvedDirectoryLinks
        {
            Url = url,
            Error = null,
            Links =
            [
                new DownloadLink
                {
                    Label = "Episode",
                    Url = $"{url.TrimEnd('/')}/E01.mkv"
                }
            ]
        };
    }

    private sealed class FakeResolver : IDirectoryDownloadResolver
    {
        private readonly Func<List<string>, Task<List<ResolvedDirectoryLinks>>> _handler;
        private readonly ConcurrentQueue<List<string>> _calls = new();

        public FakeResolver(Func<List<string>, List<ResolvedDirectoryLinks>> handler)
        {
            _handler = urls => Task.FromResult(handler(urls));
        }

        public FakeResolver(Func<List<string>, Task<List<ResolvedDirectoryLinks>>> handler)
        {
            _handler = handler;
        }

        public int CallCount => _calls.Count;

        public List<List<string>> Calls => _calls.ToList();

        public async Task<List<ResolvedDirectoryLinks>> ResolveAsync(IEnumerable<string> urls, CancellationToken cancellationToken)
        {
            var values = urls.ToList();
            _calls.Enqueue(values);
            return await _handler(values);
        }
    }
}
