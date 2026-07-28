using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTaskCardTodoPin : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "TaskCard_IsPinnedToTodo",
                table: "TaskCard",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TaskCard_IsPinnedToTodo",
                table: "TaskCard");
        }
    }
}
