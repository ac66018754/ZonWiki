using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskCardPlannedDateTimeIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_TaskCard_UserId_PlannedDateTime",
                table: "TaskCard",
                columns: new[] { "TaskCard_UserId", "TaskCard_PlannedDateTime" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_TaskCard_UserId_PlannedDateTime",
                table: "TaskCard");
        }
    }
}
