using Microsoft.EntityFrameworkCore;

namespace MovieCrawler.Backend;

public sealed class GenreCatalogService(AppDbContext db)
{
    private static readonly (string Key, string Label)[] MovieGenres =
    [
        ("action", "اکشن"),
        ("adventure", "ماجراجویی"),
        ("comedy", "کمدی"),
        ("crime", "جنایی"),
        ("drama", "درام"),
        ("family", "خانوادگی"),
        ("fantasy", "فانتزی"),
        ("horror", "ترسناک"),
        ("mystery", "معمایی"),
        ("romance", "عاشقانه"),
        ("sci-fi", "علمی تخیلی"),
        ("thriller", "هیجان انگیز")
    ];

    private static readonly (string Key, string Label)[] TvGenres =
    [
        ("action", "اکشن"),
        ("animation", "انیمیشن"),
        ("comedy", "کمدی"),
        ("crime", "جنایی"),
        ("documentary", "مستند"),
        ("drama", "درام"),
        ("family", "خانوادگی"),
        ("fantasy", "فانتزی"),
        ("mystery", "معمایی"),
        ("sci-fi", "علمی تخیلی"),
        ("talk-show", "گفتگو محور"),
        ("thriller", "هیجان انگیز")
    ];

    public async Task<List<GenreDto>> GetGenresAsync(TitleType? type, CancellationToken cancellationToken)
    {
        var titles = await db.Titles
            .AsNoTracking()
            .Select(x => new { x.Type, x.Genres })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var counts = new Dictionary<(TitleType Type, string GenreKey), int>();

        foreach (var title in titles)
        {
            var titleType = title.Type.Equals(nameof(TitleType.TvSeries), StringComparison.OrdinalIgnoreCase)
                ? TitleType.TvSeries
                : TitleType.Movie;

            var genres = SplitCsv(title.Genres).Select(ToGenreKey).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct();
            foreach (var genreKey in genres)
            {
                var key = (titleType, genreKey);
                counts[key] = counts.TryGetValue(key, out var current) ? current + 1 : 1;
            }
        }

        var output = new List<GenreDto>();
        if (type is null or TitleType.Movie)
        {
            output.AddRange(MovieGenres.Select(entry => new GenreDto
            {
                Id = $"movie:{entry.Key}",
                Label = entry.Label,
                TitleType = TitleType.Movie,
                Count = counts.TryGetValue((TitleType.Movie, entry.Key), out var count) ? count : 0
            }));
        }

        if (type is null or TitleType.TvSeries)
        {
            output.AddRange(TvGenres.Select(entry => new GenreDto
            {
                Id = $"tv:{entry.Key}",
                Label = entry.Label,
                TitleType = TitleType.TvSeries,
                Count = counts.TryGetValue((TitleType.TvSeries, entry.Key), out var count) ? count : 0
            }));
        }

        return output;
    }

    private static string ToGenreKey(string value)
    {
        var lower = value.Trim().ToLowerInvariant();
        return lower switch
        {
            "science fiction" => "sci-fi",
            "scifi" => "sci-fi",
            _ => lower
        };
    }

    private static List<string> SplitCsv(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return [];
        }

        return value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
