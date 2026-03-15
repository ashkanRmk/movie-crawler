using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using HtmlAgilityPack;

namespace MovieCrawler.Backend;

public sealed class CatalogParser
{
    private static readonly Regex TitleRegex = new(@"^\s*\d+\.\s*(.+?)(?:\s+(\d{4}))?\s*$", RegexOptions.Compiled);
    private static readonly Regex SeasonRegex = new(@"^season\s+(\d+)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public Catalog Parse(string html, string sourceUrl, DateTimeOffset fetchedAt)
    {
        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        var body = doc.DocumentNode.SelectSingleNode("//body");
        if (body is null)
        {
            return new Catalog
            {
                Meta = new CatalogMeta
                {
                    FetchedAt = fetchedAt,
                    SourceUrl = sourceUrl,
                    ItemCount = 0
                },
                Items = []
            };
        }

        var items = new List<CatalogItem>();
        var nodes = body.ChildNodes
            .Where(n => n.NodeType == HtmlNodeType.Element)
            .ToList();

        int index = 0;
        while (index < nodes.Count)
        {
            var node = nodes[index];
            if (!node.Name.Equals("h3", StringComparison.OrdinalIgnoreCase))
            {
                index++;
                continue;
            }

            var headerText = Normalize(node.InnerText);
            var titleMatch = TitleRegex.Match(headerText);
            if (!titleMatch.Success)
            {
                index++;
                continue;
            }

            var title = titleMatch.Groups[1].Value.Trim();
            int? year = null;
            if (titleMatch.Groups[2].Success && int.TryParse(titleMatch.Groups[2].Value, out var parsedYear))
            {
                year = parsedYear;
            }

            var pNodes = new List<HtmlNode>();
            index++;
            while (index < nodes.Count)
            {
                var current = nodes[index];
                if (current.Name.Equals("hr", StringComparison.OrdinalIgnoreCase))
                {
                    index++;
                    break;
                }

                if (current.Name.Equals("h3", StringComparison.OrdinalIgnoreCase))
                {
                    break;
                }

                if (current.Name.Equals("p", StringComparison.OrdinalIgnoreCase))
                {
                    pNodes.Add(current);
                }

                index++;
            }

            var imdbCode = ExtractValue(pNodes, "IMDb Code:");
            var typeText = ExtractValue(pNodes, "Title Type:");
            var votesText = ExtractValue(pNodes, "IMDb Votes:");
            var rateText = ExtractValue(pNodes, "IMDb Rates:");

            var type = typeText.Equals("tvSeries", StringComparison.OrdinalIgnoreCase)
                ? TitleType.TvSeries
                : TitleType.Movie;

            var imdbVotes = ParseInt(votesText);
            var imdbRate = ParseDouble(rateText);

            var item = new CatalogItem
            {
                Id = imdbCode,
                Title = title,
                Year = year,
                Type = type,
                ImdbCode = imdbCode,
                ImdbRate = imdbRate,
                ImdbVotes = imdbVotes
            };

            if (type == TitleType.Movie)
            {
                ParseMovieDownloads(pNodes, item);
            }
            else
            {
                ParseSeriesDownloads(pNodes, item);
            }

            items.Add(item);
        }

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

    private static void ParseMovieDownloads(List<HtmlNode> pNodes, CatalogItem item)
    {
        DownloadGroup? currentGroup = null;
        foreach (var p in pNodes)
        {
            var bold = p.SelectSingleNode("./b");
            if (bold is not null)
            {
                var label = Normalize(bold.InnerText);
                if (!string.IsNullOrWhiteSpace(label) && !label.StartsWith("IMDb", StringComparison.OrdinalIgnoreCase))
                {
                    currentGroup = EnsureGroup(item.Downloads, label);
                    continue;
                }
            }

            var links = ExtractLinks(p);
            if (links.Count == 0)
            {
                continue;
            }

            currentGroup ??= EnsureGroup(item.Downloads, "Other");
            currentGroup.Links.AddRange(links);
        }
    }

    private static void ParseSeriesDownloads(List<HtmlNode> pNodes, CatalogItem item)
    {
        DownloadGroup? currentGroup = null;
        SeasonGroup? currentSeason = null;
        string? pendingGroupLabel = null;

        foreach (var p in pNodes)
        {
            var bold = p.SelectSingleNode("./b");
            if (bold is not null)
            {
                var label = Normalize(bold.InnerText);
                if (!string.IsNullOrWhiteSpace(label) && !label.StartsWith("IMDb", StringComparison.OrdinalIgnoreCase))
                {
                    pendingGroupLabel = label;
                    currentGroup = currentSeason is not null
                        ? EnsureGroup(currentSeason.Groups, label)
                        : null;
                    continue;
                }
            }

            var text = Normalize(p.InnerText);
            var seasonMatch = SeasonRegex.Match(text);
            if (seasonMatch.Success && int.TryParse(seasonMatch.Groups[1].Value, out var seasonNumber))
            {
                currentSeason = EnsureSeason(item.Seasons, seasonNumber);
                currentGroup = !string.IsNullOrWhiteSpace(pendingGroupLabel)
                    ? EnsureGroup(currentSeason.Groups, pendingGroupLabel)
                    : null;
                continue;
            }

            var links = ExtractLinks(p);
            if (links.Count == 0)
            {
                continue;
            }

            currentSeason ??= EnsureSeason(item.Seasons, 1);
            currentGroup ??= EnsureGroup(
                currentSeason.Groups,
                string.IsNullOrWhiteSpace(pendingGroupLabel) ? "Other" : pendingGroupLabel);
            currentGroup.Links.AddRange(links);
        }
    }

    private static string ExtractValue(IEnumerable<HtmlNode> pNodes, string prefix)
    {
        foreach (var p in pNodes)
        {
            var text = Normalize(p.InnerText);
            if (text.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                return text[prefix.Length..].Trim();
            }
        }

        return string.Empty;
    }

    private static List<DownloadLink> ExtractLinks(HtmlNode pNode)
    {
        var links = new List<DownloadLink>();
        var anchors = pNode.SelectNodes(".//a");
        if (anchors is null)
        {
            return links;
        }

        foreach (var anchor in anchors)
        {
            var url = anchor.GetAttributeValue("href", string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(url))
            {
                continue;
            }

            var label = Normalize(anchor.InnerText);
            var size = ExtractSize(anchor);

            links.Add(new DownloadLink
            {
                Label = label,
                Url = url,
                Size = string.IsNullOrWhiteSpace(size) ? null : size
            });
        }

        return links;
    }

    private static string? ExtractSize(HtmlNode anchor)
    {
        var builder = new StringBuilder();
        var node = anchor.NextSibling;
        while (node is not null)
        {
            if (node.Name.Equals("a", StringComparison.OrdinalIgnoreCase))
            {
                break;
            }

            if (node.NodeType == HtmlNodeType.Text || node.NodeType == HtmlNodeType.Element)
            {
                builder.Append(' ');
                builder.Append(node.InnerText);
            }

            node = node.NextSibling;
        }

        var raw = Normalize(builder.ToString());
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        raw = raw.Trim();
        if (raw.StartsWith("/"))
        {
            raw = raw[1..].Trim();
        }

        return raw;
    }

    private static DownloadGroup EnsureGroup(List<DownloadGroup> groups, string label)
    {
        var existing = groups.FirstOrDefault(g => g.Label.Equals(label, StringComparison.OrdinalIgnoreCase));
        if (existing is not null)
        {
            return existing;
        }

        var group = new DownloadGroup { Label = label };
        groups.Add(group);
        return group;
    }

    private static SeasonGroup EnsureSeason(List<SeasonGroup> seasons, int seasonNumber)
    {
        var existing = seasons.FirstOrDefault(s => s.SeasonNumber == seasonNumber);
        if (existing is not null)
        {
            return existing;
        }

        var season = new SeasonGroup { SeasonNumber = seasonNumber };
        seasons.Add(season);
        return season;
    }

    private static int ParseInt(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return 0;
        }

        var cleaned = text.Replace(",", string.Empty).Trim();
        return int.TryParse(cleaned, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : 0;
    }

    private static double ParseDouble(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return 0;
        }

        return double.TryParse(text.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            ? value
            : 0;
    }

    private static string Normalize(string value)
        => HtmlEntity.DeEntitize(value).Replace("\n", " ").Replace("\r", " ").Trim();
}
