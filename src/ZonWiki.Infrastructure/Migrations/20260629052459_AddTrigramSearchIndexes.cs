using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTrigramSearchIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:pg_trgm", ",,");

            migrationBuilder.CreateIndex(
                name: "IX_TaskCard_Content_Trgm",
                table: "TaskCard",
                column: "TaskCard_Content")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_TaskCard_Title_Trgm",
                table: "TaskCard",
                column: "TaskCard_Title")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_Note_ContentRaw_Trgm",
                table: "Note",
                column: "Note_ContentRaw")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_Note_Title_Trgm",
                table: "Note",
                column: "Note_Title")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_Node_Content_Trgm",
                table: "Node",
                column: "Node_Content")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_Node_Title_Trgm",
                table: "Node",
                column: "Node_Title")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_Canvas_Title_Trgm",
                table: "Canvas",
                column: "Canvas_Title")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_TaskCard_Content_Trgm",
                table: "TaskCard");

            migrationBuilder.DropIndex(
                name: "IX_TaskCard_Title_Trgm",
                table: "TaskCard");

            migrationBuilder.DropIndex(
                name: "IX_Note_ContentRaw_Trgm",
                table: "Note");

            migrationBuilder.DropIndex(
                name: "IX_Note_Title_Trgm",
                table: "Note");

            migrationBuilder.DropIndex(
                name: "IX_Node_Content_Trgm",
                table: "Node");

            migrationBuilder.DropIndex(
                name: "IX_Node_Title_Trgm",
                table: "Node");

            migrationBuilder.DropIndex(
                name: "IX_Canvas_Title_Trgm",
                table: "Canvas");

            migrationBuilder.AlterDatabase()
                .OldAnnotation("Npgsql:PostgresExtension:pg_trgm", ",,");
        }
    }
}
