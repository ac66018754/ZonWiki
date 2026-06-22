using Microsoft.EntityFrameworkCore;
using ZonWiki.Domain.Entities;
using ZonWiki.Infrastructure.Persistence;

namespace ZonWiki.Infrastructure.Auth;

public sealed class UserProvisioningService(ZonWikiDbContext db)
{
    public async Task<User> EnsureUserAsync(
        string googleSub,
        string email,
        string displayName,
        string? avatarUrl,
        CancellationToken cancellationToken)
    {
        var user = await db.User
            .FirstOrDefaultAsync(u => u.GoogleSub == googleSub, cancellationToken);

        if (user is null)
        {
            user = new User
            {
                GoogleSub = googleSub,
                Email = email,
                DisplayName = displayName,
                AvatarUrl = avatarUrl,
            };
            db.User.Add(user);
        }
        else
        {
            user.Email = email;
            user.DisplayName = displayName;
            user.AvatarUrl = avatarUrl;
            if (!user.ValidFlag)
            {
                user.ValidFlag = true;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        return user;
    }
}
