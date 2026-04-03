using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace MovieCrawler.Backend;

public sealed class JwtTokenService(IConfiguration configuration)
{
    private readonly string _issuer = configuration["Auth:Issuer"] ?? "movie-crawler";
    private readonly string _audience = configuration["Auth:Audience"] ?? "movie-crawler-clients";
    private readonly string _secret = configuration["Auth:JwtKey"] ?? "replace-this-with-a-long-random-key";
    private readonly int _expireDays = int.TryParse(configuration["Auth:ExpireDays"], out var days) ? Math.Max(1, days) : 30;

    public TokenIssueResult Issue(UserEntity user)
    {
        var now = DateTimeOffset.UtcNow;
        var expiresAt = now.AddDays(_expireDays);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.MobilePhone, user.Mobile),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N"))
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var jwt = new JwtSecurityToken(
            issuer: _issuer,
            audience: _audience,
            claims: claims,
            notBefore: now.UtcDateTime,
            expires: expiresAt.UtcDateTime,
            signingCredentials: creds);

        var token = new JwtSecurityTokenHandler().WriteToken(jwt);
        return new TokenIssueResult
        {
            Token = token,
            ExpiresAt = expiresAt
        };
    }
}
