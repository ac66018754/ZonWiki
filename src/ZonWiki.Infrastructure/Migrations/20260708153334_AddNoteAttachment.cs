using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNoteAttachment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NoteAttachment",
                columns: table => new
                {
                    NoteAttachment_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteAttachment_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteAttachment_FileName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    NoteAttachment_FilePath = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    NoteAttachment_ContentType = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    NoteAttachment_FileSizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    NoteAttachment_Width = table.Column<int>(type: "integer", nullable: false),
                    NoteAttachment_Height = table.Column<int>(type: "integer", nullable: false),
                    NoteAttachment_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteAttachment_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    NoteAttachment_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteAttachment_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    NoteAttachment_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    NoteAttachment_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    NoteAttachment_PurgedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteAttachment", x => x.NoteAttachment_Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NoteAttachment_UserId_ValidFlag",
                table: "NoteAttachment",
                columns: new[] { "NoteAttachment_UserId", "NoteAttachment_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_NoteAttachment_ValidFlag_CreatedDateTime",
                table: "NoteAttachment",
                columns: new[] { "NoteAttachment_ValidFlag", "NoteAttachment_CreatedDateTime" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NoteAttachment");
        }
    }
}
