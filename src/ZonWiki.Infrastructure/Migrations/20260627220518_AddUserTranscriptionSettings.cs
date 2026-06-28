using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddUserTranscriptionSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "User_GroqApiKeyEncrypted",
                table: "User",
                type: "character varying(1024)",
                maxLength: 1024,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "User_TranscriptionEngine",
                table: "User",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "gemini");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "User_GroqApiKeyEncrypted",
                table: "User");

            migrationBuilder.DropColumn(
                name: "User_TranscriptionEngine",
                table: "User");
        }
    }
}
