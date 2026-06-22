using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNoteMark : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NoteMark",
                columns: table => new
                {
                    NoteMark_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteMark_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteMark_NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteMark_Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    NoteMark_AnchorText = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    NoteMark_AnchorStart = table.Column<int>(type: "integer", nullable: false),
                    NoteMark_AnchorEnd = table.Column<int>(type: "integer", nullable: false),
                    NoteMark_AnchorPrefix = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    NoteMark_AnchorSuffix = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    NoteMark_Detached = table.Column<bool>(type: "boolean", nullable: false),
                    NoteMark_Color = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    NoteMark_TargetType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    NoteMark_TargetId = table.Column<Guid>(type: "uuid", nullable: true),
                    NoteMark_TargetUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    NoteMark_Text = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    NoteMark_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteMark_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    NoteMark_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteMark_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    NoteMark_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    NoteMark_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteMark", x => x.NoteMark_Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NoteMark_UserId_NoteId_ValidFlag",
                table: "NoteMark",
                columns: new[] { "NoteMark_UserId", "NoteMark_NoteId", "NoteMark_ValidFlag" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NoteMark");
        }
    }
}
