using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddUserIdToCanvasChildren : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "NodeRevision_UserId",
                table: "NodeRevision",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "NodeImage_UserId",
                table: "NodeImage",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "Node_UserId",
                table: "Node",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "InlineLink_UserId",
                table: "InlineLink",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "Highlight_UserId",
                table: "Highlight",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "Edge_UserId",
                table: "Edge",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "CategorySystemPrompt_UserId",
                table: "CategorySystemPrompt",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "CanvasSystemPrompt_UserId",
                table: "CanvasSystemPrompt",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "CanvasCategory_UserId",
                table: "CanvasCategory",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "AiMessage_UserId",
                table: "AiMessage",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            // ── 既有資料回填 UserId（從各自的父實體推得擁有者）──
            // 新欄位預設為 Guid.Empty；此處依「擁有權路徑」把現有列回填成正確的使用者。
            // 順序重要：先回填 Node，Highlight / NodeRevision 才能再從 Node 取得 UserId。
            // 因外鍵保證參照完整性，正常情況下不會有孤兒列；萬一有，其 UserId 維持 Guid.Empty
            // → 會被使用者隔離過濾排除（安全，不外洩），不會誤掛到別人名下。

            // 直接掛在 Canvas 底下者：Node / Edge / InlineLink / NodeImage / CanvasCategory / CanvasSystemPrompt
            migrationBuilder.Sql(@"UPDATE ""Node"" AS t SET ""Node_UserId"" = c.""Canvas_UserId""
FROM ""Canvas"" AS c WHERE t.""Node_CanvasId"" = c.""Canvas_Id"";");

            migrationBuilder.Sql(@"UPDATE ""Edge"" AS t SET ""Edge_UserId"" = c.""Canvas_UserId""
FROM ""Canvas"" AS c WHERE t.""Edge_CanvasId"" = c.""Canvas_Id"";");

            migrationBuilder.Sql(@"UPDATE ""InlineLink"" AS t SET ""InlineLink_UserId"" = c.""Canvas_UserId""
FROM ""Canvas"" AS c WHERE t.""InlineLink_CanvasId"" = c.""Canvas_Id"";");

            migrationBuilder.Sql(@"UPDATE ""NodeImage"" AS t SET ""NodeImage_UserId"" = c.""Canvas_UserId""
FROM ""Canvas"" AS c WHERE t.""NodeImage_CanvasId"" = c.""Canvas_Id"";");

            migrationBuilder.Sql(@"UPDATE ""CanvasCategory"" AS t SET ""CanvasCategory_UserId"" = c.""Canvas_UserId""
FROM ""Canvas"" AS c WHERE t.""CanvasCategory_CanvasId"" = c.""Canvas_Id"";");

            migrationBuilder.Sql(@"UPDATE ""CanvasSystemPrompt"" AS t SET ""CanvasSystemPrompt_UserId"" = c.""Canvas_UserId""
FROM ""Canvas"" AS c WHERE t.""CanvasSystemPrompt_CanvasId"" = c.""Canvas_Id"";");

            // 掛在 Node 底下者（須在 Node 回填之後）：Highlight / NodeRevision
            migrationBuilder.Sql(@"UPDATE ""Highlight"" AS t SET ""Highlight_UserId"" = n.""Node_UserId""
FROM ""Node"" AS n WHERE t.""Highlight_NodeId"" = n.""Node_Id"";");

            migrationBuilder.Sql(@"UPDATE ""NodeRevision"" AS t SET ""NodeRevision_UserId"" = n.""Node_UserId""
FROM ""Node"" AS n WHERE t.""NodeRevision_NodeId"" = n.""Node_Id"";");

            // 掛在 AiSession（本身為 IUserOwned）底下者：AiMessage
            migrationBuilder.Sql(@"UPDATE ""AiMessage"" AS t SET ""AiMessage_UserId"" = s.""AiSession_UserId""
FROM ""AiSession"" AS s WHERE t.""AiMessage_SessionId"" = s.""AiSession_Id"";");

            // 掛在 CanvasCat（畫布分類，本身為 IUserOwned）底下者：CategorySystemPrompt
            migrationBuilder.Sql(@"UPDATE ""CategorySystemPrompt"" AS t SET ""CategorySystemPrompt_UserId"" = cc.""CanvasCat_UserId""
FROM ""CanvasCat"" AS cc WHERE t.""CategorySystemPrompt_CategoryId"" = cc.""CanvasCat_Id"";");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "NodeRevision_UserId",
                table: "NodeRevision");

            migrationBuilder.DropColumn(
                name: "NodeImage_UserId",
                table: "NodeImage");

            migrationBuilder.DropColumn(
                name: "Node_UserId",
                table: "Node");

            migrationBuilder.DropColumn(
                name: "InlineLink_UserId",
                table: "InlineLink");

            migrationBuilder.DropColumn(
                name: "Highlight_UserId",
                table: "Highlight");

            migrationBuilder.DropColumn(
                name: "Edge_UserId",
                table: "Edge");

            migrationBuilder.DropColumn(
                name: "CategorySystemPrompt_UserId",
                table: "CategorySystemPrompt");

            migrationBuilder.DropColumn(
                name: "CanvasSystemPrompt_UserId",
                table: "CanvasSystemPrompt");

            migrationBuilder.DropColumn(
                name: "CanvasCategory_UserId",
                table: "CanvasCategory");

            migrationBuilder.DropColumn(
                name: "AiMessage_UserId",
                table: "AiMessage");
        }
    }
}
