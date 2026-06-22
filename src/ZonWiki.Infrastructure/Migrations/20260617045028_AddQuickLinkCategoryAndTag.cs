using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddQuickLinkCategoryAndTag : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "QuickLink_Url",
                table: "QuickLink",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "QuickLink_UpdatedUser",
                table: "QuickLink",
                type: "character varying(128)",
                maxLength: 128,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "QuickLink_Title",
                table: "QuickLink",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "QuickLink_CreatedUser",
                table: "QuickLink",
                type: "character varying(128)",
                maxLength: 128,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddColumn<string>(
                name: "QuickLink_Category",
                table: "QuickLink",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "QuickLinkTag",
                columns: table => new
                {
                    QuickLinkTag_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    QuickLinkTag_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    QuickLinkTag_QuickLinkId = table.Column<Guid>(type: "uuid", nullable: false),
                    QuickLinkTag_TagId = table.Column<Guid>(type: "uuid", nullable: false),
                    QuickLinkTag_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    QuickLinkTag_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    QuickLinkTag_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    QuickLinkTag_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    QuickLinkTag_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    QuickLinkTag_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_QuickLinkTag", x => x.QuickLinkTag_Id);
                    table.ForeignKey(
                        name: "FK_QuickLinkTag_QuickLink_QuickLinkId",
                        column: x => x.QuickLinkTag_QuickLinkId,
                        principalTable: "QuickLink",
                        principalColumn: "QuickLink_Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_QuickLinkTag_Tag_TagId",
                        column: x => x.QuickLinkTag_TagId,
                        principalTable: "Tag",
                        principalColumn: "Tag_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_QuickLink_UserId_Category",
                table: "QuickLink",
                columns: new[] { "QuickLink_UserId", "QuickLink_Category" });

            migrationBuilder.CreateIndex(
                name: "IX_QuickLink_UserId_SortOrder",
                table: "QuickLink",
                columns: new[] { "QuickLink_UserId", "QuickLink_SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_QuickLinkTag_TagId",
                table: "QuickLinkTag",
                column: "QuickLinkTag_TagId");

            migrationBuilder.CreateIndex(
                name: "UX_QuickLinkTag_QuickLinkId_TagId",
                table: "QuickLinkTag",
                columns: new[] { "QuickLinkTag_QuickLinkId", "QuickLinkTag_TagId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "QuickLinkTag");

            migrationBuilder.DropIndex(
                name: "IX_QuickLink_UserId_Category",
                table: "QuickLink");

            migrationBuilder.DropIndex(
                name: "IX_QuickLink_UserId_SortOrder",
                table: "QuickLink");

            migrationBuilder.DropColumn(
                name: "QuickLink_Category",
                table: "QuickLink");

            migrationBuilder.AlterColumn<string>(
                name: "QuickLink_Url",
                table: "QuickLink",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(2048)",
                oldMaxLength: 2048);

            migrationBuilder.AlterColumn<string>(
                name: "QuickLink_UpdatedUser",
                table: "QuickLink",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(128)",
                oldMaxLength: 128);

            migrationBuilder.AlterColumn<string>(
                name: "QuickLink_Title",
                table: "QuickLink",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500);

            migrationBuilder.AlterColumn<string>(
                name: "QuickLink_CreatedUser",
                table: "QuickLink",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(128)",
                oldMaxLength: 128);
        }
    }
}
