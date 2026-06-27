using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddApiToken : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ApiToken",
                columns: table => new
                {
                    ApiToken_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ApiToken_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ApiToken_Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ApiToken_TokenHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ApiToken_TokenPrefix = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ApiToken_LastUsedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ApiToken_ExpiresDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ApiToken_Scopes = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ApiToken_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ApiToken_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ApiToken_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ApiToken_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ApiToken_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    ApiToken_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ApiToken_PurgedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ApiToken", x => x.ApiToken_Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ApiToken_UserId",
                table: "ApiToken",
                column: "ApiToken_UserId");

            migrationBuilder.CreateIndex(
                name: "UX_ApiToken_TokenHash",
                table: "ApiToken",
                column: "ApiToken_TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ApiToken");
        }
    }
}
