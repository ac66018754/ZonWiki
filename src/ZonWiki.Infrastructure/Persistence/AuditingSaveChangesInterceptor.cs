using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence;

public sealed class AuditingSaveChangesInterceptor : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData,
        InterceptionResult<int> result)
    {
        ApplyAuditFields(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        ApplyAuditFields(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private static void ApplyAuditFields(DbContext? context)
    {
        if (context is null)
        {
            return;
        }

        var now = DateTime.UtcNow;

        // 目前使用者（供「建立時自動帶入 IUserOwned.UserId」用）。
        // 子實體（Node/Edge/Highlight…）各建立處多半不會顯式設 UserId，靠此統一補上，
        // 與其所屬 Canvas 的擁有者一致（所有建立都發生在擁有者的請求／背景情境中）。
        var currentUserId = (context as ZonWikiDbContext)?.CurrentUserId ?? Guid.Empty;

        foreach (EntityEntry<AuditableEntity> entry in context.ChangeTracker.Entries<AuditableEntity>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    if (entry.Entity.Id == Guid.Empty)
                    {
                        entry.Entity.Id = Guid.NewGuid();
                    }
                    entry.Entity.CreatedDateTime = now;
                    entry.Entity.UpdatedDateTime = now;
                    // 註：ValidFlag 預設 true 已由 AuditableEntity 欄位初始化保證，此處不需再指派。

                    // 使用者隔離：IUserOwned 實體若未明確指定擁有者，建立時自動帶入目前使用者。
                    // 已顯式設定者（如 Note/TaskCard、或刻意用共用 UserId 的系統 AI 模型）不覆寫。
                    if (entry.Entity is IUserOwned ownedToCreate
                        && ownedToCreate.UserId == Guid.Empty
                        && currentUserId != Guid.Empty)
                    {
                        ownedToCreate.UserId = currentUserId;
                    }
                    break;

                case EntityState.Modified:
                    entry.Entity.UpdatedDateTime = now;
                    entry.Property(nameof(AuditableEntity.CreatedDateTime)).IsModified = false;
                    entry.Property(nameof(AuditableEntity.CreatedUser)).IsModified = false;
                    break;
            }
        }
    }
}
