using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPurgedDateTimeAndPartialSlugIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_Note_UserId_Slug",
                table: "Note");

            migrationBuilder.AddColumn<DateTime>(
                name: "User_PurgedDateTime",
                table: "User",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "TaskTag_PurgedDateTime",
                table: "TaskTag",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "TaskRelation_PurgedDateTime",
                table: "TaskRelation",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "TaskGroup_PurgedDateTime",
                table: "TaskGroup",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "TaskCard_PurgedDateTime",
                table: "TaskCard",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "Tag_PurgedDateTime",
                table: "Tag",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SystemPrompt_PurgedDateTime",
                table: "SystemPrompt",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SubTask_PurgedDateTime",
                table: "SubTask",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "QuickLinkTag_PurgedDateTime",
                table: "QuickLinkTag",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "QuickLink_PurgedDateTime",
                table: "QuickLink",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "NoteTaskLink_PurgedDateTime",
                table: "NoteTaskLink",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "NoteTag_PurgedDateTime",
                table: "NoteTag",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "NoteRevision_PurgedDateTime",
                table: "NoteRevision",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "NoteOverlayItem_PurgedDateTime",
                table: "NoteOverlayItem",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "NoteMark_PurgedDateTime",
                table: "NoteMark",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "NoteLink_PurgedDateTime",
                table: "NoteLink",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "NoteCategory_PurgedDateTime",
                table: "NoteCategory",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "Note_PurgedDateTime",
                table: "Note",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "NodeRevision_PurgedDateTime",
                table: "NodeRevision",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "NodeImage_PurgedDateTime",
                table: "NodeImage",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "Node_PurgedDateTime",
                table: "Node",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "InlineLink_PurgedDateTime",
                table: "InlineLink",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "Highlight_PurgedDateTime",
                table: "Highlight",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "EntityLink_PurgedDateTime",
                table: "EntityLink",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "Edge_PurgedDateTime",
                table: "Edge",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "Comment_PurgedDateTime",
                table: "Comment",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CategoryTag_PurgedDateTime",
                table: "CategoryTag",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CategorySystemPrompt_PurgedDateTime",
                table: "CategorySystemPrompt",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "Category_PurgedDateTime",
                table: "Category",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CaptureLink_PurgedDateTime",
                table: "CaptureLink",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CaptureItem_PurgedDateTime",
                table: "CaptureItem",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CanvasSystemPrompt_PurgedDateTime",
                table: "CanvasSystemPrompt",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CanvasCategory_PurgedDateTime",
                table: "CanvasCategory",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CanvasCat_PurgedDateTime",
                table: "CanvasCat",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CanvasAnnotation_PurgedDateTime",
                table: "CanvasAnnotation",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "Canvas_PurgedDateTime",
                table: "Canvas",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "AiSession_PurgedDateTime",
                table: "AiSession",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "AiModel_PurgedDateTime",
                table: "AiModel",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "AiMessage_PurgedDateTime",
                table: "AiMessage",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ActivityLog_PurgedDateTime",
                table: "ActivityLog",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "UX_Note_UserId_Slug",
                table: "Note",
                columns: new[] { "Note_UserId", "Note_Slug" },
                unique: true,
                filter: "\"Note_ValidFlag\" = TRUE");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_Note_UserId_Slug",
                table: "Note");

            migrationBuilder.DropColumn(
                name: "User_PurgedDateTime",
                table: "User");

            migrationBuilder.DropColumn(
                name: "TaskTag_PurgedDateTime",
                table: "TaskTag");

            migrationBuilder.DropColumn(
                name: "TaskRelation_PurgedDateTime",
                table: "TaskRelation");

            migrationBuilder.DropColumn(
                name: "TaskGroup_PurgedDateTime",
                table: "TaskGroup");

            migrationBuilder.DropColumn(
                name: "TaskCard_PurgedDateTime",
                table: "TaskCard");

            migrationBuilder.DropColumn(
                name: "Tag_PurgedDateTime",
                table: "Tag");

            migrationBuilder.DropColumn(
                name: "SystemPrompt_PurgedDateTime",
                table: "SystemPrompt");

            migrationBuilder.DropColumn(
                name: "SubTask_PurgedDateTime",
                table: "SubTask");

            migrationBuilder.DropColumn(
                name: "QuickLinkTag_PurgedDateTime",
                table: "QuickLinkTag");

            migrationBuilder.DropColumn(
                name: "QuickLink_PurgedDateTime",
                table: "QuickLink");

            migrationBuilder.DropColumn(
                name: "NoteTaskLink_PurgedDateTime",
                table: "NoteTaskLink");

            migrationBuilder.DropColumn(
                name: "NoteTag_PurgedDateTime",
                table: "NoteTag");

            migrationBuilder.DropColumn(
                name: "NoteRevision_PurgedDateTime",
                table: "NoteRevision");

            migrationBuilder.DropColumn(
                name: "NoteOverlayItem_PurgedDateTime",
                table: "NoteOverlayItem");

            migrationBuilder.DropColumn(
                name: "NoteMark_PurgedDateTime",
                table: "NoteMark");

            migrationBuilder.DropColumn(
                name: "NoteLink_PurgedDateTime",
                table: "NoteLink");

            migrationBuilder.DropColumn(
                name: "NoteCategory_PurgedDateTime",
                table: "NoteCategory");

            migrationBuilder.DropColumn(
                name: "Note_PurgedDateTime",
                table: "Note");

            migrationBuilder.DropColumn(
                name: "NodeRevision_PurgedDateTime",
                table: "NodeRevision");

            migrationBuilder.DropColumn(
                name: "NodeImage_PurgedDateTime",
                table: "NodeImage");

            migrationBuilder.DropColumn(
                name: "Node_PurgedDateTime",
                table: "Node");

            migrationBuilder.DropColumn(
                name: "InlineLink_PurgedDateTime",
                table: "InlineLink");

            migrationBuilder.DropColumn(
                name: "Highlight_PurgedDateTime",
                table: "Highlight");

            migrationBuilder.DropColumn(
                name: "EntityLink_PurgedDateTime",
                table: "EntityLink");

            migrationBuilder.DropColumn(
                name: "Edge_PurgedDateTime",
                table: "Edge");

            migrationBuilder.DropColumn(
                name: "Comment_PurgedDateTime",
                table: "Comment");

            migrationBuilder.DropColumn(
                name: "CategoryTag_PurgedDateTime",
                table: "CategoryTag");

            migrationBuilder.DropColumn(
                name: "CategorySystemPrompt_PurgedDateTime",
                table: "CategorySystemPrompt");

            migrationBuilder.DropColumn(
                name: "Category_PurgedDateTime",
                table: "Category");

            migrationBuilder.DropColumn(
                name: "CaptureLink_PurgedDateTime",
                table: "CaptureLink");

            migrationBuilder.DropColumn(
                name: "CaptureItem_PurgedDateTime",
                table: "CaptureItem");

            migrationBuilder.DropColumn(
                name: "CanvasSystemPrompt_PurgedDateTime",
                table: "CanvasSystemPrompt");

            migrationBuilder.DropColumn(
                name: "CanvasCategory_PurgedDateTime",
                table: "CanvasCategory");

            migrationBuilder.DropColumn(
                name: "CanvasCat_PurgedDateTime",
                table: "CanvasCat");

            migrationBuilder.DropColumn(
                name: "CanvasAnnotation_PurgedDateTime",
                table: "CanvasAnnotation");

            migrationBuilder.DropColumn(
                name: "Canvas_PurgedDateTime",
                table: "Canvas");

            migrationBuilder.DropColumn(
                name: "AiSession_PurgedDateTime",
                table: "AiSession");

            migrationBuilder.DropColumn(
                name: "AiModel_PurgedDateTime",
                table: "AiModel");

            migrationBuilder.DropColumn(
                name: "AiMessage_PurgedDateTime",
                table: "AiMessage");

            migrationBuilder.DropColumn(
                name: "ActivityLog_PurgedDateTime",
                table: "ActivityLog");

            migrationBuilder.CreateIndex(
                name: "UX_Note_UserId_Slug",
                table: "Note",
                columns: new[] { "Note_UserId", "Note_Slug" },
                unique: true);
        }
    }
}
