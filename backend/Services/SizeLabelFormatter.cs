using System.Text.RegularExpressions;

namespace MovieCrawler.Backend;

public static class SizeLabelFormatter
{
    private static readonly Regex CompactUnitRegex = new(@"(\d+(?:\.\d+)?)\s*([kKmMgGtT])\b", RegexOptions.Compiled);

    public static string? Format(string? sizeRaw)
    {
        if (string.IsNullOrWhiteSpace(sizeRaw))
        {
            return null;
        }

        var normalized = sizeRaw.Trim();
        return CompactUnitRegex.Replace(normalized, match =>
        {
            var value = match.Groups[1].Value;
            var unit = match.Groups[2].Value.ToUpperInvariant();
            return unit switch
            {
                "K" => $"{value} KB",
                "M" => $"{value} MB",
                "G" => $"{value} GB",
                "T" => $"{value} TB",
                _ => match.Value
            };
        });
    }
}
