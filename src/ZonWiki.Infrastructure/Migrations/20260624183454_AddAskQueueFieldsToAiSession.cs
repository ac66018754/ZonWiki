using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ZonWiki.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAskQueueFieldsToAiSession : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AiSession_AnchorText",
                table: "AiSession",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AiSession_AnswerNoteId",
                table: "AiSession",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AiSession_ErrorText",
                table: "AiSession",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AiSession_MarkId",
                table: "AiSession",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AiSession_NoteId",
                table: "AiSession",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AiSession_QuestionText",
                table: "AiSession",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AiSession_AnchorText",
                table: "AiSession");

            migrationBuilder.DropColumn(
                name: "AiSession_AnswerNoteId",
                table: "AiSession");

            migrationBuilder.DropColumn(
                name: "AiSession_ErrorText",
                table: "AiSession");

            migrationBuilder.DropColumn(
                name: "AiSession_MarkId",
                table: "AiSession");

            migrationBuilder.DropColumn(
                name: "AiSession_NoteId",
                table: "AiSession");

            migrationBuilder.DropColumn(
                name: "AiSession_QuestionText",
                table: "AiSession");
        }
    }
}
