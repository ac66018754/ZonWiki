using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCanvasAnnotation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CanvasAnnotation",
                columns: table => new
                {
                    CanvasAnnotation_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CanvasAnnotation_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CanvasAnnotation_CanvasId = table.Column<Guid>(type: "uuid", nullable: false),
                    CanvasAnnotation_Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CanvasAnnotation_X = table.Column<double>(type: "double precision", nullable: false),
                    CanvasAnnotation_Y = table.Column<double>(type: "double precision", nullable: false),
                    CanvasAnnotation_Width = table.Column<double>(type: "double precision", nullable: false),
                    CanvasAnnotation_Height = table.Column<double>(type: "double precision", nullable: false),
                    CanvasAnnotation_ZIndex = table.Column<int>(type: "integer", nullable: false),
                    CanvasAnnotation_Color = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    CanvasAnnotation_Text = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    CanvasAnnotation_DataJson = table.Column<string>(type: "text", nullable: true),
                    CanvasAnnotation_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CanvasAnnotation_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CanvasAnnotation_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CanvasAnnotation_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CanvasAnnotation_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    CanvasAnnotation_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CanvasAnnotation", x => x.CanvasAnnotation_Id);
                    table.ForeignKey(
                        name: "FK_CanvasAnnotation_Canvas_CanvasId",
                        column: x => x.CanvasAnnotation_CanvasId,
                        principalTable: "Canvas",
                        principalColumn: "Canvas_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CanvasAnnotation_CanvasId",
                table: "CanvasAnnotation",
                column: "CanvasAnnotation_CanvasId");

            migrationBuilder.CreateIndex(
                name: "IX_CanvasAnnotation_UserId_CanvasId_ValidFlag",
                table: "CanvasAnnotation",
                columns: new[] { "CanvasAnnotation_UserId", "CanvasAnnotation_CanvasId", "CanvasAnnotation_ValidFlag" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CanvasAnnotation");
        }
    }
}
