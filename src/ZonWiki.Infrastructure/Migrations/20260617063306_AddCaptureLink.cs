using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCaptureLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CaptureLink",
                columns: table => new
                {
                    CaptureLink_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CaptureLink_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CaptureLink_CaptureItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    CaptureLink_TargetType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CaptureLink_TargetId = table.Column<Guid>(type: "uuid", nullable: false),
                    CaptureLink_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CaptureLink_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CaptureLink_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CaptureLink_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CaptureLink_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    CaptureLink_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CaptureLink", x => x.CaptureLink_Id);
                    table.ForeignKey(
                        name: "FK_CaptureLink_CaptureItem_CaptureItemId",
                        column: x => x.CaptureLink_CaptureItemId,
                        principalTable: "CaptureItem",
                        principalColumn: "CaptureItem_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CaptureLink_CaptureItemId_TargetType",
                table: "CaptureLink",
                columns: new[] { "CaptureLink_CaptureItemId", "CaptureLink_TargetType" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CaptureLink");
        }
    }
}
