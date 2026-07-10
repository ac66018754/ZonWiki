using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNoteOverlayQuestion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "NoteOverlayItem_IsQuestion",
                table: "NoteOverlayItem",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "NoteOverlayItem_QuestionAnswer",
                table: "NoteOverlayItem",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "NoteOverlayItem_IsQuestion",
                table: "NoteOverlayItem");

            migrationBuilder.DropColumn(
                name: "NoteOverlayItem_QuestionAnswer",
                table: "NoteOverlayItem");
        }
    }
}
