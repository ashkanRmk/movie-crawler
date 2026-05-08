using System.Net.Http;
using MovieCrawler.Backend;
using Xunit;

namespace MovieCrawler.Backend.Tests;

public sealed class DirectoryDownloadResolverTests
{
    [Fact]
    public void ParseDirectoryHtml_Extracts_Direct_Video_File_Links_With_Size()
    {
        const string html = """
<html><body>
  <table class="table">
    <tbody>
      <tr>
        <td class="n"><a href="https://example.com/path/">Parent Directory/</a></td>
        <td class="s">-</td>
      </tr>
      <tr>
        <td class="n"><a href="episode1.mkv"><code>Episode.01.mkv</code></a></td>
        <td class="s"><code>396.2M</code></td>
      </tr>
      <tr>
        <td class="n"><a href="episode2.mp4"><code>Episode.02.mp4</code></a></td>
        <td class="s"><code>410.0M</code></td>
      </tr>
      <tr>
        <td class="n"><a href="subs/"><code>subs/</code></a></td>
        <td class="s"><code>-</code></td>
      </tr>
      <tr>
        <td class="n"><a href="readme.txt"><code>readme.txt</code></a></td>
        <td class="s"><code>5K</code></td>
      </tr>
    </tbody>
  </table>
</body></html>
""";

        var resolver = new DirectoryDownloadResolver(new TestHttpClientFactory());
        var links = resolver.ParseDirectoryHtml(html, "https://example.com/path/");

        Assert.Equal(2, links.Count);

        Assert.Equal("https://example.com/path/episode1.mkv", links[0].Url);
        Assert.Equal("Episode.01.mkv", links[0].Label);
        Assert.Equal("396.2M", links[0].Size);
        Assert.Equal("path", links[0].ParentGroupName);
        Assert.Null(links[0].SeasonNumber);
        Assert.Null(links[0].EpisodeNumber);

        Assert.Equal("https://example.com/path/episode2.mp4", links[1].Url);
        Assert.Equal("Episode.02.mp4", links[1].Label);
        Assert.Equal("410.0M", links[1].Size);
    }

    [Fact]
    public void ParseDirectoryHtml_Does_Not_Include_Directory_Anchors()
    {
        const string html = """
<html><body>
  <table>
    <tbody>
      <tr><td class="n"><a href="season-2/">season-2/</a></td><td class="s">-</td></tr>
      <tr><td class="n"><a href="episode.mkv">episode.mkv</a></td><td class="s">300M</td></tr>
    </tbody>
  </table>
</body></html>
""";

        var resolver = new DirectoryDownloadResolver(new TestHttpClientFactory());
        var links = resolver.ParseDirectoryHtml(html, "https://example.com/path/");

        Assert.Single(links);
        Assert.Equal("https://example.com/path/episode.mkv", links[0].Url);
    }

    [Fact]
    public void ParseDirectoryHtml_Extracts_Parent_Group_Season_And_Episode_Metadata()
    {
        const string html = """
<html><body>
  <table>
    <tbody>
      <tr>
        <td class="n">
          <a href="Cosmos.1980.S01E03.720p.BluRay.x264.MkvCage.softsub.DonyayeSerial.mkv">
            Cosmos.1980.S01E03.720p.BluRay.x264.MkvCage.softsub.DonyayeSerial.mkv
          </a>
        </td>
        <td class="s">395M</td>
      </tr>
      <tr>
        <td class="n">
          <a href="Another.Show.S2E11.1080p.WEB-DL.HEVC.Group.mkv">
            Another.Show.S2E11.1080p.WEB-DL.HEVC.Group.mkv
          </a>
        </td>
        <td class="s">800M</td>
      </tr>
      <tr>
        <td class="n">
          <a href="No.Pattern.1080p.BluRay.mkv">
            No.Pattern.1080p.BluRay.mkv
          </a>
        </td>
        <td class="s">300M</td>
      </tr>
    </tbody>
  </table>
</body></html>
""";

        var resolver = new DirectoryDownloadResolver(new TestHttpClientFactory());
        var links = resolver.ParseDirectoryHtml(
            html,
            "https://example.com/series/Cosmos/Soft.Sub/S01/720p.BluRay/");

        Assert.Equal(3, links.Count);

        Assert.Equal("720p BluRay x264", links[0].ParentGroupName);
        Assert.Equal(1, links[0].SeasonNumber);
        Assert.Equal(3, links[0].EpisodeNumber);

        Assert.Equal("1080p WEB-DL hevc", links[1].ParentGroupName);
        Assert.Equal(2, links[1].SeasonNumber);
        Assert.Equal(11, links[1].EpisodeNumber);

        Assert.Equal("1080p BluRay", links[2].ParentGroupName);
        Assert.Null(links[2].SeasonNumber);
        Assert.Null(links[2].EpisodeNumber);
    }

    [Fact]
    public void ParseDirectoryHtml_Prefers_FileName_Profile_When_Parent_Directory_Is_Season()
    {
        const string html = """
<html><body>
  <table><tbody>
    <tr><td class="n"><a href="Planet.Earth.S01E03.720p.BluRay.SoftSub.DonyayeSerial.mkv">a</a></td><td class="s">1G</td></tr>
    <tr><td class="n"><a href="Planet.Earth.S01E07.1080p.BluRay.SoftSub.DonyayeSerial.mkv">b</a></td><td class="s">1G</td></tr>
    <tr><td class="n"><a href="Planet.Earth.S01E01.1080p.BluRay.x265.10bit.SoftSub.DonyayeSerial.mkv">c</a></td><td class="s">1G</td></tr>
  </tbody></table>
</body></html>
""";

        var resolver = new DirectoryDownloadResolver(new TestHttpClientFactory());
        var links = resolver.ParseDirectoryHtml(html, "https://dls4.iran-gamecenter-host.com/DonyayeSerial/series/Planet.Earth/Soft.Sub/S01/");

        Assert.Equal(3, links.Count);
        Assert.Equal("720p BluRay", links[0].ParentGroupName);
        Assert.Equal("1080p BluRay", links[1].ParentGroupName);
        Assert.Equal("1080p BluRay x265 10bit", links[2].ParentGroupName);
    }

    [Fact]
    public void ParseDirectoryHtml_Keeps_Dotted_Format_Directory_In_File_Url()
    {
        const string html = """
<html><body>
  <table><tbody>
    <tr>
      <td class="n">
        <a href="Breaking.Bad.S01E01.1080p.BluRay.SoftSub.Unknown.DonyayeSerial.mkv">
          Breaking.Bad.S01E01.1080p.BluRay.SoftSub.Unknown.DonyayeSerial.mkv
        </a>
      </td>
      <td class="s">1.02G</td>
    </tr>
  </tbody></table>
</body></html>
""";

        var resolver = new DirectoryDownloadResolver(new TestHttpClientFactory());
        var links = resolver.ParseDirectoryHtml(
            html,
            "https://dls7.iran-onemovies-dcenter.com/DonyayeSerial/series2/tt0903747/SoftSub/S01/1080p.BluRay");

        var link = Assert.Single(links);
        Assert.Equal(
            "https://dls7.iran-onemovies-dcenter.com/DonyayeSerial/series2/tt0903747/SoftSub/S01/1080p.BluRay/Breaking.Bad.S01E01.1080p.BluRay.SoftSub.Unknown.DonyayeSerial.mkv",
            link.Url);
    }

    private sealed class TestHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }
}
