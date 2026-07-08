using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskCardRecurrenceInstancing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "TaskCard_RecurrenceOccurrenceDateTime",
                table: "TaskCard",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "TaskCard_RecurrenceSourceId",
                table: "TaskCard",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_TaskCard_RecurrenceSourceId_RecurrenceOccurrenceDateTime",
                table: "TaskCard",
                columns: new[] { "TaskCard_RecurrenceSourceId", "TaskCard_RecurrenceOccurrenceDateTime" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_TaskCard_RecurrenceSourceId_RecurrenceOccurrenceDateTime",
                table: "TaskCard");

            migrationBuilder.DropColumn(
                name: "TaskCard_RecurrenceOccurrenceDateTime",
                table: "TaskCard");

            migrationBuilder.DropColumn(
                name: "TaskCard_RecurrenceSourceId",
                table: "TaskCard");
        }
    }
}
