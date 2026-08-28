using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// 把 User_AvatarUrl 由 varchar(1024) 放寬為 text。
    ///
    /// 原因：這個欄位原本只放「外部頭像網址」（Google OAuth 帶回來的），1024 字元很夠；
    /// 2026-08-28 起改成放「使用者自己上傳、裁切後的圖片 data URI」（約 10~30KB），
    /// 1024 完全裝不下（實測寫入直接回 500）。放寬為 text，實際上限改由端點驗證
    /// （PUT /api/me/avatar 限 64KB），與品牌標誌 User_BrandLogoUrl 同一套做法。
    ///
    /// Up 方向（varchar → text）不會遺失資料；EF 的「可能遺失資料」警告是針對 Down 方向。
    /// </summary>
    public partial class WidenUserAvatarUrl : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "User_AvatarUrl",
                table: "User",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(1024)",
                oldMaxLength: 1024,
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "User_AvatarUrl",
                table: "User",
                type: "character varying(1024)",
                maxLength: 1024,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);
        }
    }
}
