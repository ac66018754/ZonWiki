using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class UserScopedSchemaRedesign : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Comment_Article_ArticleId",
                table: "Comment");

            migrationBuilder.DropTable(
                name: "Article");

            migrationBuilder.DropIndex(
                name: "UX_Category_FolderPath",
                table: "Category");

            migrationBuilder.RenameColumn(
                name: "Comment_ArticleId",
                table: "Comment",
                newName: "Comment_NoteId");

            migrationBuilder.RenameIndex(
                name: "IX_Comment_ArticleId",
                table: "Comment",
                newName: "IX_Comment_NoteId");

            migrationBuilder.AddColumn<DateTime>(
                name: "User_DeletedDateTime",
                table: "User",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "User_DisplayMode",
                table: "User",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "User_TimeZone",
                table: "User",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "Comment_DeletedDateTime",
                table: "Comment",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "Category_DeletedDateTime",
                table: "Category",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "Category_UserId",
                table: "Category",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateTable(
                name: "AiModel",
                columns: table => new
                {
                    AiModel_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AiModel_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AiModel_Key = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    AiModel_Label = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    AiModel_Provider = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    AiModel_Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AiModel_Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    AiModel_ModelId = table.Column<string>(type: "text", nullable: true),
                    AiModel_BaseUrl = table.Column<string>(type: "text", nullable: true),
                    AiModel_ApiKeyEncrypted = table.Column<string>(type: "text", nullable: true),
                    AiModel_TimeoutSeconds = table.Column<int>(type: "integer", nullable: false),
                    AiModel_Notes = table.Column<string>(type: "text", nullable: true),
                    AiModel_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AiModel_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    AiModel_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AiModel_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    AiModel_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    AiModel_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiModel", x => x.AiModel_Id);
                });

            migrationBuilder.CreateTable(
                name: "CaptureItem",
                columns: table => new
                {
                    CaptureItem_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CaptureItem_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CaptureItem_Source = table.Column<string>(type: "text", nullable: false),
                    CaptureItem_RawContent = table.Column<string>(type: "text", nullable: false),
                    CaptureItem_AudioPath = table.Column<string>(type: "text", nullable: true),
                    CaptureItem_Status = table.Column<string>(type: "text", nullable: false),
                    CaptureItem_FiledTargetType = table.Column<string>(type: "text", nullable: true),
                    CaptureItem_FiledTargetId = table.Column<Guid>(type: "uuid", nullable: true),
                    CaptureItem_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CaptureItem_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    CaptureItem_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CaptureItem_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    CaptureItem_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    CaptureItem_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CaptureItem", x => x.CaptureItem_Id);
                });

            migrationBuilder.CreateTable(
                name: "Note",
                columns: table => new
                {
                    Note_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Note_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Note_Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Note_Slug = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Note_ContentRaw = table.Column<string>(type: "text", nullable: false),
                    Note_ContentHtml = table.Column<string>(type: "text", nullable: false),
                    Note_ContentHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Note_SourceFilePath = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    Note_IsDraft = table.Column<bool>(type: "boolean", nullable: false),
                    Note_Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Note_JournalDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Note_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Note_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Note_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Note_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Note_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    Note_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Note", x => x.Note_Id);
                });

            migrationBuilder.CreateTable(
                name: "QuickLink",
                columns: table => new
                {
                    QuickLink_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    QuickLink_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    QuickLink_Title = table.Column<string>(type: "text", nullable: false),
                    QuickLink_Url = table.Column<string>(type: "text", nullable: false),
                    QuickLink_IconKey = table.Column<string>(type: "text", nullable: true),
                    QuickLink_SortOrder = table.Column<int>(type: "integer", nullable: false),
                    QuickLink_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    QuickLink_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    QuickLink_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    QuickLink_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    QuickLink_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    QuickLink_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_QuickLink", x => x.QuickLink_Id);
                });

            migrationBuilder.CreateTable(
                name: "Tag",
                columns: table => new
                {
                    Tag_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Tag_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Tag_Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Tag_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Tag_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Tag_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Tag_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Tag_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    Tag_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tag", x => x.Tag_Id);
                });

            migrationBuilder.CreateTable(
                name: "TaskGroup",
                columns: table => new
                {
                    TaskGroup_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskGroup_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskGroup_Name = table.Column<string>(type: "text", nullable: false),
                    TaskGroup_Color = table.Column<string>(type: "text", nullable: true),
                    TaskGroup_SortOrder = table.Column<int>(type: "integer", nullable: false),
                    TaskGroup_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TaskGroup_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    TaskGroup_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TaskGroup_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    TaskGroup_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    TaskGroup_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TaskGroup", x => x.TaskGroup_Id);
                });

            migrationBuilder.CreateTable(
                name: "NoteCategory",
                columns: table => new
                {
                    NoteCategory_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteCategory_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteCategory_NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteCategory_CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteCategory_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteCategory_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteCategory_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteCategory_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteCategory_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    NoteCategory_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteCategory", x => x.NoteCategory_Id);
                    table.ForeignKey(
                        name: "FK_NoteCategory_Category_CategoryId",
                        column: x => x.NoteCategory_CategoryId,
                        principalTable: "Category",
                        principalColumn: "Category_Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_NoteCategory_Note_NoteId",
                        column: x => x.NoteCategory_NoteId,
                        principalTable: "Note",
                        principalColumn: "Note_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NoteLink",
                columns: table => new
                {
                    NoteLink_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteLink_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteLink_SourceNoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteLink_TargetNoteId = table.Column<Guid>(type: "uuid", nullable: true),
                    NoteLink_AnchorText = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    NoteLink_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteLink_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteLink_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteLink_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteLink_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    NoteLink_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteLink", x => x.NoteLink_Id);
                    table.ForeignKey(
                        name: "FK_NoteLink_Note_SourceNoteId",
                        column: x => x.NoteLink_SourceNoteId,
                        principalTable: "Note",
                        principalColumn: "Note_Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_NoteLink_Note_TargetNoteId",
                        column: x => x.NoteLink_TargetNoteId,
                        principalTable: "Note",
                        principalColumn: "Note_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "NoteRevision",
                columns: table => new
                {
                    NoteRevision_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteRevision_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteRevision_NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteRevision_RevisionNo = table.Column<int>(type: "integer", nullable: false),
                    NoteRevision_ChangeKind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    NoteRevision_Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    NoteRevision_ContentRaw = table.Column<string>(type: "text", nullable: false),
                    NoteRevision_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteRevision_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteRevision_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteRevision_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteRevision_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    NoteRevision_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteRevision", x => x.NoteRevision_Id);
                    table.ForeignKey(
                        name: "FK_NoteRevision_Note_NoteId",
                        column: x => x.NoteRevision_NoteId,
                        principalTable: "Note",
                        principalColumn: "Note_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Whiteboard",
                columns: table => new
                {
                    Whiteboard_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Whiteboard_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Whiteboard_NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    Whiteboard_Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Whiteboard_X = table.Column<double>(type: "double precision", nullable: false),
                    Whiteboard_Y = table.Column<double>(type: "double precision", nullable: false),
                    Whiteboard_SortOrder = table.Column<int>(type: "integer", nullable: false),
                    Whiteboard_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Whiteboard_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    Whiteboard_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Whiteboard_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    Whiteboard_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    Whiteboard_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Whiteboard", x => x.Whiteboard_Id);
                    table.ForeignKey(
                        name: "FK_Whiteboard_Note_NoteId",
                        column: x => x.Whiteboard_NoteId,
                        principalTable: "Note",
                        principalColumn: "Note_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NoteTag",
                columns: table => new
                {
                    NoteTag_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteTag_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteTag_NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteTag_TagId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteTag_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteTag_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteTag_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteTag_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteTag_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    NoteTag_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteTag", x => x.NoteTag_Id);
                    table.ForeignKey(
                        name: "FK_NoteTag_Note_NoteId",
                        column: x => x.NoteTag_NoteId,
                        principalTable: "Note",
                        principalColumn: "Note_Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NoteTag_Tag_TagId",
                        column: x => x.NoteTag_TagId,
                        principalTable: "Tag",
                        principalColumn: "Tag_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TaskCard",
                columns: table => new
                {
                    TaskCard_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskCard_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskCard_Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    TaskCard_Content = table.Column<string>(type: "text", nullable: false),
                    TaskCard_Status = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    TaskCard_Priority = table.Column<int>(type: "integer", nullable: false),
                    TaskCard_PlannedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    TaskCard_DueDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    TaskCard_GroupId = table.Column<Guid>(type: "uuid", nullable: true),
                    TaskCard_SortOrder = table.Column<int>(type: "integer", nullable: false),
                    TaskCard_RecurrenceRule = table.Column<string>(type: "text", nullable: true),
                    TaskCard_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TaskCard_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    TaskCard_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TaskCard_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    TaskCard_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    TaskCard_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TaskCard", x => x.TaskCard_Id);
                    table.ForeignKey(
                        name: "FK_TaskCard_TaskGroup_GroupId",
                        column: x => x.TaskCard_GroupId,
                        principalTable: "TaskGroup",
                        principalColumn: "TaskGroup_Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "WhiteboardItem",
                columns: table => new
                {
                    WhiteboardItem_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WhiteboardItem_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    WhiteboardItem_WhiteboardId = table.Column<Guid>(type: "uuid", nullable: false),
                    WhiteboardItem_Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    WhiteboardItem_DataJson = table.Column<string>(type: "jsonb", nullable: false),
                    WhiteboardItem_X = table.Column<double>(type: "double precision", nullable: false),
                    WhiteboardItem_Y = table.Column<double>(type: "double precision", nullable: false),
                    WhiteboardItem_Width = table.Column<double>(type: "double precision", nullable: true),
                    WhiteboardItem_Height = table.Column<double>(type: "double precision", nullable: true),
                    WhiteboardItem_ZIndex = table.Column<int>(type: "integer", nullable: false),
                    WhiteboardItem_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    WhiteboardItem_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    WhiteboardItem_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    WhiteboardItem_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    WhiteboardItem_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    WhiteboardItem_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WhiteboardItem", x => x.WhiteboardItem_Id);
                    table.ForeignKey(
                        name: "FK_WhiteboardItem_Whiteboard_WhiteboardId",
                        column: x => x.WhiteboardItem_WhiteboardId,
                        principalTable: "Whiteboard",
                        principalColumn: "Whiteboard_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NoteTaskLink",
                columns: table => new
                {
                    NoteTaskLink_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteTaskLink_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteTaskLink_NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteTaskLink_TaskCardId = table.Column<Guid>(type: "uuid", nullable: false),
                    NoteTaskLink_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteTaskLink_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteTaskLink_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NoteTaskLink_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    NoteTaskLink_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    NoteTaskLink_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteTaskLink", x => x.NoteTaskLink_Id);
                    table.ForeignKey(
                        name: "FK_NoteTaskLink_Note_NoteId",
                        column: x => x.NoteTaskLink_NoteId,
                        principalTable: "Note",
                        principalColumn: "Note_Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NoteTaskLink_TaskCard_TaskCardId",
                        column: x => x.NoteTaskLink_TaskCardId,
                        principalTable: "TaskCard",
                        principalColumn: "TaskCard_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TaskRelation",
                columns: table => new
                {
                    TaskRelation_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskRelation_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskRelation_SourceTaskCardId = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskRelation_TargetTaskCardId = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskRelation_Kind = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    TaskRelation_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TaskRelation_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    TaskRelation_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TaskRelation_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    TaskRelation_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    TaskRelation_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TaskRelation", x => x.TaskRelation_Id);
                    table.ForeignKey(
                        name: "FK_TaskRelation_TaskCard_SourceTaskCardId",
                        column: x => x.TaskRelation_SourceTaskCardId,
                        principalTable: "TaskCard",
                        principalColumn: "TaskCard_Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TaskRelation_TaskCard_TargetTaskCardId",
                        column: x => x.TaskRelation_TargetTaskCardId,
                        principalTable: "TaskCard",
                        principalColumn: "TaskCard_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Category_UserId_FolderPath",
                table: "Category",
                columns: new[] { "Category_UserId", "Category_FolderPath" });

            migrationBuilder.CreateIndex(
                name: "UX_AiModel_UserId_Key",
                table: "AiModel",
                columns: new[] { "AiModel_UserId", "AiModel_Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Note_UserId_Kind_JournalDate",
                table: "Note",
                columns: new[] { "Note_UserId", "Note_Kind", "Note_JournalDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Note_UserId_SourceFilePath",
                table: "Note",
                columns: new[] { "Note_UserId", "Note_SourceFilePath" });

            migrationBuilder.CreateIndex(
                name: "UX_Note_UserId_Slug",
                table: "Note",
                columns: new[] { "Note_UserId", "Note_Slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NoteCategory_CategoryId",
                table: "NoteCategory",
                column: "NoteCategory_CategoryId");

            migrationBuilder.CreateIndex(
                name: "UX_NoteCategory_NoteId_CategoryId",
                table: "NoteCategory",
                columns: new[] { "NoteCategory_NoteId", "NoteCategory_CategoryId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NoteLink_SourceNoteId",
                table: "NoteLink",
                column: "NoteLink_SourceNoteId");

            migrationBuilder.CreateIndex(
                name: "IX_NoteLink_TargetNoteId",
                table: "NoteLink",
                column: "NoteLink_TargetNoteId");

            migrationBuilder.CreateIndex(
                name: "IX_NoteLink_UserId_SourceNoteId",
                table: "NoteLink",
                columns: new[] { "NoteLink_UserId", "NoteLink_SourceNoteId" });

            migrationBuilder.CreateIndex(
                name: "UX_NoteRevision_NoteId_RevisionNo",
                table: "NoteRevision",
                columns: new[] { "NoteRevision_NoteId", "NoteRevision_RevisionNo" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NoteTag_TagId",
                table: "NoteTag",
                column: "NoteTag_TagId");

            migrationBuilder.CreateIndex(
                name: "UX_NoteTag_NoteId_TagId",
                table: "NoteTag",
                columns: new[] { "NoteTag_NoteId", "NoteTag_TagId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NoteTaskLink_TaskCardId",
                table: "NoteTaskLink",
                column: "NoteTaskLink_TaskCardId");

            migrationBuilder.CreateIndex(
                name: "UX_NoteTaskLink_NoteId_TaskCardId",
                table: "NoteTaskLink",
                columns: new[] { "NoteTaskLink_NoteId", "NoteTaskLink_TaskCardId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_Tag_UserId_Name",
                table: "Tag",
                columns: new[] { "Tag_UserId", "Tag_Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TaskCard_GroupId",
                table: "TaskCard",
                column: "TaskCard_GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_TaskCard_UserId_DueDateTime",
                table: "TaskCard",
                columns: new[] { "TaskCard_UserId", "TaskCard_DueDateTime" });

            migrationBuilder.CreateIndex(
                name: "IX_TaskCard_UserId_Status",
                table: "TaskCard",
                columns: new[] { "TaskCard_UserId", "TaskCard_Status" });

            migrationBuilder.CreateIndex(
                name: "IX_TaskRelation_TargetTaskCardId",
                table: "TaskRelation",
                column: "TaskRelation_TargetTaskCardId");

            migrationBuilder.CreateIndex(
                name: "UX_TaskRelation_SourceTaskCardId_TargetTaskCardId_Kind",
                table: "TaskRelation",
                columns: new[] { "TaskRelation_SourceTaskCardId", "TaskRelation_TargetTaskCardId", "TaskRelation_Kind" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Whiteboard_NoteId",
                table: "Whiteboard",
                column: "Whiteboard_NoteId");

            migrationBuilder.CreateIndex(
                name: "IX_Whiteboard_UserId_NoteId",
                table: "Whiteboard",
                columns: new[] { "Whiteboard_UserId", "Whiteboard_NoteId" });

            migrationBuilder.CreateIndex(
                name: "IX_WhiteboardItem_WhiteboardId",
                table: "WhiteboardItem",
                column: "WhiteboardItem_WhiteboardId");

            migrationBuilder.AddForeignKey(
                name: "FK_Comment_Note_NoteId",
                table: "Comment",
                column: "Comment_NoteId",
                principalTable: "Note",
                principalColumn: "Note_Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Comment_Note_NoteId",
                table: "Comment");

            migrationBuilder.DropTable(
                name: "AiModel");

            migrationBuilder.DropTable(
                name: "CaptureItem");

            migrationBuilder.DropTable(
                name: "NoteCategory");

            migrationBuilder.DropTable(
                name: "NoteLink");

            migrationBuilder.DropTable(
                name: "NoteRevision");

            migrationBuilder.DropTable(
                name: "NoteTag");

            migrationBuilder.DropTable(
                name: "NoteTaskLink");

            migrationBuilder.DropTable(
                name: "QuickLink");

            migrationBuilder.DropTable(
                name: "TaskRelation");

            migrationBuilder.DropTable(
                name: "WhiteboardItem");

            migrationBuilder.DropTable(
                name: "Tag");

            migrationBuilder.DropTable(
                name: "TaskCard");

            migrationBuilder.DropTable(
                name: "Whiteboard");

            migrationBuilder.DropTable(
                name: "TaskGroup");

            migrationBuilder.DropTable(
                name: "Note");

            migrationBuilder.DropIndex(
                name: "IX_Category_UserId_FolderPath",
                table: "Category");

            migrationBuilder.DropColumn(
                name: "User_DeletedDateTime",
                table: "User");

            migrationBuilder.DropColumn(
                name: "User_DisplayMode",
                table: "User");

            migrationBuilder.DropColumn(
                name: "User_TimeZone",
                table: "User");

            migrationBuilder.DropColumn(
                name: "Comment_DeletedDateTime",
                table: "Comment");

            migrationBuilder.DropColumn(
                name: "Category_DeletedDateTime",
                table: "Category");

            migrationBuilder.DropColumn(
                name: "Category_UserId",
                table: "Category");

            migrationBuilder.RenameColumn(
                name: "Comment_NoteId",
                table: "Comment",
                newName: "Comment_ArticleId");

            migrationBuilder.RenameIndex(
                name: "IX_Comment_NoteId",
                table: "Comment",
                newName: "IX_Comment_ArticleId");

            migrationBuilder.CreateTable(
                name: "Article",
                columns: table => new
                {
                    Article_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Article_CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    Article_ContentHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Article_ContentHtml = table.Column<string>(type: "text", nullable: false),
                    Article_ContentRaw = table.Column<string>(type: "text", nullable: false),
                    Article_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Article_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Article_FilePath = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    Article_PublishedFlag = table.Column<bool>(type: "boolean", nullable: false),
                    Article_Slug = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Article_Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Article_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Article_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Article_ValidFlag = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Article", x => x.Article_Id);
                    table.ForeignKey(
                        name: "FK_Article_Category_CategoryId",
                        column: x => x.Article_CategoryId,
                        principalTable: "Category",
                        principalColumn: "Category_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "UX_Category_FolderPath",
                table: "Category",
                column: "Category_FolderPath",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Article_CategoryId",
                table: "Article",
                column: "Article_CategoryId");

            migrationBuilder.CreateIndex(
                name: "UX_Article_FilePath",
                table: "Article",
                column: "Article_FilePath",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_Article_Slug",
                table: "Article",
                column: "Article_Slug",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Comment_Article_ArticleId",
                table: "Comment",
                column: "Comment_ArticleId",
                principalTable: "Article",
                principalColumn: "Article_Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
