using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSearchScopeTrigramIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Tag_Name_Trgm",
                table: "Tag",
                column: "Tag_Name")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_Category_Name_Trgm",
                table: "Category",
                column: "Category_Name")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_CaptureItem_RawContent_Trgm",
                table: "CaptureItem",
                column: "CaptureItem_RawContent")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Tag_Name_Trgm",
                table: "Tag");

            migrationBuilder.DropIndex(
                name: "IX_Category_Name_Trgm",
                table: "Category");

            migrationBuilder.DropIndex(
                name: "IX_CaptureItem_RawContent_Trgm",
                table: "CaptureItem");
        }
    }
}
