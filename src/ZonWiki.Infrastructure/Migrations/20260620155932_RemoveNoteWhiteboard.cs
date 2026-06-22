using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class RemoveNoteWhiteboard : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WhiteboardItem");

            migrationBuilder.DropTable(
                name: "Whiteboard");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Whiteboard",
                columns: table => new
                {
                    Whiteboard_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Whiteboard_NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    Whiteboard_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Whiteboard_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    Whiteboard_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Whiteboard_Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Whiteboard_SortOrder = table.Column<int>(type: "integer", nullable: false),
                    Whiteboard_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Whiteboard_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    Whiteboard_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Whiteboard_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    Whiteboard_X = table.Column<double>(type: "double precision", nullable: false),
                    Whiteboard_Y = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Whiteboard", x => x.Whiteboard_Id);
                    table.ForeignKey(
                        name: "FK_Whiteboard_Note_NoteId",
                        column: x => x.Whiteboard_NoteId,
                        principalTable: "Note",
                        principalColumn: "Note_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WhiteboardItem",
                columns: table => new
                {
                    WhiteboardItem_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WhiteboardItem_WhiteboardId = table.Column<Guid>(type: "uuid", nullable: false),
                    WhiteboardItem_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    WhiteboardItem_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    WhiteboardItem_DataJson = table.Column<string>(type: "jsonb", nullable: false),
                    WhiteboardItem_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    WhiteboardItem_Height = table.Column<double>(type: "double precision", nullable: true),
                    WhiteboardItem_Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    WhiteboardItem_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    WhiteboardItem_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    WhiteboardItem_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    WhiteboardItem_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    WhiteboardItem_Width = table.Column<double>(type: "double precision", nullable: true),
                    WhiteboardItem_X = table.Column<double>(type: "double precision", nullable: false),
                    WhiteboardItem_Y = table.Column<double>(type: "double precision", nullable: false),
                    WhiteboardItem_ZIndex = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WhiteboardItem", x => x.WhiteboardItem_Id);
                    table.ForeignKey(
                        name: "FK_WhiteboardItem_Whiteboard_WhiteboardId",
                        column: x => x.WhiteboardItem_WhiteboardId,
                        principalTable: "Whiteboard",
                        principalColumn: "Whiteboard_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Whiteboard_NoteId",
                table: "Whiteboard",
                column: "Whiteboard_NoteId");

            migrationBuilder.CreateIndex(
                name: "IX_Whiteboard_UserId_NoteId",
                table: "Whiteboard",
                columns: new[] { "Whiteboard_UserId", "Whiteboard_NoteId" });

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardItem_WhiteboardId",
                table: "WhiteboardItem",
                column: "WhiteboardItem_WhiteboardId");
        }
    }
}
