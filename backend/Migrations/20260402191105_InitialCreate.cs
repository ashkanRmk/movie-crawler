using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "catalog_sync_state",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LastSyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    SourceUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    LastError = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_catalog_sync_state", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "resolved_directories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DirectoryKey = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    RelativeDirectoryPath = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    Error = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_resolved_directories", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "subscription_plans",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Title = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    DurationMonths = table.Column<int>(type: "integer", nullable: false),
                    PriceToman = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_subscription_plans", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "titles",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ImdbCode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Title = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: true),
                    Type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ImdbRate = table.Column<double>(type: "double precision", nullable: false),
                    ImdbVotes = table.Column<int>(type: "integer", nullable: false),
                    IsDubbed = table.Column<bool>(type: "boolean", nullable: false),
                    ContentHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Duration = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CountryOrigin = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Genres = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    Stars = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    AgeRating = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    PosterPath = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    CoverPath = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_titles", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Mobile = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PasswordHash = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "resolved_directory_files",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ResolvedDirectoryId = table.Column<int>(type: "integer", nullable: false),
                    Label = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    RelativePath = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    SizeRaw = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    ParentGroupName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    SeasonNumber = table.Column<int>(type: "integer", nullable: true),
                    EpisodeNumber = table.Column<int>(type: "integer", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_resolved_directory_files", x => x.Id);
                    table.ForeignKey(
                        name: "FK_resolved_directory_files_resolved_directories_ResolvedDirec~",
                        column: x => x.ResolvedDirectoryId,
                        principalTable: "resolved_directories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "download_sections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TitleId = table.Column<int>(type: "integer", nullable: false),
                    Scope = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SeasonNumber = table.Column<int>(type: "integer", nullable: true),
                    Label = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_download_sections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_download_sections_titles_TitleId",
                        column: x => x.TitleId,
                        principalTable: "titles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "download_entries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DownloadSectionId = table.Column<int>(type: "integer", nullable: false),
                    Label = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    RelativePath = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    SizeRaw = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_download_entries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_download_entries_download_sections_DownloadSectionId",
                        column: x => x.DownloadSectionId,
                        principalTable: "download_sections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "subscription_plans",
                columns: new[] { "Id", "Code", "DurationMonths", "IsActive", "PriceToman", "Title" },
                values: new object[,]
                {
                    { 1, "one_month", 1, true, 35000, "اشتراک یک ماهه" },
                    { 2, "three_month", 3, true, 95000, "اشتراک سه ماهه" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_download_entries_DownloadSectionId_SortOrder",
                table: "download_entries",
                columns: new[] { "DownloadSectionId", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_download_sections_TitleId_Scope_SeasonNumber_Label_SortOrder",
                table: "download_sections",
                columns: new[] { "TitleId", "Scope", "SeasonNumber", "Label", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_resolved_directories_DirectoryKey",
                table: "resolved_directories",
                column: "DirectoryKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_resolved_directory_files_ResolvedDirectoryId_SortOrder",
                table: "resolved_directory_files",
                columns: new[] { "ResolvedDirectoryId", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_subscription_plans_Code",
                table: "subscription_plans",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_titles_ImdbCode",
                table: "titles",
                column: "ImdbCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_Mobile",
                table: "users",
                column: "Mobile",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "catalog_sync_state");

            migrationBuilder.DropTable(
                name: "download_entries");

            migrationBuilder.DropTable(
                name: "resolved_directory_files");

            migrationBuilder.DropTable(
                name: "subscription_plans");

            migrationBuilder.DropTable(
                name: "users");

            migrationBuilder.DropTable(
                name: "download_sections");

            migrationBuilder.DropTable(
                name: "resolved_directories");

            migrationBuilder.DropTable(
                name: "titles");
        }
    }
}
