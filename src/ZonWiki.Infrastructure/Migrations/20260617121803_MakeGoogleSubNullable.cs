using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class MakeGoogleSubNullable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_User_GoogleSub",
                table: "User");

            migrationBuilder.AlterColumn<string>(
                name: "User_GoogleSub",
                table: "User",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255);

            // 既有本機帳號的 GoogleSub 是空字串，改為 NULL（語意正確且不佔用唯一索引）。
            migrationBuilder.Sql("UPDATE \"User\" SET \"User_GoogleSub\" = NULL WHERE \"User_GoogleSub\" = '';");

            migrationBuilder.CreateIndex(
                name: "UX_User_GoogleSub",
                table: "User",
                column: "User_GoogleSub",
                unique: true,
                filter: "\"User_GoogleSub\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_User_GoogleSub",
                table: "User");

            migrationBuilder.AlterColumn<string>(
                name: "User_GoogleSub",
                table: "User",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "UX_User_GoogleSub",
                table: "User",
                column: "User_GoogleSub",
                unique: true);
        }
    }
}
