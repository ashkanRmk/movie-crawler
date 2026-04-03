using System.Security.Claims;

namespace MovieCrawler.Backend;

public static class AuthExtensions
{
    public static int? GetUserId(this ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? principal.FindFirstValue(ClaimTypes.Name)
            ?? principal.FindFirstValue("sub");

        return int.TryParse(value, out var id) ? id : null;
    }
}
