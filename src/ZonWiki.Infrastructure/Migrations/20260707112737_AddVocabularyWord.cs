using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddVocabularyWord : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "VocabularyWord",
                columns: table => new
                {
                    VocabularyWord_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VocabularyWord_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    VocabularyWord_Word = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    VocabularyWord_Phonetic = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    VocabularyWord_PartOfSpeech = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    VocabularyWord_DefinitionEn = table.Column<string>(type: "text", nullable: true),
                    VocabularyWord_DefinitionZh = table.Column<string>(type: "text", nullable: true),
                    VocabularyWord_ExampleSentence = table.Column<string>(type: "text", nullable: true),
                    VocabularyWord_SourceNoteId = table.Column<Guid>(type: "uuid", nullable: true),
                    VocabularyWord_Due = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    VocabularyWord_Stability = table.Column<double>(type: "double precision", nullable: false),
                    VocabularyWord_Difficulty = table.Column<double>(type: "double precision", nullable: false),
                    VocabularyWord_State = table.Column<int>(type: "integer", nullable: false),
                    VocabularyWord_Reps = table.Column<int>(type: "integer", nullable: false),
                    VocabularyWord_Lapses = table.Column<int>(type: "integer", nullable: false),
                    VocabularyWord_LastReviewDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VocabularyWord_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    VocabularyWord_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    VocabularyWord_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    VocabularyWord_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    VocabularyWord_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    VocabularyWord_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VocabularyWord_PurgedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VocabularyWord", x => x.VocabularyWord_Id);
                    table.ForeignKey(
                        name: "FK_VocabularyWord_Note_SourceNoteId",
                        column: x => x.VocabularyWord_SourceNoteId,
                        principalTable: "Note",
                        principalColumn: "Note_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_VocabularyWord_SourceNoteId",
                table: "VocabularyWord",
                column: "VocabularyWord_SourceNoteId");

            migrationBuilder.CreateIndex(
                name: "IX_VocabularyWord_UserId_Due_ValidFlag",
                table: "VocabularyWord",
                columns: new[] { "VocabularyWord_UserId", "VocabularyWord_Due", "VocabularyWord_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "UX_VocabularyWord_UserId_Word",
                table: "VocabularyWord",
                columns: new[] { "VocabularyWord_UserId", "VocabularyWord_Word" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "VocabularyWord");
        }
    }
}
