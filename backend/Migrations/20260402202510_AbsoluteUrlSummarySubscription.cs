using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AbsoluteUrlSummarySubscription : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Error",
                table: "resolved_directories");

            migrationBuilder.RenameColumn(
                name: "RelativePath",
                table: "resolved_directory_files",
                newName: "AbsoluteUrl");

            migrationBuilder.RenameColumn(
                name: "RelativeDirectoryPath",
                table: "resolved_directories",
                newName: "DirectoryUrl");

            migrationBuilder.RenameColumn(
                name: "RelativePath",
                table: "download_entries",
                newName: "AbsoluteUrl");

            migrationBuilder.RenameColumn(
                name: "PosterPath",
                table: "titles",
                newName: "PosterUrl");

            migrationBuilder.RenameColumn(
                name: "CoverPath",
                table: "titles",
                newName: "CoverUrl");

            migrationBuilder.AddColumn<int>(
                name: "Subscription",
                table: "users",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Summary",
                table: "titles",
                type: "character varying(4096)",
                maxLength: 4096,
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "AbsoluteUrl",
                table: "resolved_directory_files",
                type: "character varying(4096)",
                maxLength: 4096,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(2048)",
                oldMaxLength: 2048);

            migrationBuilder.AlterColumn<string>(
                name: "DirectoryUrl",
                table: "resolved_directories",
                type: "character varying(4096)",
                maxLength: 4096,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(2048)",
                oldMaxLength: 2048);

            migrationBuilder.AlterColumn<string>(
                name: "AbsoluteUrl",
                table: "download_entries",
                type: "character varying(4096)",
                maxLength: 4096,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(2048)",
                oldMaxLength: 2048);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Subscription",
                table: "users");

            migrationBuilder.DropColumn(
                name: "Summary",
                table: "titles");

            migrationBuilder.RenameColumn(
                name: "PosterUrl",
                table: "titles",
                newName: "PosterPath");

            migrationBuilder.RenameColumn(
                name: "CoverUrl",
                table: "titles",
                newName: "CoverPath");

            migrationBuilder.AddColumn<string>(
                name: "Error",
                table: "resolved_directories",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "AbsoluteUrl",
                table: "resolved_directory_files",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(4096)",
                oldMaxLength: 4096);

            migrationBuilder.AlterColumn<string>(
                name: "DirectoryUrl",
                table: "resolved_directories",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(4096)",
                oldMaxLength: 4096);

            migrationBuilder.AlterColumn<string>(
                name: "AbsoluteUrl",
                table: "download_entries",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(4096)",
                oldMaxLength: 4096);

            migrationBuilder.RenameColumn(
                name: "AbsoluteUrl",
                table: "resolved_directory_files",
                newName: "RelativePath");

            migrationBuilder.RenameColumn(
                name: "DirectoryUrl",
                table: "resolved_directories",
                newName: "RelativeDirectoryPath");

            migrationBuilder.RenameColumn(
                name: "AbsoluteUrl",
                table: "download_entries",
                newName: "RelativePath");
        }
    }
}
