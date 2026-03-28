using System;
using MovieCrawler.Backend;
using Xunit;

namespace MovieCrawler.Backend.Tests;

public sealed class CatalogParserTests
{
    [Fact]
    public void Parse_Extracts_Movie_And_Series_Content()
    {
        const string html = @"
<html><body>
<h3>1. Sample Movie 2020</h3>
<p><b>IMDb Code:</b> tt1234567</p>
<p><b>Title Type:</b> movie</p>
<p><b>IMDb Votes:</b> 1,234</p>
<p><b>IMDb Rates:</b> 7.8</p>
<p style='color:#ff0000;'><b>SoftSub</b></p>
<p><a href='https://example.com/movie-1080.mkv'>1080p</a> / 1.5 GB</p>
<hr>
<h3>2. Sample Series</h3>
<p><b>IMDb Code:</b> tt7654321</p>
<p><b>Title Type:</b> tvSeries</p>
<p><b>IMDb Votes:</b> 9,876</p>
<p><b>IMDb Rates:</b> 8.9</p>
<p style='color:#ff0000;'><b>SoftSub</b></p>
<p>season 1</p>
<p><a href='https://example.com/series-s01-720'>720p</a> / </p>
<hr>
</body></html>";

        var parser = new CatalogParser();
        var catalog = parser.Parse(html, "https://source", DateTimeOffset.Parse("2024-01-01"));

        Assert.Equal(2, catalog.Items.Count);

        var movie = catalog.Items[0];
        Assert.Equal("tt1234567", movie.ImdbCode);
        Assert.Equal(2020, movie.Year);
        Assert.Single(movie.Downloads);
        Assert.Single(movie.Downloads[0].Links);
        Assert.Equal("1.5 GB", movie.Downloads[0].Links[0].Size);
        Assert.False(movie.IsDubbed);

        var series = catalog.Items[1];
        Assert.Equal(TitleType.TvSeries, series.Type);
        Assert.Single(series.Seasons);
        Assert.Equal(1, series.Seasons[0].SeasonNumber);
        Assert.Single(series.Seasons[0].Groups);
        Assert.Single(series.Seasons[0].Groups[0].Links);
        Assert.False(series.IsDubbed);
    }

    [Fact]
    public void Parse_Marks_Movie_As_Dubbed_When_Download_Group_Is_Dubbed()
    {
        const string html = @"
<html><body>
<h3>1. Dubbed Movie 2024</h3>
<p><b>IMDb Code:</b> tt2000001</p>
<p><b>Title Type:</b> movie</p>
<p><b>IMDb Votes:</b> 2,000</p>
<p><b>IMDb Rates:</b> 6.5</p>
<p><b>Dubbed</b></p>
<p><a href='https://example.com/movie-1080.mkv'>1080p</a> / 2.0 GB</p>
<hr>
</body></html>";

        var parser = new CatalogParser();
        var catalog = parser.Parse(html, "https://source", DateTimeOffset.Parse("2024-01-01"));

        Assert.Single(catalog.Items);
        Assert.True(catalog.Items[0].IsDubbed);
    }

    [Fact]
    public void Parse_Marks_Series_As_Dubbed_When_Any_Group_Is_Dubbed()
    {
        const string html = @"
<html><body>
<h3>1. Dubbed Series 2024</h3>
<p><b>IMDb Code:</b> tt2000002</p>
<p><b>Title Type:</b> tvSeries</p>
<p><b>IMDb Votes:</b> 2,500</p>
<p><b>IMDb Rates:</b> 7.4</p>
<p><b>SoftSub</b></p>
<p>season 1</p>
<p><a href='https://example.com/series-s01-720'>720p</a> / </p>
<p><b>Dual Audio</b></p>
<p>season 2</p>
<p><a href='https://example.com/series-s02-1080'>1080p</a> / </p>
<hr>
</body></html>";

        var parser = new CatalogParser();
        var catalog = parser.Parse(html, "https://source", DateTimeOffset.Parse("2024-01-01"));

        Assert.Single(catalog.Items);
        Assert.True(catalog.Items[0].IsDubbed);
    }

    [Fact]
    public void Parse_Marks_Title_As_Dubbed_When_Any_Link_Metadata_Is_Dubbed()
    {
        const string html = @"
<html><body>
<h3>1. Mixed Audio Movie 2024</h3>
<p><b>IMDb Code:</b> tt2000003</p>
<p><b>Title Type:</b> movie</p>
<p><b>IMDb Votes:</b> 3,100</p>
<p><b>IMDb Rates:</b> 8.1</p>
<p><b>SoftSub</b></p>
<p><a href='https://example.com/movie-720.mkv'>720p</a> / 1.3 GB</p>
<p><a href='https://example.com/movie-1080.mkv'>1080p Dubbed</a> / 2.1 GB</p>
<hr>
</body></html>";

        var parser = new CatalogParser();
        var catalog = parser.Parse(html, "https://source", DateTimeOffset.Parse("2024-01-01"));

        Assert.Single(catalog.Items);
        Assert.True(catalog.Items[0].IsDubbed);
    }
}
