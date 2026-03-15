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

        var series = catalog.Items[1];
        Assert.Equal(TitleType.TvSeries, series.Type);
        Assert.Single(series.Seasons);
        Assert.Equal(1, series.Seasons[0].SeasonNumber);
        Assert.Single(series.Seasons[0].Groups);
        Assert.Single(series.Seasons[0].Groups[0].Links);
    }
}
