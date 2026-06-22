using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSubTask : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SubTask",
                columns: table => new
                {
                    SubTask_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SubTask_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SubTask_TaskCardId = table.Column<Guid>(type: "uuid", nullable: false),
                    SubTask_Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    SubTask_IsDone = table.Column<bool>(type: "boolean", nullable: false),
                    SubTask_SortOrder = table.Column<int>(type: "integer", nullable: false),
                    SubTask_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SubTask_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    SubTask_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SubTask_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    SubTask_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    SubTask_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SubTask", x => x.SubTask_Id);
                    table.ForeignKey(
                        name: "FK_SubTask_TaskCard_TaskCardId",
                        column: x => x.SubTask_TaskCardId,
                        principalTable: "TaskCard",
                        principalColumn: "TaskCard_Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SubTask_TaskCardId_SortOrder",
                table: "SubTask",
                columns: new[] { "SubTask_TaskCardId", "SubTask_SortOrder" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SubTask");
        }
    }
}
