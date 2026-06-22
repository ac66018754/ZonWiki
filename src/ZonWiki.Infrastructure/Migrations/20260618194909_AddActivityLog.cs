using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddActivityLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ActivityLog",
                columns: table => new
                {
                    ActivityLog_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ActivityLog_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActivityLog_ActionType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ActivityLog_EntityType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ActivityLog_EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActivityLog_Title = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ActivityLog_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ActivityLog_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ActivityLog_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ActivityLog_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ActivityLog_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    ActivityLog_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ActivityLog", x => x.ActivityLog_Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ActivityLog_UserId_CreatedDateTime",
                table: "ActivityLog",
                columns: new[] { "ActivityLog_UserId", "ActivityLog_CreatedDateTime" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ActivityLog");
        }
    }
}
