using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCanvasEntities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "TaskGroup_UpdatedUser",
                table: "TaskGroup",
                type: "character varying(128)",
                maxLength: 128,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "TaskGroup_Name",
                table: "TaskGroup",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "TaskGroup_CreatedUser",
                table: "TaskGroup",
                type: "character varying(128)",
                maxLength: 128,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "TaskGroup_Color",
                table: "TaskGroup",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.CreateTable(
                name: "Canvas",
                columns: table => new
                {
                    Canvas_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Canvas_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Canvas_Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Canvas_Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    Canvas_StateJson = table.Column<string>(type: "text", nullable: false),
                    Canvas_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Canvas_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Canvas_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Canvas_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Canvas_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    Canvas_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Canvas", x => x.Canvas_Id);
                });

            migrationBuilder.CreateTable(
                name: "CanvasCat",
                columns: table => new
                {
                    CanvasCat_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CanvasCat_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CanvasCat_Name = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CanvasCat_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CanvasCat_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CanvasCat_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CanvasCat_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CanvasCat_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    CanvasCat_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CanvasCat", x => x.CanvasCat_Id);
                });

            migrationBuilder.CreateTable(
                name: "SystemPrompt",
                columns: table => new
                {
                    SystemPrompt_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SystemPrompt_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SystemPrompt_Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    SystemPrompt_Content = table.Column<string>(type: "text", nullable: false),
                    SystemPrompt_IsGlobal = table.Column<bool>(type: "boolean", nullable: false),
                    SystemPrompt_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SystemPrompt_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    SystemPrompt_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SystemPrompt_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    SystemPrompt_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    SystemPrompt_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SystemPrompt", x => x.SystemPrompt_Id);
                });

            migrationBuilder.CreateTable(
                name: "Edge",
                columns: table => new
                {
                    Edge_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Edge_CanvasId = table.Column<Guid>(type: "uuid", nullable: false),
                    Edge_SourceNodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Edge_TargetNodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Edge_Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Edge_SourceHandle = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    Edge_TargetHandle = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    Edge_Label = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Edge_DataJson = table.Column<string>(type: "text", nullable: false),
                    Edge_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Edge_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Edge_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Edge_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Edge_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    Edge_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Edge", x => x.Edge_Id);
                    table.ForeignKey(
                        name: "FK_Edge_Canvas_CanvasId",
                        column: x => x.Edge_CanvasId,
                        principalTable: "Canvas",
                        principalColumn: "Canvas_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Node",
                columns: table => new
                {
                    Node_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Node_CanvasId = table.Column<Guid>(type: "uuid", nullable: false),
                    Node_Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Node_Content = table.Column<string>(type: "text", nullable: false),
                    Node_ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    Node_X = table.Column<double>(type: "double precision", nullable: false),
                    Node_Y = table.Column<double>(type: "double precision", nullable: false),
                    Node_Width = table.Column<double>(type: "double precision", nullable: true),
                    Node_Height = table.Column<double>(type: "double precision", nullable: true),
                    Node_ZIndex = table.Column<int>(type: "integer", nullable: false),
                    Node_Color = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    Node_Model = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Node_Origin = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Node_AiSessionId = table.Column<Guid>(type: "uuid", nullable: true),
                    Node_AiSessionConsumed = table.Column<bool>(type: "boolean", nullable: false),
                    Node_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Node_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Node_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Node_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Node_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    Node_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Node", x => x.Node_Id);
                    table.ForeignKey(
                        name: "FK_Node_Canvas_CanvasId",
                        column: x => x.Node_CanvasId,
                        principalTable: "Canvas",
                        principalColumn: "Canvas_Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Node_Node_ParentId",
                        column: x => x.Node_ParentId,
                        principalTable: "Node",
                        principalColumn: "Node_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CanvasCategory",
                columns: table => new
                {
                    CanvasCategory_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CanvasCategory_CanvasId = table.Column<Guid>(type: "uuid", nullable: false),
                    CanvasCategory_CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    CanvasCategory_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CanvasCategory_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    CanvasCategory_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CanvasCategory_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    CanvasCategory_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    CanvasCategory_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CanvasCategory", x => x.CanvasCategory_Id);
                    table.ForeignKey(
                        name: "FK_CanvasCategory_CanvasCat_CategoryId",
                        column: x => x.CanvasCategory_CategoryId,
                        principalTable: "CanvasCat",
                        principalColumn: "CanvasCat_Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CanvasCategory_Canvas_CanvasId",
                        column: x => x.CanvasCategory_CanvasId,
                        principalTable: "Canvas",
                        principalColumn: "Canvas_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CanvasSystemPrompt",
                columns: table => new
                {
                    CanvasSystemPrompt_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CanvasSystemPrompt_CanvasId = table.Column<Guid>(type: "uuid", nullable: false),
                    CanvasSystemPrompt_SystemPromptId = table.Column<Guid>(type: "uuid", nullable: false),
                    CanvasSystemPrompt_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CanvasSystemPrompt_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    CanvasSystemPrompt_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CanvasSystemPrompt_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    CanvasSystemPrompt_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    CanvasSystemPrompt_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CanvasSystemPrompt", x => x.CanvasSystemPrompt_Id);
                    table.ForeignKey(
                        name: "FK_CanvasSystemPrompt_Canvas_CanvasId",
                        column: x => x.CanvasSystemPrompt_CanvasId,
                        principalTable: "Canvas",
                        principalColumn: "Canvas_Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CanvasSystemPrompt_SystemPrompt_SystemPromptId",
                        column: x => x.CanvasSystemPrompt_SystemPromptId,
                        principalTable: "SystemPrompt",
                        principalColumn: "SystemPrompt_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CategorySystemPrompt",
                columns: table => new
                {
                    CategorySystemPrompt_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CategorySystemPrompt_CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    CategorySystemPrompt_SystemPromptId = table.Column<Guid>(type: "uuid", nullable: false),
                    CategorySystemPrompt_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CategorySystemPrompt_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    CategorySystemPrompt_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CategorySystemPrompt_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    CategorySystemPrompt_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    CategorySystemPrompt_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CategorySystemPrompt", x => x.CategorySystemPrompt_Id);
                    table.ForeignKey(
                        name: "FK_CategorySystemPrompt_CanvasCat_CategoryId",
                        column: x => x.CategorySystemPrompt_CategoryId,
                        principalTable: "CanvasCat",
                        principalColumn: "CanvasCat_Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CategorySystemPrompt_SystemPrompt_SystemPromptId",
                        column: x => x.CategorySystemPrompt_SystemPromptId,
                        principalTable: "SystemPrompt",
                        principalColumn: "SystemPrompt_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "AiSession",
                columns: table => new
                {
                    AiSession_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AiSession_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AiSession_CanvasId = table.Column<Guid>(type: "uuid", nullable: true),
                    AiSession_AskNodeId = table.Column<Guid>(type: "uuid", nullable: true),
                    AiSession_ResultNodeId = table.Column<Guid>(type: "uuid", nullable: true),
                    AiSession_Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AiSession_PromptText = table.Column<string>(type: "text", nullable: false),
                    AiSession_Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AiSession_TokenUsageJson = table.Column<string>(type: "text", nullable: false),
                    AiSession_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AiSession_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    AiSession_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AiSession_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    AiSession_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    AiSession_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiSession", x => x.AiSession_Id);
                    table.ForeignKey(
                        name: "FK_AiSession_Canvas_CanvasId",
                        column: x => x.AiSession_CanvasId,
                        principalTable: "Canvas",
                        principalColumn: "Canvas_Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AiSession_Node_AskNodeId",
                        column: x => x.AiSession_AskNodeId,
                        principalTable: "Node",
                        principalColumn: "Node_Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AiSession_Node_ResultNodeId",
                        column: x => x.AiSession_ResultNodeId,
                        principalTable: "Node",
                        principalColumn: "Node_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Highlight",
                columns: table => new
                {
                    Highlight_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Highlight_NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Highlight_AnchorText = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Highlight_Start = table.Column<int>(type: "integer", nullable: false),
                    Highlight_End = table.Column<int>(type: "integer", nullable: false),
                    Highlight_AnchorPrefix = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Highlight_AnchorSuffix = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Highlight_Color = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Highlight_Detached = table.Column<bool>(type: "boolean", nullable: false),
                    Highlight_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Highlight_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Highlight_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Highlight_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Highlight_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    Highlight_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Highlight", x => x.Highlight_Id);
                    table.ForeignKey(
                        name: "FK_Highlight_Node_NodeId",
                        column: x => x.Highlight_NodeId,
                        principalTable: "Node",
                        principalColumn: "Node_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "InlineLink",
                columns: table => new
                {
                    InlineLink_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InlineLink_CanvasId = table.Column<Guid>(type: "uuid", nullable: false),
                    InlineLink_SourceNodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    InlineLink_AnchorText = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    InlineLink_AnchorStart = table.Column<int>(type: "integer", nullable: false),
                    InlineLink_AnchorEnd = table.Column<int>(type: "integer", nullable: false),
                    InlineLink_AnchorPrefix = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    InlineLink_AnchorSuffix = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    InlineLink_TargetNodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    InlineLink_Detached = table.Column<bool>(type: "boolean", nullable: false),
                    InlineLink_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    InlineLink_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    InlineLink_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    InlineLink_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    InlineLink_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    InlineLink_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InlineLink", x => x.InlineLink_Id);
                    table.ForeignKey(
                        name: "FK_InlineLink_Canvas_CanvasId",
                        column: x => x.InlineLink_CanvasId,
                        principalTable: "Canvas",
                        principalColumn: "Canvas_Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InlineLink_Node_SourceNodeId",
                        column: x => x.InlineLink_SourceNodeId,
                        principalTable: "Node",
                        principalColumn: "Node_Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InlineLink_Node_TargetNodeId",
                        column: x => x.InlineLink_TargetNodeId,
                        principalTable: "Node",
                        principalColumn: "Node_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "NodeImage",
                columns: table => new
                {
                    NodeImage_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeImage_NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeImage_CanvasId = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeImage_Prompt = table.Column<string>(type: "text", nullable: false),
                    NodeImage_Model = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    NodeImage_FilePath = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    NodeImage_ContentType = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    NodeImage_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NodeImage_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    NodeImage_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NodeImage_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    NodeImage_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    NodeImage_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NodeImage", x => x.NodeImage_Id);
                    table.ForeignKey(
                        name: "FK_NodeImage_Canvas_CanvasId",
                        column: x => x.NodeImage_CanvasId,
                        principalTable: "Canvas",
                        principalColumn: "Canvas_Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_NodeImage_Node_NodeId",
                        column: x => x.NodeImage_NodeId,
                        principalTable: "Node",
                        principalColumn: "Node_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NodeRevision",
                columns: table => new
                {
                    NodeRevision_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeRevision_NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeRevision_Content = table.Column<string>(type: "text", nullable: false),
                    NodeRevision_Source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    NodeRevision_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NodeRevision_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    NodeRevision_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NodeRevision_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    NodeRevision_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    NodeRevision_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NodeRevision", x => x.NodeRevision_Id);
                    table.ForeignKey(
                        name: "FK_NodeRevision_Node_NodeId",
                        column: x => x.NodeRevision_NodeId,
                        principalTable: "Node",
                        principalColumn: "Node_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AiMessage",
                columns: table => new
                {
                    AiMessage_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AiMessage_SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    AiMessage_Role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AiMessage_Content = table.Column<string>(type: "text", nullable: false),
                    AiMessage_RawJsonLine = table.Column<string>(type: "text", nullable: false),
                    AiMessage_SeqNo = table.Column<int>(type: "integer", nullable: false),
                    AiMessage_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AiMessage_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    AiMessage_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AiMessage_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    AiMessage_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    AiMessage_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiMessage", x => x.AiMessage_Id);
                    table.ForeignKey(
                        name: "FK_AiMessage_AiSession_SessionId",
                        column: x => x.AiMessage_SessionId,
                        principalTable: "AiSession",
                        principalColumn: "AiSession_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TaskGroup_UserId_SortOrder",
                table: "TaskGroup",
                columns: new[] { "TaskGroup_UserId", "TaskGroup_SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_AiMessage_SessionId_SeqNo",
                table: "AiMessage",
                columns: new[] { "AiMessage_SessionId", "AiMessage_SeqNo" });

            migrationBuilder.CreateIndex(
                name: "IX_AiSession_AskNodeId",
                table: "AiSession",
                column: "AiSession_AskNodeId");

            migrationBuilder.CreateIndex(
                name: "IX_AiSession_CanvasId_ValidFlag",
                table: "AiSession",
                columns: new[] { "AiSession_CanvasId", "AiSession_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_AiSession_ResultNodeId",
                table: "AiSession",
                column: "AiSession_ResultNodeId");

            migrationBuilder.CreateIndex(
                name: "IX_AiSession_UserId_CreatedDateTime",
                table: "AiSession",
                columns: new[] { "AiSession_UserId", "AiSession_CreatedDateTime" });

            migrationBuilder.CreateIndex(
                name: "IX_Canvas_UserId_CreatedDateTime",
                table: "Canvas",
                columns: new[] { "Canvas_UserId", "Canvas_CreatedDateTime" });

            migrationBuilder.CreateIndex(
                name: "IX_Canvas_UserId_ValidFlag",
                table: "Canvas",
                columns: new[] { "Canvas_UserId", "Canvas_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_CanvasCat_UserId_ValidFlag",
                table: "CanvasCat",
                columns: new[] { "CanvasCat_UserId", "CanvasCat_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_CanvasCategory_CategoryId",
                table: "CanvasCategory",
                column: "CanvasCategory_CategoryId");

            migrationBuilder.CreateIndex(
                name: "UX_CanvasCategory_CanvasId_CategoryId",
                table: "CanvasCategory",
                columns: new[] { "CanvasCategory_CanvasId", "CanvasCategory_CategoryId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CanvasSystemPrompt_SystemPromptId",
                table: "CanvasSystemPrompt",
                column: "CanvasSystemPrompt_SystemPromptId");

            migrationBuilder.CreateIndex(
                name: "UX_CanvasSystemPrompt_CanvasId_SystemPromptId",
                table: "CanvasSystemPrompt",
                columns: new[] { "CanvasSystemPrompt_CanvasId", "CanvasSystemPrompt_SystemPromptId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CategorySystemPrompt_SystemPromptId",
                table: "CategorySystemPrompt",
                column: "CategorySystemPrompt_SystemPromptId");

            migrationBuilder.CreateIndex(
                name: "UX_CategorySystemPrompt_CategoryId_SystemPromptId",
                table: "CategorySystemPrompt",
                columns: new[] { "CategorySystemPrompt_CategoryId", "CategorySystemPrompt_SystemPromptId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Edge_CanvasId",
                table: "Edge",
                column: "Edge_CanvasId");

            migrationBuilder.CreateIndex(
                name: "IX_Edge_SourceNodeId_ValidFlag",
                table: "Edge",
                columns: new[] { "Edge_SourceNodeId", "Edge_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_Edge_TargetNodeId_ValidFlag",
                table: "Edge",
                columns: new[] { "Edge_TargetNodeId", "Edge_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_Highlight_NodeId_ValidFlag",
                table: "Highlight",
                columns: new[] { "Highlight_NodeId", "Highlight_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_InlineLink_CanvasId",
                table: "InlineLink",
                column: "InlineLink_CanvasId");

            migrationBuilder.CreateIndex(
                name: "IX_InlineLink_SourceNodeId_ValidFlag",
                table: "InlineLink",
                columns: new[] { "InlineLink_SourceNodeId", "InlineLink_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_InlineLink_TargetNodeId_ValidFlag",
                table: "InlineLink",
                columns: new[] { "InlineLink_TargetNodeId", "InlineLink_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_Node_CanvasId_ValidFlag",
                table: "Node",
                columns: new[] { "Node_CanvasId", "Node_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_Node_ParentId_ValidFlag",
                table: "Node",
                columns: new[] { "Node_ParentId", "Node_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_NodeImage_CanvasId_ValidFlag",
                table: "NodeImage",
                columns: new[] { "NodeImage_CanvasId", "NodeImage_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_NodeImage_NodeId_ValidFlag",
                table: "NodeImage",
                columns: new[] { "NodeImage_NodeId", "NodeImage_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_NodeRevision_NodeId_ValidFlag",
                table: "NodeRevision",
                columns: new[] { "NodeRevision_NodeId", "NodeRevision_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_SystemPrompt_UserId_IsGlobal",
                table: "SystemPrompt",
                columns: new[] { "SystemPrompt_UserId", "SystemPrompt_IsGlobal" });

            migrationBuilder.CreateIndex(
                name: "IX_SystemPrompt_UserId_ValidFlag",
                table: "SystemPrompt",
                columns: new[] { "SystemPrompt_UserId", "SystemPrompt_ValidFlag" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AiMessage");

            migrationBuilder.DropTable(
                name: "CanvasCategory");

            migrationBuilder.DropTable(
                name: "CanvasSystemPrompt");

            migrationBuilder.DropTable(
                name: "CategorySystemPrompt");

            migrationBuilder.DropTable(
                name: "Edge");

            migrationBuilder.DropTable(
                name: "Highlight");

            migrationBuilder.DropTable(
                name: "InlineLink");

            migrationBuilder.DropTable(
                name: "NodeImage");

            migrationBuilder.DropTable(
                name: "NodeRevision");

            migrationBuilder.DropTable(
                name: "AiSession");

            migrationBuilder.DropTable(
                name: "CanvasCat");

            migrationBuilder.DropTable(
                name: "SystemPrompt");

            migrationBuilder.DropTable(
                name: "Node");

            migrationBuilder.DropTable(
                name: "Canvas");

            migrationBuilder.DropIndex(
                name: "IX_TaskGroup_UserId_SortOrder",
                table: "TaskGroup");

            migrationBuilder.AlterColumn<string>(
                name: "TaskGroup_UpdatedUser",
                table: "TaskGroup",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(128)",
                oldMaxLength: 128);

            migrationBuilder.AlterColumn<string>(
                name: "TaskGroup_Name",
                table: "TaskGroup",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(255)",
                oldMaxLength: 255);

            migrationBuilder.AlterColumn<string>(
                name: "TaskGroup_CreatedUser",
                table: "TaskGroup",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(128)",
                oldMaxLength: 128);

            migrationBuilder.AlterColumn<string>(
                name: "TaskGroup_Color",
                table: "TaskGroup",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldNullable: true);
        }
    }
}
