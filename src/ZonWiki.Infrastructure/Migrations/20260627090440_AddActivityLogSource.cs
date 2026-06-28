using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddActivityLogSource : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ActivityLog_Source",
                table: "ActivityLog",
                type: "character varying(128)",
                maxLength: 128,
                nullable: false,
                defaultValue: "web");

            migrationBuilder.CreateIndex(
                name: "IX_ActivityLog_UserId_Source_CreatedDateTime",
                table: "ActivityLog",
                columns: new[] { "ActivityLog_UserId", "ActivityLog_Source", "ActivityLog_CreatedDateTime" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ActivityLog_UserId_Source_CreatedDateTime",
                table: "ActivityLog");

            migrationBuilder.DropColumn(
                name: "ActivityLog_Source",
                table: "ActivityLog");
        }
    }
}
