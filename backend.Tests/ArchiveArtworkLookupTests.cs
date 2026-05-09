using System;
using System.IO;
using MovieCrawler.Backend;
using Xunit;

namespace MovieCrawler.Backend.Tests;

public sealed class ArchiveArtworkLookupTests
{
    [Fact]
    public void FindImageUrl_Matches_ImdbId_CaseInsensitively_And_Ignores_Empty_Urls()
    {
        var archivePath = WriteArchive("""
[
  { "imdb_id": "tt1234567", "image_url": "https://example.com/cover.jpg" },
  { "imdb_id": "tt7654321", "image_url": "" }
]
""");

        var lookup = new ArchiveArtworkLookup(archivePath);

        Assert.Equal("https://example.com/cover.jpg", lookup.FindImageUrl("TT1234567"));
        Assert.Null(lookup.FindImageUrl("tt7654321"));
        Assert.Null(lookup.FindImageUrl("tt0000000"));
    }

    [Fact]
    public void Enrich_Adds_ImageUrl_To_Matching_Catalog_Items()
    {
        var archivePath = WriteArchive("""
[
  { "imdb_id": "tt1234567", "image_url": "https://example.com/cover.jpg" }
]
""");
        var lookup = new ArchiveArtworkLookup(archivePath);
        var catalog = new Catalog
        {
            Meta = new CatalogMeta
            {
                FetchedAt = DateTimeOffset.Parse("2024-01-01"),
                SourceUrl = "https://source",
                ItemCount = 2
            },
            Items =
            [
                NewItem("tt1234567"),
                NewItem("tt0000000")
            ]
        };

        var enriched = lookup.Enrich(catalog);

        Assert.Equal("https://example.com/cover.jpg", enriched.Items[0].ImageUrl);
        Assert.Null(enriched.Items[1].ImageUrl);
    }

    private static CatalogItem NewItem(string imdbCode)
    {
        return new CatalogItem
        {
            Id = imdbCode,
            Title = "Sample",
            Type = TitleType.Movie,
            ImdbCode = imdbCode,
            ImdbRate = 7.5,
            ImdbVotes = 100
        };
    }

    private static string WriteArchive(string json)
    {
        var path = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid():N}.json");
        File.WriteAllText(path, json);
        return path;
    }
}
