using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAiSessionAiProviderModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AiSession_AiModelId",
                table: "AiSession",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AiSession_AiProvider",
                table: "AiSession",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AiSession_AiModelId",
                table: "AiSession");

            migrationBuilder.DropColumn(
                name: "AiSession_AiProvider",
                table: "AiSession");
        }
    }
}
