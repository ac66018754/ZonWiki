using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNoteOverlaySnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NoteOverlaySnapshot",
                columns: table => new
                {
                    NoteOverlaySnapshot_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteOverlaySnapshot_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteOverlaySnapshot_NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteOverlaySnapshot_SnapshotNo = table.Column<int>(type: "integer", nullable: false),
                    NoteOverlaySnapshot_ItemsJson = table.Column<string>(type: "text", nullable: false),
                    NoteOverlaySnapshot_Summary = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    NoteOverlaySnapshot_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteOverlaySnapshot_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteOverlaySnapshot_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteOverlaySnapshot_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteOverlaySnapshot_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    NoteOverlaySnapshot_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    NoteOverlaySnapshot_PurgedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteOverlaySnapshot", x => x.NoteOverlaySnapshot_Id);
                    table.ForeignKey(
                        name: "FK_NoteOverlaySnapshot_Note_NoteId",
                        column: x => x.NoteOverlaySnapshot_NoteId,
                        principalTable: "Note",
                        principalColumn: "Note_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "UX_NoteOverlaySnapshot_NoteId_SnapshotNo",
                table: "NoteOverlaySnapshot",
                columns: new[] { "NoteOverlaySnapshot_NoteId", "NoteOverlaySnapshot_SnapshotNo" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NoteOverlaySnapshot");
        }
    }
}
