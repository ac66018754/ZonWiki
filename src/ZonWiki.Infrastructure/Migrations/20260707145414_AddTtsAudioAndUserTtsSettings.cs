using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTtsAudioAndUserTtsSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "User_TtsSettingsJson",
                table: "User",
                type: "character varying(1024)",
                maxLength: 1024,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "TtsAudio",
                columns: table => new
                {
                    TtsAudio_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TtsAudio_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TtsAudio_NoteId = table.Column<Guid>(type: "uuid", nullable: true),
                    TtsAudio_ContentHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    TtsAudio_ScriptJson = table.Column<string>(type: "text", nullable: false),
                    TtsAudio_ChaptersJson = table.Column<string>(type: "text", nullable: true),
                    TtsAudio_Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    TtsAudio_VoiceName = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    TtsAudio_ModelKey = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    TtsAudio_FilePath = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    TtsAudio_ContentType = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    TtsAudio_DurationSeconds = table.Column<double>(type: "double precision", nullable: true),
                    TtsAudio_SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    TtsAudio_ErrorText = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    TtsAudio_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TtsAudio_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    TtsAudio_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TtsAudio_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    TtsAudio_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    TtsAudio_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    TtsAudio_PurgedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TtsAudio", x => x.TtsAudio_Id);
                    table.ForeignKey(
                        name: "FK_TtsAudio_Note_NoteId",
                        column: x => x.TtsAudio_NoteId,
                        principalTable: "Note",
                        principalColumn: "Note_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TtsAudio_NoteId",
                table: "TtsAudio",
                column: "TtsAudio_NoteId");

            migrationBuilder.CreateIndex(
                name: "IX_TtsAudio_UserId_NoteId_ValidFlag",
                table: "TtsAudio",
                columns: new[] { "TtsAudio_UserId", "TtsAudio_NoteId", "TtsAudio_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "UX_TtsAudio_UserId_ContentHash",
                table: "TtsAudio",
                columns: new[] { "TtsAudio_UserId", "TtsAudio_ContentHash" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TtsAudio");

            migrationBuilder.DropColumn(
                name: "User_TtsSettingsJson",
                table: "User");
        }
    }
}
