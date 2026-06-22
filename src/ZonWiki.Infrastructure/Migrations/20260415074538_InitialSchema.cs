using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Category",
                columns: table => new
                {
                    Category_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Category_ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    Category_Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Category_FolderPath = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    Category_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Category_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Category_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Category_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Category_ValidFlag = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Category", x => x.Category_Id);
                    table.ForeignKey(
                        name: "FK_Category_Category_ParentId",
                        column: x => x.Category_ParentId,
                        principalTable: "Category",
                        principalColumn: "Category_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "User",
                columns: table => new
                {
                    User_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    User_GoogleSub = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    User_Email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    User_DisplayName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    User_AvatarUrl = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    User_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    User_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    User_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    User_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    User_ValidFlag = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_User", x => x.User_Id);
                });

            migrationBuilder.CreateTable(
                name: "Article",
                columns: table => new
                {
                    Article_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Article_CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    Article_Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Article_Slug = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Article_FilePath = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    Article_ContentHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Article_ContentRaw = table.Column<string>(type: "text", nullable: false),
                    Article_ContentHtml = table.Column<string>(type: "text", nullable: false),
                    Article_PublishedFlag = table.Column<bool>(type: "boolean", nullable: false),
                    Article_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Article_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
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

            migrationBuilder.CreateTable(
                name: "Comment",
                columns: table => new
                {
                    Comment_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Comment_ArticleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Comment_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Comment_Content = table.Column<string>(type: "text", nullable: false),
                    Comment_AnchorType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Comment_AnchorData = table.Column<string>(type: "jsonb", nullable: true),
                    Comment_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Comment_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Comment_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Comment_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Comment_ValidFlag = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Comment", x => x.Comment_Id);
                    table.ForeignKey(
                        name: "FK_Comment_Article_ArticleId",
                        column: x => x.Comment_ArticleId,
                        principalTable: "Article",
                        principalColumn: "Article_Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Comment_User_UserId",
                        column: x => x.Comment_UserId,
                        principalTable: "User",
                        principalColumn: "User_Id",
                        onDelete: ReferentialAction.Restrict);
                });

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

            migrationBuilder.CreateIndex(
                name: "IX_Category_ParentId",
                table: "Category",
                column: "Category_ParentId");

            migrationBuilder.CreateIndex(
                name: "UX_Category_FolderPath",
                table: "Category",
                column: "Category_FolderPath",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Comment_ArticleId",
                table: "Comment",
                column: "Comment_ArticleId");

            migrationBuilder.CreateIndex(
                name: "IX_Comment_UserId",
                table: "Comment",
                column: "Comment_UserId");

            migrationBuilder.CreateIndex(
                name: "IX_User_Email",
                table: "User",
                column: "User_Email");

            migrationBuilder.CreateIndex(
                name: "UX_User_GoogleSub",
                table: "User",
                column: "User_GoogleSub",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Comment");

            migrationBuilder.DropTable(
                name: "Article");

            migrationBuilder.DropTable(
                name: "User");

            migrationBuilder.DropTable(
                name: "Category");
        }
    }
}
