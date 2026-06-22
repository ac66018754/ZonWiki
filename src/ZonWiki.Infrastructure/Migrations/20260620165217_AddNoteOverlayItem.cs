using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNoteOverlayItem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NoteOverlayItem",
                columns: table => new
                {
                    NoteOverlayItem_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteOverlayItem_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteOverlayItem_NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteOverlayItem_Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    NoteOverlayItem_X = table.Column<double>(type: "double precision", nullable: false),
                    NoteOverlayItem_Y = table.Column<double>(type: "double precision", nullable: false),
                    NoteOverlayItem_Width = table.Column<double>(type: "double precision", nullable: false),
                    NoteOverlayItem_Height = table.Column<double>(type: "double precision", nullable: false),
                    NoteOverlayItem_ZIndex = table.Column<int>(type: "integer", nullable: false),
                    NoteOverlayItem_Color = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    NoteOverlayItem_Text = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    NoteOverlayItem_DataJson = table.Column<string>(type: "text", nullable: true),
                    NoteOverlayItem_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteOverlayItem_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    NoteOverlayItem_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteOverlayItem_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    NoteOverlayItem_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    NoteOverlayItem_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteOverlayItem", x => x.NoteOverlayItem_Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NoteOverlayItem_UserId_NoteId_ValidFlag",
                table: "NoteOverlayItem",
                columns: new[] { "NoteOverlayItem_UserId", "NoteOverlayItem_NoteId", "NoteOverlayItem_ValidFlag" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NoteOverlayItem");
        }
    }
}
