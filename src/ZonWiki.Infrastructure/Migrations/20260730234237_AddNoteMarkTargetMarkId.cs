using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNoteMarkTargetMarkId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "NoteMark_TargetMarkId",
                table: "NoteMark",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_NoteMark_UserId_TargetMarkId",
                table: "NoteMark",
                columns: new[] { "NoteMark_UserId", "NoteMark_TargetMarkId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_NoteMark_UserId_TargetMarkId",
                table: "NoteMark");

            migrationBuilder.DropColumn(
                name: "NoteMark_TargetMarkId",
                table: "NoteMark");
        }
    }
}
