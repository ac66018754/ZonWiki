using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddEntityLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EntityLink",
                columns: table => new
                {
                    EntityLink_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityLink_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityLink_SourceType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    EntityLink_SourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityLink_TargetType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    EntityLink_TargetId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityLink_Kind = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    EntityLink_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EntityLink_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    EntityLink_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EntityLink_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    EntityLink_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    EntityLink_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EntityLink", x => x.EntityLink_Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EntityLink_UserId_SourceType_SourceId",
                table: "EntityLink",
                columns: new[] { "EntityLink_UserId", "EntityLink_SourceType", "EntityLink_SourceId" });

            migrationBuilder.CreateIndex(
                name: "IX_EntityLink_UserId_TargetType_TargetId",
                table: "EntityLink",
                columns: new[] { "EntityLink_UserId", "EntityLink_TargetType", "EntityLink_TargetId" });

            migrationBuilder.CreateIndex(
                name: "UX_EntityLink_UserId_SourceType_SourceId_TargetType_TargetId_Kind",
                table: "EntityLink",
                columns: new[] { "EntityLink_UserId", "EntityLink_SourceType", "EntityLink_SourceId", "EntityLink_TargetType", "EntityLink_TargetId", "EntityLink_Kind" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EntityLink");
        }
    }
}
