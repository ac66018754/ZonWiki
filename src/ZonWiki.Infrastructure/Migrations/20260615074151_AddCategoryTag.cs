using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCategoryTag : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CategoryTag",
                columns: table => new
                {
                    CategoryTag_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CategoryTag_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CategoryTag_CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    CategoryTag_TagId = table.Column<Guid>(type: "uuid", nullable: false),
                    CategoryTag_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CategoryTag_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    CategoryTag_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CategoryTag_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    CategoryTag_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    CategoryTag_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CategoryTag", x => x.CategoryTag_Id);
                    table.ForeignKey(
                        name: "FK_CategoryTag_Category_CategoryId",
                        column: x => x.CategoryTag_CategoryId,
                        principalTable: "Category",
                        principalColumn: "Category_Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CategoryTag_Tag_TagId",
                        column: x => x.CategoryTag_TagId,
                        principalTable: "Tag",
                        principalColumn: "Tag_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CategoryTag_TagId",
                table: "CategoryTag",
                column: "CategoryTag_TagId");

            migrationBuilder.CreateIndex(
                name: "UX_CategoryTag_CategoryId_TagId",
                table: "CategoryTag",
                columns: new[] { "CategoryTag_CategoryId", "CategoryTag_TagId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CategoryTag");
        }
    }
}
