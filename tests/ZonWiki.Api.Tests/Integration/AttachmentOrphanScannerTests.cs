using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ZonWiki.Api.Attachments;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Api.Tests.Integration;

/// <summary>
/// 孤兒附件掃描器整合測試（真 PostgreSQL；直接呼叫 <see cref="AttachmentOrphanScanner.ScanOnceAsync"/>）。
/// 驗證：被 Note / NoteRevision / NoteOverlayItem 引用者不動（含大寫 GUID、含軟刪除筆記）、
/// 未引用＋超過寬限期者軟刪除（檔案保留）、寬限期內者不動。
/// </summary>
[Collection(ApiIntegrationCollection.Name)]
public sealed class AttachmentOrphanScannerTests(ZonWikiApiFactory factory)
{
    /// <summary>
    /// 種一列附件（直接寫 DB，不經上傳端點；可指定要不要在磁碟放對應檔案）。
    /// </summary>
    /// <param name="userId">擁有者。</param>
    /// <param name="withDiskFile">是否同時在附件根目錄放一個實體檔（驗證掃描不刪檔用）。</param>
    /// <returns>附件 Id 與磁碟路徑（無檔案時為 null）。</returns>
    private async Task<(Guid Id, string? FullPath)> SeedAttachmentAsync(Guid userId, bool withDiskFile = false)
    {
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var attachment = new NoteAttachment
            {
                UserId = userId,
                FileName = "seeded.webp",
                FilePath = $"{userId:N}/{Guid.NewGuid():N}.webp",
                ContentType = "image/webp",
                FileSizeBytes = 123,
                Width = 1,
                Height = 1,
                CreatedUser = "test",
                UpdatedUser = "test",
            };
            db.NoteAttachment.Add(attachment);
            await db.SaveChangesAsync();

            string? fullPath = null;
            if (withDiskFile)
            {
                fullPath = Path.Combine(factory.AttachmentRootPath, attachment.FilePath);
                Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
                await File.WriteAllBytesAsync(fullPath, [1, 2, 3]);
            }
            return (attachment.Id, fullPath);
        }
    }

    /// <summary>
    /// 把附件的建立時間回填到過去（繞過稽核攔截器），使其超過孤兒寬限期。
    /// </summary>
    /// <param name="attachmentId">附件 Id。</param>
    /// <param name="days">往回推的天數。</param>
    private async Task BackdateAsync(Guid attachmentId, int days)
    {
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var backdated = DateTime.UtcNow.AddDays(-days);
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"""UPDATE "NoteAttachment" SET "NoteAttachment_CreatedDateTime" = {backdated} WHERE "NoteAttachment_Id" = {attachmentId}""");
        }
    }

    /// <summary>
    /// 讀回附件列（略過全域過濾）。
    /// </summary>
    private async Task<NoteAttachment?> LoadAsync(Guid attachmentId)
    {
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            return await db.NoteAttachment.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == attachmentId);
        }
    }

    /// <summary>
    /// 執行一輪掃描。
    /// </summary>
    private Task<int> ScanAsync() =>
        factory.Services.GetRequiredService<AttachmentOrphanScanner>()
            .ScanOnceAsync(CancellationToken.None);

    /// <summary>
    /// 種一篇引用指定附件的筆記。
    /// </summary>
    /// <param name="userId">筆記擁有者。</param>
    /// <param name="attachmentId">被引用的附件。</param>
    /// <param name="uppercase">是否以大寫 GUID 形式引用（驗證大小寫不敏感比對）。</param>
    /// <param name="softDeleted">筆記是否為軟刪除狀態（垃圾桶）。</param>
    private async Task SeedReferencingNoteAsync(
        Guid userId, Guid attachmentId, bool uppercase = false, bool softDeleted = false)
    {
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var idText = uppercase ? attachmentId.ToString("D").ToUpperInvariant() : attachmentId.ToString("D");
            db.Note.Add(new Note
            {
                UserId = userId,
                Title = "引用附件的筆記",
                Slug = $"ref-{Guid.NewGuid():N}",
                ContentRaw = $"前文\n\n![圖片](/api/attachments/{idText})\n\n後文",
                ValidFlag = !softDeleted,
                DeletedDateTime = softDeleted ? DateTime.UtcNow : null,
                CreatedUser = "test",
                UpdatedUser = "test",
            });
            await db.SaveChangesAsync();
        }
    }

    [Fact]
    public async Task Scan_UnreferencedAndPastGrace_SoftDeletesButKeepsFile()
    {
        // Arrange：未被任何內容引用、建立於 3 天前（> 48h 寬限）、磁碟有檔
        var userId = (await factory.SeedUserWithTokenAsync($"orphan-old-{Guid.NewGuid():N}@test.local")).UserId;
        var (id, fullPath) = await SeedAttachmentAsync(userId, withDiskFile: true);
        await BackdateAsync(id, days: 3);

        // Act
        await ScanAsync();

        // Assert：DB 軟刪除、磁碟檔案保留（鐵則：絕不硬刪）
        var row = await LoadAsync(id);
        row!.ValidFlag.Should().BeFalse("超過寬限期的未引用附件應被軟刪除");
        row.DeletedDateTime.Should().NotBeNull();
        row.UpdatedUser.Should().Be("system:attachment-orphan");
        File.Exists(fullPath!).Should().BeTrue("軟刪除絕不能動磁碟檔案（可復原原則）");
    }

    [Fact]
    public async Task Scan_UnreferencedButWithinGrace_IsUntouched()
    {
        // Arrange：未引用、但剛建立（在 48h 寬限期內）
        var userId = (await factory.SeedUserWithTokenAsync($"orphan-new-{Guid.NewGuid():N}@test.local")).UserId;
        var (id, _) = await SeedAttachmentAsync(userId);

        // Act
        await ScanAsync();

        // Assert
        (await LoadAsync(id))!.ValidFlag.Should().BeTrue("寬限期內不可清（筆記可能還沒存）");
    }

    [Fact]
    public async Task Scan_ReferencedByNoteContent_IsUntouched()
    {
        // Arrange：超過寬限期、但被筆記內文引用
        var userId = (await factory.SeedUserWithTokenAsync($"orphan-ref-{Guid.NewGuid():N}@test.local")).UserId;
        var (id, _) = await SeedAttachmentAsync(userId);
        await SeedReferencingNoteAsync(userId, id);
        await BackdateAsync(id, days: 3);

        // Act
        await ScanAsync();

        // Assert
        (await LoadAsync(id))!.ValidFlag.Should().BeTrue("被引用的附件絕不可清");
    }

    [Fact]
    public async Task Scan_ReferencedWithUppercaseGuid_IsUntouched()
    {
        // Arrange：內容以「大寫 GUID」引用（使用者手動編輯貼上的情境）
        var userId = (await factory.SeedUserWithTokenAsync($"orphan-upper-{Guid.NewGuid():N}@test.local")).UserId;
        var (id, _) = await SeedAttachmentAsync(userId);
        await SeedReferencingNoteAsync(userId, id, uppercase: true);
        await BackdateAsync(id, days: 3);

        // Act
        await ScanAsync();

        // Assert
        (await LoadAsync(id))!.ValidFlag.Should().BeTrue("ILIKE 比對必須大小寫不敏感，不可誤殺");
    }

    [Fact]
    public async Task Scan_ReferencedBySoftDeletedNote_IsUntouched()
    {
        // Arrange：只被「垃圾桶內（軟刪除）的筆記」引用——筆記可還原，附件必須保留
        var userId = (await factory.SeedUserWithTokenAsync($"orphan-trash-{Guid.NewGuid():N}@test.local")).UserId;
        var (id, _) = await SeedAttachmentAsync(userId);
        await SeedReferencingNoteAsync(userId, id, softDeleted: true);
        await BackdateAsync(id, days: 3);

        // Act
        await ScanAsync();

        // Assert
        (await LoadAsync(id))!.ValidFlag.Should().BeTrue("垃圾桶筆記可還原，其引用的附件不可清");
    }

    [Fact]
    public async Task Scan_ReferencedByNoteRevisionOnly_IsUntouched()
    {
        // Arrange：現行內文已無引用、但編輯歷史（NoteRevision）仍有——還原歷史版本必須看得到圖
        var userId = (await factory.SeedUserWithTokenAsync($"orphan-rev-{Guid.NewGuid():N}@test.local")).UserId;
        var (id, _) = await SeedAttachmentAsync(userId);
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var note = new Note
            {
                UserId = userId,
                Title = "已移除圖片的筆記",
                Slug = $"rev-{Guid.NewGuid():N}",
                ContentRaw = "圖片已從現行內文移除",
                CreatedUser = "test",
                UpdatedUser = "test",
            };
            db.Note.Add(note);
            db.NoteRevision.Add(new NoteRevision
            {
                UserId = userId,
                NoteId = note.Id,
                RevisionNo = 1,
                ChangeKind = "update",
                Title = note.Title,
                ContentRaw = $"舊版本還有圖：![圖片](/api/attachments/{id:D})",
                CreatedUser = "test",
                UpdatedUser = "test",
            });
            await db.SaveChangesAsync();
        }
        await BackdateAsync(id, days: 3);

        // Act
        await ScanAsync();

        // Assert
        (await LoadAsync(id))!.ValidFlag.Should().BeTrue("編輯歷史引用也算引用（版本還原要看得到圖）");
    }

    [Fact]
    public async Task Scan_ReferencedByTaskCardContentOnly_IsUntouched()
    {
        // Arrange：任務卡內容也用同一個 Markdown 編輯器貼圖 → 任務引用也算引用
        var userId = (await factory.SeedUserWithTokenAsync($"orphan-task-{Guid.NewGuid():N}@test.local")).UserId;
        var (id, _) = await SeedAttachmentAsync(userId);
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            db.TaskCard.Add(new TaskCard
            {
                UserId = userId,
                Title = "有貼圖的任務",
                Content = $"步驟示意：![圖片](/api/attachments/{id:D})",
                CreatedUser = "test",
                UpdatedUser = "test",
            });
            await db.SaveChangesAsync();
        }
        await BackdateAsync(id, days: 3);

        // Act
        await ScanAsync();

        // Assert
        (await LoadAsync(id))!.ValidFlag.Should().BeTrue("任務卡內容引用也算引用");
    }

    [Fact]
    public async Task Scan_ReferencedByCanvasNodeOnly_IsUntouched()
    {
        // Arrange：畫布節點內容引用（節點編輯器同樣共用 Markdown 編輯器）
        var userId = (await factory.SeedUserWithTokenAsync($"orphan-node-{Guid.NewGuid():N}@test.local")).UserId;
        var (id, _) = await SeedAttachmentAsync(userId);
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var canvas = new Canvas
            {
                UserId = userId,
                Title = "測試畫布",
                CreatedUser = "test",
                UpdatedUser = "test",
            };
            db.Canvas.Add(canvas);
            db.Node.Add(new Node
            {
                UserId = userId,
                CanvasId = canvas.Id,
                Title = "有貼圖的節點",
                Content = $"![圖片](/api/attachments/{id:D})",
                CreatedUser = "test",
                UpdatedUser = "test",
            });
            await db.SaveChangesAsync();
        }
        await BackdateAsync(id, days: 3);

        // Act
        await ScanAsync();

        // Assert
        (await LoadAsync(id))!.ValidFlag.Should().BeTrue("畫布節點內容引用也算引用");
    }

    [Fact]
    public async Task Scan_ReferencedByOverlaySlideOnly_IsUntouched()
    {
        // Arrange：只被浮層圖片輪播（NoteOverlayItem.DataJson）引用
        var userId = (await factory.SeedUserWithTokenAsync($"orphan-slide-{Guid.NewGuid():N}@test.local")).UserId;
        var (id, _) = await SeedAttachmentAsync(userId);
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var note = new Note
            {
                UserId = userId,
                Title = "有輪播的筆記",
                Slug = $"slide-{Guid.NewGuid():N}",
                ContentRaw = "內文無圖",
                CreatedUser = "test",
                UpdatedUser = "test",
            };
            db.Note.Add(note);
            db.NoteOverlayItem.Add(new NoteOverlayItem
            {
                UserId = userId,
                NoteId = note.Id,
                Kind = "slide",
                DataJson = $"[\"/api/attachments/{id:D}\"]",
                CreatedUser = "test",
                UpdatedUser = "test",
            });
            await db.SaveChangesAsync();
        }
        await BackdateAsync(id, days: 3);

        // Act
        await ScanAsync();

        // Assert
        (await LoadAsync(id))!.ValidFlag.Should().BeTrue("浮層輪播引用也算引用");
    }

    [Fact]
    public async Task Scan_ReferencedByQuestionAnswerOnly_IsUntouched()
    {
        // Arrange：只被「問題的回答」（NoteOverlayItem.QuestionAnswer，Markdown 內容）引用——
        // 答題彈窗的回答區用同一個 Markdown 編輯器，同樣能貼圖，故回答引用也必須算引用。
        var userId = (await factory.SeedUserWithTokenAsync($"orphan-answer-{Guid.NewGuid():N}@test.local")).UserId;
        var (id, _) = await SeedAttachmentAsync(userId);
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var note = new Note
            {
                UserId = userId,
                Title = "有問題便利貼的筆記",
                Slug = $"answer-{Guid.NewGuid():N}",
                ContentRaw = "內文無圖",
                CreatedUser = "test",
                UpdatedUser = "test",
            };
            db.Note.Add(note);
            db.NoteOverlayItem.Add(new NoteOverlayItem
            {
                UserId = userId,
                NoteId = note.Id,
                Kind = "sticky",
                Text = "這是一個問題？",
                IsQuestion = true,
                QuestionAnswer = $"回答內文\n\n![圖片](/api/attachments/{id:D})",
                CreatedUser = "test",
                UpdatedUser = "test",
            });
            await db.SaveChangesAsync();
        }
        await BackdateAsync(id, days: 3);

        // Act
        await ScanAsync();

        // Assert
        (await LoadAsync(id))!.ValidFlag.Should().BeTrue("問題回答引用也算引用（回答可貼圖）");
    }

    [Fact]
    public async Task Scan_ReferencedByStickyTextOnly_IsUntouched()
    {
        // Arrange：只被「便利貼／文字框本文」（NoteOverlayItem.Text）引用——
        // 本文以 Markdown 渲染（StickyBody 用 ReactMarkdown），使用者可手貼附件短網址正常顯圖，
        // 故本文引用也必須算引用（對抗式復審 2026-07-10 指出的缺口）。
        var userId = (await factory.SeedUserWithTokenAsync($"orphan-stickytext-{Guid.NewGuid():N}@test.local")).UserId;
        var (id, _) = await SeedAttachmentAsync(userId);
        var (scope, db) = factory.CreateDbScope();
        using (scope)
        {
            var note = new Note
            {
                UserId = userId,
                Title = "有貼圖便利貼的筆記",
                Slug = $"stickytext-{Guid.NewGuid():N}",
                ContentRaw = "內文無圖",
                CreatedUser = "test",
                UpdatedUser = "test",
            };
            db.Note.Add(note);
            db.NoteOverlayItem.Add(new NoteOverlayItem
            {
                UserId = userId,
                NoteId = note.Id,
                Kind = "sticky",
                Text = $"便利貼本文\n\n![圖片](/api/attachments/{id:D})",
                CreatedUser = "test",
                UpdatedUser = "test",
            });
            await db.SaveChangesAsync();
        }
        await BackdateAsync(id, days: 3);

        // Act
        await ScanAsync();

        // Assert
        (await LoadAsync(id))!.ValidFlag.Should().BeTrue("便利貼／文字框本文引用也算引用（本文以 Markdown 渲染可顯圖）");
    }
}
