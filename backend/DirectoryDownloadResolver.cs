using System.Text.RegularExpressions;
using HtmlAgilityPack;

namespace MovieCrawler.Backend;

public interface IDirectoryDownloadResolver
{
    Task<List<ResolvedDirectoryLinks>> ResolveAsync(IEnumerable<string> urls, CancellationToken cancellationToken);
}

public sealed class DirectoryDownloadResolver(IHttpClientFactory httpClientFactory) : IDirectoryDownloadResolver
{
    private static readonly Regex MultiSpaceRegex = new(@"\s+", RegexOptions.Compiled);
    private static readonly Regex SeasonEpisodeRegex = new(@"[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})", RegexOptions.Compiled);
    private static readonly Regex ResolutionRegex = new(@"\b(2160p|1080p|720p|480p)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex SourceRegex = new(@"\b(BluRay|WEB[-_. ]?DL|WEB[-_. ]?Rip|HDRip|DVDRip|BRRip)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex BitDepthRegex = new(@"\b(10bit|8bit)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly HashSet<string> VideoExtensions =
    [
        ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".m2ts", ".webm", ".flv", ".mpeg", ".mpg"
    ];
    private static readonly string[] CodecTokens = ["x264", "x265", "h264", "h265", "hevc", "av1"];
    private const int MaxParallelResolutions = 24;

    public async Task<List<ResolvedDirectoryLinks>> ResolveAsync(IEnumerable<string> urls, CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient("catalog");
        var normalizedUrls = urls
            .Select(url => (url ?? string.Empty).Trim())
            .Where(url => !string.IsNullOrWhiteSpace(url))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var parallelism = Math.Min(MaxParallelResolutions, Math.Max(1, normalizedUrls.Count));
        using var semaphore = new SemaphoreSlim(parallelism);
        var tasks = normalizedUrls.Select(async url =>
        {
            await semaphore.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                using var response = await client.GetAsync(
                    url,
                    HttpCompletionOption.ResponseHeadersRead,
                    cancellationToken).ConfigureAwait(false);
                if (!response.IsSuccessStatusCode)
                {
                    return new ResolvedDirectoryLinks
                    {
                        Url = url,
                        Error = $"Directory request failed ({(int)response.StatusCode})."
                    };
                }

                var html = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
                var links = ParseDirectoryHtml(html, url);

                return new ResolvedDirectoryLinks
                {
                    Url = url,
                    Links = links
                };
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                return new ResolvedDirectoryLinks
                {
                    Url = url,
                    Error = ex.Message
                };
            }
            finally
            {
                semaphore.Release();
            }
        });

        var results = await Task.WhenAll(tasks).ConfigureAwait(false);
        return results.ToList();
    }

    public List<DownloadLink> ParseDirectoryHtml(string html, string sourceUrl)
    {
        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        var baseUri = Uri.TryCreate(sourceUrl, UriKind.Absolute, out var parsedBaseUri)
            ? parsedBaseUri
            : null;

        var rows = doc.DocumentNode.SelectNodes("//tbody/tr") ?? doc.DocumentNode.SelectNodes("//tr");
        if (rows is null)
        {
            return [];
        }

        var links = new List<DownloadLink>();
        foreach (var row in rows)
        {
            var anchor = row.SelectSingleNode(".//td[contains(@class,'n')]//a[@href]")
                ?? row.SelectSingleNode(".//a[@href]");
            if (anchor is null)
            {
                continue;
            }

            var href = anchor.GetAttributeValue("href", string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(href))
            {
                continue;
            }

            var label = Normalize(anchor.InnerText);
            if (label.Contains("Parent Directory", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!TryResolveUrl(baseUri, href, out var absoluteUrl))
            {
                continue;
            }

            if (IsDirectoryUrl(absoluteUrl, label))
            {
                continue;
            }

            if (!IsVideoFileUrl(absoluteUrl))
            {
                continue;
            }

            var sizeRaw = Normalize(row.SelectSingleNode(".//td[contains(@class,'s')]")?.InnerText ?? string.Empty);
            var size = string.IsNullOrWhiteSpace(sizeRaw) || sizeRaw == "-" ? null : sizeRaw;
            var effectiveLabel = string.IsNullOrWhiteSpace(label)
                ? GetFileName(absoluteUrl)
                : label;
            var fileName = GetFileName(absoluteUrl);
            var (seasonNumber, episodeNumber) = ParseSeasonEpisode(fileName);
            var parentGroupName = BuildParentGroupName(absoluteUrl, fileName);

            links.Add(new DownloadLink
            {
                Label = effectiveLabel,
                Url = absoluteUrl,
                Size = size,
                ParentGroupName = parentGroupName,
                SeasonNumber = seasonNumber,
                EpisodeNumber = episodeNumber
            });
        }

        return links
            .GroupBy(link => link.Url, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();
    }

    private static bool TryResolveUrl(Uri? baseUri, string href, out string absoluteUrl)
    {
        absoluteUrl = string.Empty;
        if (Uri.TryCreate(href, UriKind.Absolute, out var absoluteUri))
        {
            absoluteUrl = absoluteUri.ToString();
            return true;
        }

        if (baseUri is null || !Uri.TryCreate(baseUri, href, out var relativeUri))
        {
            return false;
        }

        absoluteUrl = relativeUri.ToString();
        return true;
    }

    private static string GetFileName(string url)
    {
        return Uri.TryCreate(url, UriKind.Absolute, out var uri)
            ? Path.GetFileName(uri.AbsolutePath)
            : url;
    }

    private static (int? SeasonNumber, int? EpisodeNumber) ParseSeasonEpisode(string fileName)
    {
        var match = SeasonEpisodeRegex.Match(fileName);
        if (!match.Success)
        {
            return (null, null);
        }

        var season = int.TryParse(match.Groups[1].Value, out var parsedSeason) ? parsedSeason : (int?)null;
        var episode = int.TryParse(match.Groups[2].Value, out var parsedEpisode) ? parsedEpisode : (int?)null;
        return (season, episode);
    }

    private static string? BuildParentGroupName(string absoluteUrl, string fileName)
    {
        var fromFileName = BuildGroupFromFileName(fileName);
        if (!string.IsNullOrWhiteSpace(fromFileName))
        {
            return fromFileName;
        }

        if (!Uri.TryCreate(absoluteUrl, UriKind.Absolute, out var uri))
        {
            return null;
        }

        var segments = uri.AbsolutePath
            .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length < 2)
        {
            return null;
        }

        var parent = NormalizeDirectoryToken(segments[^2]);
        if (string.IsNullOrWhiteSpace(parent))
        {
            return null;
        }

        var codec = DetectCodec(fileName);
        if (string.IsNullOrWhiteSpace(codec) || parent.Contains(codec, StringComparison.OrdinalIgnoreCase))
        {
            return parent;
        }

        var bitDepth = DetectBitDepth(fileName);
        if (string.IsNullOrWhiteSpace(bitDepth) || parent.Contains(bitDepth, StringComparison.OrdinalIgnoreCase))
        {
            return $"{parent} {codec}";
        }

        return $"{parent} {codec} {bitDepth}";
    }

    private static string? BuildGroupFromFileName(string fileName)
    {
        var normalizedFileName = NormalizeDirectoryToken(Path.GetFileNameWithoutExtension(fileName));
        if (string.IsNullOrWhiteSpace(normalizedFileName))
        {
            return null;
        }

        var resolution = ResolutionRegex.Match(normalizedFileName).Success
            ? ResolutionRegex.Match(normalizedFileName).Groups[1].Value
            : null;
        var source = SourceRegex.Match(normalizedFileName).Success
            ? NormalizeSource(SourceRegex.Match(normalizedFileName).Groups[1].Value)
            : null;

        if (string.IsNullOrWhiteSpace(resolution) && string.IsNullOrWhiteSpace(source))
        {
            return null;
        }

        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(resolution))
        {
            parts.Add(resolution);
        }

        if (!string.IsNullOrWhiteSpace(source))
        {
            parts.Add(source);
        }

        var codec = DetectCodec(normalizedFileName);
        if (!string.IsNullOrWhiteSpace(codec))
        {
            parts.Add(codec);
        }

        var bitDepth = DetectBitDepth(normalizedFileName);
        if (!string.IsNullOrWhiteSpace(bitDepth))
        {
            parts.Add(bitDepth);
        }

        return string.Join(' ', parts);
    }

    private static string NormalizeSource(string source)
    {
        var compact = source.Replace(" ", string.Empty).Replace("_", string.Empty).Replace(".", string.Empty);
        if (compact.Equals("BluRay", StringComparison.OrdinalIgnoreCase))
        {
            return "BluRay";
        }

        if (compact.Equals("WEBDL", StringComparison.OrdinalIgnoreCase))
        {
            return "WEB-DL";
        }

        if (compact.Equals("WEBRip", StringComparison.OrdinalIgnoreCase))
        {
            return "WEBRip";
        }

        if (compact.Equals("HDRip", StringComparison.OrdinalIgnoreCase))
        {
            return "HDRip";
        }

        if (compact.Equals("DVDRip", StringComparison.OrdinalIgnoreCase))
        {
            return "DVDRip";
        }

        if (compact.Equals("BRRip", StringComparison.OrdinalIgnoreCase))
        {
            return "BRRip";
        }

        return source;
    }

    private static string NormalizeDirectoryToken(string value)
    {
        var replaced = value.Replace('.', ' ').Replace('_', ' ').Replace('-', ' ');
        return Normalize(replaced);
    }

    private static string? DetectCodec(string fileName)
    {
        foreach (var token in CodecTokens)
        {
            if (fileName.Contains(token, StringComparison.OrdinalIgnoreCase))
            {
                return token;
            }
        }

        return null;
    }

    private static string? DetectBitDepth(string fileName)
    {
        var match = BitDepthRegex.Match(fileName);
        if (!match.Success)
        {
            return null;
        }

        return match.Groups[1].Value.ToLowerInvariant();
    }

    private static bool IsDirectoryUrl(string url, string label)
    {
        if (label.EndsWith("/", StringComparison.Ordinal))
        {
            return true;
        }

        return Uri.TryCreate(url, UriKind.Absolute, out var uri) &&
            uri.AbsolutePath.EndsWith("/", StringComparison.Ordinal);
    }

    private static bool IsVideoFileUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            return false;
        }

        var extension = Path.GetExtension(uri.AbsolutePath);
        return !string.IsNullOrWhiteSpace(extension) &&
            VideoExtensions.Contains(extension.ToLowerInvariant());
    }

    private static string Normalize(string value)
    {
        var decoded = HtmlEntity.DeEntitize(value ?? string.Empty).Replace('\u00A0', ' ');
        return MultiSpaceRegex.Replace(decoded, " ").Trim();
    }
}
