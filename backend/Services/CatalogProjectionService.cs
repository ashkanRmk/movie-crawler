using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MovieCrawler.Backend;

public sealed class CatalogProjectionService
{
    public Catalog BuildCatalog(
        IReadOnlyCollection<TitleEntity> titles,
        DateTimeOffset fetchedAt,
        string sourceUrl)
    {
        var items = titles
            .OrderByDescending(item => item.ImdbRate)
            .ThenBy(item => item.Title, StringComparer.OrdinalIgnoreCase)
            .Select(MapTitle)
            .ToList();

        return new Catalog
        {
            Meta = new CatalogMeta
            {
                FetchedAt = fetchedAt,
                SourceUrl = sourceUrl,
                ItemCount = items.Count
            },
            Items = items
        };
    }

    public CatalogItem MapTitle(TitleEntity entity)
    {
        var movieGroups = entity.DownloadSections
            .Where(section => section.Scope.Equals("movie", StringComparison.OrdinalIgnoreCase))
            .OrderBy(section => section.SortOrder)
            .Select(MapDownloadGroup)
            .ToList();

        var seasonGroups = entity.DownloadSections
            .Where(section => section.Scope.Equals("season", StringComparison.OrdinalIgnoreCase))
            .GroupBy(section => section.SeasonNumber ?? 1)
            .OrderBy(group => group.Key)
            .Select(group => new SeasonGroup
            {
                SeasonNumber = group.Key,
                Groups = group
                    .OrderBy(section => section.SortOrder)
                    .Select(MapDownloadGroup)
                    .ToList()
            })
            .ToList();

        return new CatalogItem
        {
            Id = entity.ImdbCode,
            Title = entity.Title,
            Year = entity.Year,
            Type = entity.Type.Equals(nameof(TitleType.TvSeries), StringComparison.OrdinalIgnoreCase)
                ? TitleType.TvSeries
                : TitleType.Movie,
            ImdbCode = entity.ImdbCode,
            ImdbRate = entity.ImdbRate,
            ImdbVotes = entity.ImdbVotes,
            IsDubbed = entity.IsDubbed,
            Summary = entity.Summary,
            Duration = entity.Duration,
            CountryOrigin = entity.CountryOrigin,
            Genres = SplitCsv(entity.Genres),
            Stars = SplitCsv(entity.Stars),
            AgeRating = entity.AgeRating,
            PosterUrl = entity.PosterUrl,
            CoverUrl = entity.CoverUrl,
            Downloads = movieGroups,
            Seasons = seasonGroups
        };
    }

    public ResolvedDirectoryLinks MapResolvedDirectory(ResolvedDirectoryEntity entity)
    {
        return new ResolvedDirectoryLinks
        {
            Url = entity.DirectoryUrl,
            Links = entity.Files
                .OrderBy(file => file.SortOrder)
                .Select(file => new DownloadLink
                {
                    Label = file.Label,
                    Url = file.AbsoluteUrl,
                    Size = SizeLabelFormatter.Format(file.SizeRaw),
                    ParentGroupName = file.ParentGroupName,
                    SeasonNumber = file.SeasonNumber,
                    EpisodeNumber = file.EpisodeNumber
                })
                .ToList()
        };
    }

    public string ComputeContentHash(CatalogItem item)
    {
        var fingerprint = new
        {
            item.ImdbCode,
            item.Title,
            item.Year,
            Type = item.Type.ToString(),
            item.ImdbRate,
            item.ImdbVotes,
            item.IsDubbed,
            item.Summary,
            item.Duration,
            item.CountryOrigin,
            item.AgeRating,
            item.PosterUrl,
            item.CoverUrl,
            item.Genres,
            item.Stars,
            Downloads = item.Downloads.Select(group => new
            {
                group.Label,
                Links = group.Links.Select(link => new
                {
                    link.Label,
                    link.Url,
                    link.Size
                })
            }),
            Seasons = item.Seasons.Select(season => new
            {
                season.SeasonNumber,
                Groups = season.Groups.Select(group => new
                {
                    group.Label,
                    Links = group.Links.Select(link => new
                    {
                        link.Label,
                        link.Url,
                        link.Size
                    })
                })
            })
        };

        var json = JsonSerializer.Serialize(fingerprint);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(json));
        return Convert.ToHexString(hash);
    }

    private static DownloadGroup MapDownloadGroup(DownloadSectionEntity section)
    {
        return new DownloadGroup
        {
            Label = section.Label,
            Links = section.Entries
                .OrderBy(entry => entry.SortOrder)
                .Select(entry => new DownloadLink
                {
                    Label = entry.Label,
                    Url = entry.AbsoluteUrl,
                    Size = SizeLabelFormatter.Format(entry.SizeRaw)
                })
                .ToList()
        };
    }

    private static List<string> SplitCsv(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return [];
        }

        return value
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
