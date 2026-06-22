using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskParentAndCompleted : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "TaskCard_CompletedDateTime",
                table: "TaskCard",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "TaskCard_ParentId",
                table: "TaskCard",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_TaskCard_ParentId",
                table: "TaskCard",
                column: "TaskCard_ParentId");

            migrationBuilder.AddForeignKey(
                name: "FK_TaskCard_TaskCard_ParentId",
                table: "TaskCard",
                column: "TaskCard_ParentId",
                principalTable: "TaskCard",
                principalColumn: "TaskCard_Id",
                onDelete: ReferentialAction.Restrict);

            // #8 資料遷移（加性、可還原）：把現有「有效子任務」(SubTask) 複製成「子任務卡片」(子 TaskCard)，
            // ParentId 指向原所屬卡片。保留 SubTask 表原封不動當備份；若要還原，刪掉這些子卡片即可。
            // 只遷移「父卡片仍存在且有效」者；IsDone→status，完成時間沿用。gen_random_uuid() 為 PG13+ 內建。
            migrationBuilder.Sql(@"
                INSERT INTO ""TaskCard"" (
                    ""TaskCard_Id"", ""TaskCard_UserId"", ""TaskCard_Title"", ""TaskCard_Content"", ""TaskCard_Status"",
                    ""TaskCard_Priority"", ""TaskCard_SortOrder"", ""TaskCard_ParentId"", ""TaskCard_CompletedDateTime"",
                    ""TaskCard_CreatedDateTime"", ""TaskCard_CreatedUser"", ""TaskCard_UpdatedDateTime"", ""TaskCard_UpdatedUser"", ""TaskCard_ValidFlag""
                )
                SELECT
                    gen_random_uuid(),
                    s.""SubTask_UserId"",
                    s.""SubTask_Title"",
                    '',
                    CASE WHEN s.""SubTask_IsDone"" THEN 'done' ELSE 'todo' END,
                    0,
                    s.""SubTask_SortOrder"",
                    s.""SubTask_TaskCardId"",
                    s.""SubTask_CompletedDateTime"",
                    s.""SubTask_CreatedDateTime"",
                    s.""SubTask_CreatedUser"",
                    s.""SubTask_UpdatedDateTime"",
                    s.""SubTask_UpdatedUser"",
                    TRUE
                FROM ""SubTask"" s
                WHERE s.""SubTask_ValidFlag"" = TRUE
                  AND EXISTS (
                    SELECT 1 FROM ""TaskCard"" p
                    WHERE p.""TaskCard_Id"" = s.""SubTask_TaskCardId"" AND p.""TaskCard_ValidFlag"" = TRUE
                  );
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_TaskCard_TaskCard_ParentId",
                table: "TaskCard");

            migrationBuilder.DropIndex(
                name: "IX_TaskCard_ParentId",
                table: "TaskCard");

            migrationBuilder.DropColumn(
                name: "TaskCard_CompletedDateTime",
                table: "TaskCard");

            migrationBuilder.DropColumn(
                name: "TaskCard_ParentId",
                table: "TaskCard");
        }
    }
}
