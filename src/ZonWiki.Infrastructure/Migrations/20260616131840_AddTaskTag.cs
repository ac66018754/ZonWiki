using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskTag : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TaskTag",
                columns: table => new
                {
                    TaskTag_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskTag_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskTag_TaskCardId = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskTag_TagId = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskTag_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TaskTag_CreatedUser = table.Column<string>(type: "text", nullable: false),
                    TaskTag_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TaskTag_UpdatedUser = table.Column<string>(type: "text", nullable: false),
                    TaskTag_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    TaskTag_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TaskTag", x => x.TaskTag_Id);
                    table.ForeignKey(
                        name: "FK_TaskTag_Tag_TagId",
                        column: x => x.TaskTag_TagId,
                        principalTable: "Tag",
                        principalColumn: "Tag_Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TaskTag_TaskCard_TaskCardId",
                        column: x => x.TaskTag_TaskCardId,
                        principalTable: "TaskCard",
                        principalColumn: "TaskCard_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TaskTag_TagId",
                table: "TaskTag",
                column: "TaskTag_TagId");

            migrationBuilder.CreateIndex(
                name: "UX_TaskTag_TaskCardId_TagId",
                table: "TaskTag",
                columns: new[] { "TaskTag_TaskCardId", "TaskTag_TagId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TaskTag");
        }
    }
}
