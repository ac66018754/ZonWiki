using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCoachTablesAndVocabSourceFk : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "VocabularyWord_SourceCoachSessionId",
                table: "VocabularyWord",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TtsAudio_Mode",
                table: "TtsAudio",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                // 既有列一次性回填為 "read"（既有音檔皆為單人朗讀；模型未設持久預設，此值僅供回填）。
                defaultValue: "read");

            migrationBuilder.CreateTable(
                name: "CoachBudgetLedger",
                columns: table => new
                {
                    CoachBudgetLedger_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CoachBudgetLedger_Scope = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CoachBudgetLedger_PeriodKey = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CoachBudgetLedger_TokenCount = table.Column<long>(type: "bigint", nullable: false),
                    CoachBudgetLedger_EstimatedCostUsd = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CoachBudgetLedger_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CoachBudgetLedger_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CoachBudgetLedger_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CoachBudgetLedger_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CoachBudgetLedger_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    CoachBudgetLedger_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CoachBudgetLedger_PurgedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CoachBudgetLedger", x => x.CoachBudgetLedger_Id);
                });

            migrationBuilder.CreateTable(
                name: "CoachSession",
                columns: table => new
                {
                    CoachSession_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CoachSession_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CoachSession_Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CoachSession_Topic = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CoachSession_Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CoachSession_Model = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CoachSession_SummaryText = table.Column<string>(type: "text", nullable: true),
                    CoachSession_ResumptionHandle = table.Column<string>(type: "text", nullable: true),
                    CoachSession_StartedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CoachSession_AccumulatedSeconds = table.Column<int>(type: "integer", nullable: false),
                    CoachSession_EndedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CoachSession_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CoachSession_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CoachSession_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CoachSession_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CoachSession_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    CoachSession_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CoachSession_PurgedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CoachSession", x => x.CoachSession_Id);
                });

            migrationBuilder.CreateTable(
                name: "CoachMessage",
                columns: table => new
                {
                    CoachMessage_Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CoachMessage_UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CoachMessage_CoachSessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    CoachMessage_Role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CoachMessage_Content = table.Column<string>(type: "text", nullable: false),
                    CoachMessage_CorrectionJson = table.Column<string>(type: "text", nullable: true),
                    CoachMessage_SeqNo = table.Column<int>(type: "integer", nullable: false),
                    CoachMessage_InterruptedFlag = table.Column<bool>(type: "boolean", nullable: false),
                    CoachMessage_ApproxCutChars = table.Column<int>(type: "integer", nullable: true),
                    CoachMessage_CreatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CoachMessage_CreatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CoachMessage_UpdatedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CoachMessage_UpdatedUser = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CoachMessage_ValidFlag = table.Column<bool>(type: "boolean", nullable: false),
                    CoachMessage_DeletedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CoachMessage_PurgedDateTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CoachMessage", x => x.CoachMessage_Id);
                    table.ForeignKey(
                        name: "FK_CoachMessage_CoachSession_CoachSessionId",
                        column: x => x.CoachMessage_CoachSessionId,
                        principalTable: "CoachSession",
                        principalColumn: "CoachSession_Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_VocabularyWord_SourceCoachSessionId",
                table: "VocabularyWord",
                column: "VocabularyWord_SourceCoachSessionId");

            migrationBuilder.CreateIndex(
                name: "UX_CoachBudgetLedger_Scope_PeriodKey",
                table: "CoachBudgetLedger",
                columns: new[] { "CoachBudgetLedger_Scope", "CoachBudgetLedger_PeriodKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_CoachMessage_CoachSessionId_SeqNo",
                table: "CoachMessage",
                columns: new[] { "CoachMessage_CoachSessionId", "CoachMessage_SeqNo" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CoachSession_UserId_Status_UpdatedDateTime",
                table: "CoachSession",
                columns: new[] { "CoachSession_UserId", "CoachSession_Status", "CoachSession_UpdatedDateTime" });

            migrationBuilder.AddForeignKey(
                name: "FK_VocabularyWord_CoachSession_SourceCoachSessionId",
                table: "VocabularyWord",
                column: "VocabularyWord_SourceCoachSessionId",
                principalTable: "CoachSession",
                principalColumn: "CoachSession_Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_VocabularyWord_CoachSession_SourceCoachSessionId",
                table: "VocabularyWord");

            migrationBuilder.DropTable(
                name: "CoachBudgetLedger");

            migrationBuilder.DropTable(
                name: "CoachMessage");

            migrationBuilder.DropTable(
                name: "CoachSession");

            migrationBuilder.DropIndex(
                name: "IX_VocabularyWord_SourceCoachSessionId",
                table: "VocabularyWord");

            migrationBuilder.DropColumn(
                name: "VocabularyWord_SourceCoachSessionId",
                table: "VocabularyWord");

            migrationBuilder.DropColumn(
                name: "TtsAudio_Mode",
                table: "TtsAudio");
        }
    }
}
