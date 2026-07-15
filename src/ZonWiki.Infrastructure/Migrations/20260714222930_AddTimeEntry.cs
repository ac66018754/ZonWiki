using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTimeEntry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TimeEntry",
                columns: table => new
                {
                    TimeEntry_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TimeEntry_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TimeEntry_Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    TimeEntry_Category = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    TimeEntry_StartedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TimeEntry_EndedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    TimeEntry_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TimeEntry_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    TimeEntry_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TimeEntry_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    TimeEntry_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    TimeEntry_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    TimeEntry_PurgedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TimeEntry", x => x.TimeEntry_Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TimeEntry_UserId_EndedDateTime",
                table: "TimeEntry",
                columns: new[] { "TimeEntry_UserId", "TimeEntry_EndedDateTime" });

            migrationBuilder.CreateIndex(
                name: "IX_TimeEntry_UserId_StartedDateTime",
                table: "TimeEntry",
                columns: new[] { "TimeEntry_UserId", "TimeEntry_StartedDateTime" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TimeEntry");
        }
    }
}
