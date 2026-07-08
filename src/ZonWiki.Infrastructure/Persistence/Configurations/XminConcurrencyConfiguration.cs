using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ZonWiki.Infrastructure.Persistence.Configurations;

/// <summary>
/// 樂觀鎖（#4/#34）設定輔助。
/// Npgsql EF Core 10 已移除 <c>UseXminAsConcurrencyToken()</c>；改以「將影子屬性 xmin
/// 對應到 PostgreSQL 系統欄 xmin(xid)」的等價設定達成同樣效果（免新增資料欄位）。
/// xmin 為 PostgreSQL 每列的系統欄，任何 UPDATE 都會改變其值，故很適合當併發權杖。
/// </summary>
internal static class XminConcurrencyConfiguration
{
    /// <summary>
    /// xmin 影子屬性／欄位名稱（同時作為 EF 影子屬性名與資料庫欄名）。
    /// </summary>
    public const string XminPropertyName = "xmin";

    /// <summary>
    /// 為實體加上「以 PostgreSQL 系統欄 xmin 為基礎」的樂觀鎖併發權杖。
    /// 等同 Npgsql 9（含）以前的 <c>UseXminAsConcurrencyToken()</c>：
    /// 型別 uint、映射到 xmin(xid) 欄、由資料庫在新增／更新時產生值、且作為併發權杖。
    /// 因對應的是系統欄，Migration 不會（也不應）產生 AddColumn。
    /// </summary>
    /// <typeparam name="TEntity">實體型別。</typeparam>
    /// <param name="builder">EF Core 實體型別建構器。</param>
    /// <returns>原建構器（供串接）。</returns>
    public static EntityTypeBuilder<TEntity> UseXminConcurrencyToken<TEntity>(
        this EntityTypeBuilder<TEntity> builder)
        where TEntity : class
    {
        builder.Property<uint>(XminPropertyName)
            .HasColumnName(XminPropertyName)
            .HasColumnType("xid")
            .ValueGeneratedOnAddOrUpdate()
            .IsConcurrencyToken();

        return builder;
    }
}
