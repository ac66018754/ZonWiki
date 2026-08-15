using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNoteSlugAlias : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NoteSlugAlias",
                columns: table => new
                {
                    NoteSlugAlias_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteSlugAlias_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteSlugAlias_NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteSlugAlias_Slug = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    NoteSlugAlias_OriginalTitle = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    NoteSlugAlias_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteSlugAlias_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteSlugAlias_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteSlugAlias_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteSlugAlias_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    NoteSlugAlias_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    NoteSlugAlias_PurgedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteSlugAlias", x => x.NoteSlugAlias_Id);
                    table.ForeignKey(
                        name: "FK_NoteSlugAlias_Note_NoteId",
                        column: x => x.NoteSlugAlias_NoteId,
                        principalTable: "Note",
                        principalColumn: "Note_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NoteSlugAlias_NoteId",
                table: "NoteSlugAlias",
                column: "NoteSlugAlias_NoteId");

            migrationBuilder.CreateIndex(
                name: "IX_NoteSlugAlias_UserId_Slug",
                table: "NoteSlugAlias",
                columns: new[] { "NoteSlugAlias_UserId", "NoteSlugAlias_Slug" });

            migrationBuilder.CreateIndex(
                name: "UX_NoteSlugAlias_UserId_Slug_NoteId",
                table: "NoteSlugAlias",
                columns: new[] { "NoteSlugAlias_UserId", "NoteSlugAlias_Slug", "NoteSlugAlias_NoteId" },
                unique: true,
                filter: "\"NoteSlugAlias_ValidFlag\" = TRUE");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NoteSlugAlias");
        }
    }
}
