using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ZonWiki.Domain.Entities;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

public sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.HasKey(u => u.Id);

        // GoogleSub 可為 null（本機帳號）；不再 IsRequired。
        builder.Property(u => u.GoogleSub).HasMaxLength(255);
        builder.Property(u => u.Email).IsRequired().HasMaxLength(320);
        builder.Property(u => u.DisplayName).IsRequired().HasMaxLength(255);
        // 大頭貼：原本是 varchar(1024)（只放外部網址）。2026-08-28 起改成「使用者自己上傳、
        // 裁切後的圖片 data URI」，內容約 10~30KB，1024 字元完全裝不下（實測回 500）。
        // 改為不限長度（text）；實際上限改由端點驗證（PUT /api/me/avatar 限 64KB），
        // 與品牌標誌 BrandLogoUrl 同一套做法。
        builder.Property(u => u.AvatarUrl);
        builder.Property(u => u.PasswordHash).HasMaxLength(256); // nullable，本機帳號才有值
        builder.Property(u => u.ShortcutsJson).HasMaxLength(2048); // nullable；只存與預設不同的快捷鍵覆寫 JSON
        builder.Property(u => u.TranscriptionEngine).IsRequired().HasMaxLength(16).HasDefaultValue("gemini");
        builder.Property(u => u.GroqApiKeyEncrypted).HasMaxLength(1024); // nullable；加密後的 Groq 金鑰
        builder.Property(u => u.TtsSettingsJson).HasMaxLength(1024); // nullable；TTS 偏好（聲音/語言/格式）JSON
        builder.Property(u => u.CreatedUser).IsRequired().HasMaxLength(128);
        builder.Property(u => u.UpdatedUser).IsRequired().HasMaxLength(128);

        // 唯一索引只作用在「有 GoogleSub」的列（本機帳號 GoogleSub 為 null，不參與唯一性）。
        builder.HasIndex(u => u.GoogleSub)
            .IsUnique()
            .HasFilter("\"User_GoogleSub\" IS NOT NULL");
        builder.HasIndex(u => u.Email);
    }
}
