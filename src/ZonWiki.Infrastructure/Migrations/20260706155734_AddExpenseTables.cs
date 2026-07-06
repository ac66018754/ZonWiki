using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddExpenseTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ExpenseCategory",
                columns: table => new
                {
                    ExpenseCategory_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExpenseCategory_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExpenseCategory_Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ExpenseCategory_Icon = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    ExpenseCategory_SortOrder = table.Column<int>(type: "integer", nullable: false),
                    ExpenseCategory_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpenseCategory_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ExpenseCategory_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpenseCategory_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ExpenseCategory_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    ExpenseCategory_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ExpenseCategory_PurgedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExpenseCategory", x => x.ExpenseCategory_Id);
                });

            migrationBuilder.CreateTable(
                name: "Expense",
                columns: table => new
                {
                    Expense_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Expense_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Expense_OccurredDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Expense_Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Expense_Currency = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    Expense_CategoryId = table.Column<Guid>(type: "uuid", nullable: true),
                    Expense_Merchant = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Expense_ItemsJson = table.Column<string>(type: "text", nullable: true),
                    Expense_RawText = table.Column<string>(type: "text", nullable: false),
                    Expense_Source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Expense_CaptureItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    Expense_ClientRequestId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Expense_NeedsConfirmation = table.Column<bool>(type: "boolean", nullable: false),
                    Expense_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Expense_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Expense_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Expense_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Expense_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    Expense_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Expense_PurgedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Expense", x => x.Expense_Id);
                    table.ForeignKey(
                        name: "FK_Expense_ExpenseCategory_CategoryId",
                        column: x => x.Expense_CategoryId,
                        principalTable: "ExpenseCategory",
                        principalColumn: "ExpenseCategory_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Expense_CategoryId",
                table: "Expense",
                column: "Expense_CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_Expense_UserId_CategoryId_ValidFlag",
                table: "Expense",
                columns: new[] { "Expense_UserId", "Expense_CategoryId", "Expense_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "IX_Expense_UserId_OccurredDateTime_ValidFlag",
                table: "Expense",
                columns: new[] { "Expense_UserId", "Expense_OccurredDateTime", "Expense_ValidFlag" });

            migrationBuilder.CreateIndex(
                name: "UX_Expense_UserId_ClientRequestId",
                table: "Expense",
                columns: new[] { "Expense_UserId", "Expense_ClientRequestId" },
                unique: true,
                filter: "\"Expense_ClientRequestId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "UX_ExpenseCategory_UserId_Name",
                table: "ExpenseCategory",
                columns: new[] { "ExpenseCategory_UserId", "ExpenseCategory_Name" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Expense");

            migrationBuilder.DropTable(
                name: "ExpenseCategory");
        }
    }
}
