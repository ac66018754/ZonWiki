using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskCardLongTermAndHomePin : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "TaskCard_IsLongTerm",
                table: "TaskCard",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "TaskCard_TargetDateTime",
                table: "TaskCard",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TaskCard_TargetGranularity",
                table: "TaskCard",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "TaskCard_IsPinnedToHome",
                table: "TaskCard",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "TaskCard_HomeSortOrder",
                table: "TaskCard",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TaskCard_IsLongTerm",
                table: "TaskCard");

            migrationBuilder.DropColumn(
                name: "TaskCard_TargetDateTime",
                table: "TaskCard");

            migrationBuilder.DropColumn(
                name: "TaskCard_TargetGranularity",
                table: "TaskCard");

            migrationBuilder.DropColumn(
                name: "TaskCard_IsPinnedToHome",
                table: "TaskCard");

            migrationBuilder.DropColumn(
                name: "TaskCard_HomeSortOrder",
                table: "TaskCard");
        }
    }
}
