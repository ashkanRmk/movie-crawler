using Microsoft.EntityFrameworkCore;

namespace MovieCrawler.Backend;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<TitleEntity> Titles => Set<TitleEntity>();
    public DbSet<DownloadSectionEntity> DownloadSections => Set<DownloadSectionEntity>();
    public DbSet<DownloadEntryEntity> DownloadEntries => Set<DownloadEntryEntity>();
    public DbSet<ResolvedDirectoryEntity> ResolvedDirectories => Set<ResolvedDirectoryEntity>();
    public DbSet<ResolvedDirectoryFileEntity> ResolvedDirectoryFiles => Set<ResolvedDirectoryFileEntity>();
    public DbSet<UserEntity> Users => Set<UserEntity>();
    public DbSet<SubscriptionPlanEntity> SubscriptionPlans => Set<SubscriptionPlanEntity>();
    public DbSet<CatalogSyncStateEntity> CatalogSyncStates => Set<CatalogSyncStateEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TitleEntity>(entity =>
        {
            entity.ToTable("titles");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.ImdbCode).HasMaxLength(32).IsRequired();
            entity.Property(x => x.Title).HasMaxLength(512).IsRequired();
            entity.Property(x => x.Type).HasMaxLength(32).IsRequired();
            entity.Property(x => x.ContentHash).HasMaxLength(128).IsRequired();
            entity.Property(x => x.Duration).HasMaxLength(64);
            entity.Property(x => x.CountryOrigin).HasMaxLength(256);
            entity.Property(x => x.Genres).HasMaxLength(512);
            entity.Property(x => x.Stars).HasMaxLength(1024);
            entity.Property(x => x.AgeRating).HasMaxLength(64);
            entity.Property(x => x.PosterUrl).HasMaxLength(1024);
            entity.Property(x => x.CoverUrl).HasMaxLength(1024);
            entity.Property(x => x.Summary).HasMaxLength(4096);
            entity.HasIndex(x => x.ImdbCode).IsUnique();
        });

        modelBuilder.Entity<DownloadSectionEntity>(entity =>
        {
            entity.ToTable("download_sections");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Scope).HasMaxLength(16).IsRequired();
            entity.Property(x => x.Label).HasMaxLength(256).IsRequired();
            entity.HasIndex(x => new { x.TitleId, x.Scope, x.SeasonNumber, x.Label, x.SortOrder });
            entity.HasOne(x => x.Title)
                .WithMany(x => x.DownloadSections)
                .HasForeignKey(x => x.TitleId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DownloadEntryEntity>(entity =>
        {
            entity.ToTable("download_entries");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Label).HasMaxLength(512).IsRequired();
            entity.Property(x => x.AbsoluteUrl).HasMaxLength(4096).IsRequired();
            entity.Property(x => x.SizeRaw).HasMaxLength(64);
            entity.HasIndex(x => new { x.DownloadSectionId, x.SortOrder });
            entity.HasOne(x => x.DownloadSection)
                .WithMany(x => x.Entries)
                .HasForeignKey(x => x.DownloadSectionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ResolvedDirectoryEntity>(entity =>
        {
            entity.ToTable("resolved_directories");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.DirectoryKey).HasMaxLength(2048).IsRequired();
            entity.Property(x => x.DirectoryUrl).HasMaxLength(4096).IsRequired();
            entity.HasIndex(x => x.DirectoryKey).IsUnique();
        });

        modelBuilder.Entity<ResolvedDirectoryFileEntity>(entity =>
        {
            entity.ToTable("resolved_directory_files");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Label).HasMaxLength(512).IsRequired();
            entity.Property(x => x.AbsoluteUrl).HasMaxLength(4096).IsRequired();
            entity.Property(x => x.SizeRaw).HasMaxLength(64);
            entity.Property(x => x.ParentGroupName).HasMaxLength(256);
            entity.HasIndex(x => new { x.ResolvedDirectoryId, x.SortOrder });
            entity.HasOne(x => x.ResolvedDirectory)
                .WithMany(x => x.Files)
                .HasForeignKey(x => x.ResolvedDirectoryId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<UserEntity>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Mobile).HasMaxLength(32).IsRequired();
            entity.Property(x => x.PasswordHash).HasMaxLength(512).IsRequired();
            entity.Property(x => x.Subscription).HasDefaultValue(0);
            entity.Property(x => x.SubscriptionExpiresAt);
            entity.HasIndex(x => x.Mobile).IsUnique();
        });

        modelBuilder.Entity<SubscriptionPlanEntity>(entity =>
        {
            entity.ToTable("subscription_plans");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Code).HasMaxLength(64).IsRequired();
            entity.Property(x => x.Title).HasMaxLength(128).IsRequired();
            entity.HasIndex(x => x.Code).IsUnique();

            entity.HasData(
                new SubscriptionPlanEntity
                {
                    Id = 1,
                    Code = "one_month",
                    Title = "اشتراک یک ماهه",
                    DurationMonths = 1,
                    PriceToman = 35000,
                    IsActive = true
                },
                new SubscriptionPlanEntity
                {
                    Id = 2,
                    Code = "three_month",
                    Title = "اشتراک سه ماهه",
                    DurationMonths = 3,
                    PriceToman = 95000,
                    IsActive = true
                });
        });

        modelBuilder.Entity<CatalogSyncStateEntity>(entity =>
        {
            entity.ToTable("catalog_sync_state");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.SourceUrl).HasMaxLength(2048).IsRequired();
            entity.Property(x => x.LastError).HasMaxLength(2048);
        });
    }
}

public sealed class TitleEntity
{
    public int Id { get; set; }
    public string ImdbCode { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int? Year { get; set; }
    public string Type { get; set; } = nameof(TitleType.Movie);
    public double ImdbRate { get; set; }
    public int ImdbVotes { get; set; }
    public bool IsDubbed { get; set; }
    public string ContentHash { get; set; } = string.Empty;

    public string? Duration { get; set; }
    public string? CountryOrigin { get; set; }
    public string? Genres { get; set; }
    public string? Stars { get; set; }
    public string? AgeRating { get; set; }
    public string? PosterUrl { get; set; }
    public string? CoverUrl { get; set; }
    public string? Summary { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public List<DownloadSectionEntity> DownloadSections { get; set; } = [];
}

public sealed class DownloadSectionEntity
{
    public int Id { get; set; }
    public int TitleId { get; set; }
    public string Scope { get; set; } = "movie";
    public int? SeasonNumber { get; set; }
    public string Label { get; set; } = string.Empty;
    public int SortOrder { get; set; }

    public TitleEntity? Title { get; set; }
    public List<DownloadEntryEntity> Entries { get; set; } = [];
}

public sealed class DownloadEntryEntity
{
    public int Id { get; set; }
    public int DownloadSectionId { get; set; }
    public string Label { get; set; } = string.Empty;
    public string AbsoluteUrl { get; set; } = string.Empty;
    public string? SizeRaw { get; set; }
    public int SortOrder { get; set; }

    public DownloadSectionEntity? DownloadSection { get; set; }
}

public sealed class ResolvedDirectoryEntity
{
    public int Id { get; set; }
    public string DirectoryKey { get; set; } = string.Empty;
    public string DirectoryUrl { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAt { get; set; }

    public List<ResolvedDirectoryFileEntity> Files { get; set; } = [];
}

public sealed class ResolvedDirectoryFileEntity
{
    public int Id { get; set; }
    public int ResolvedDirectoryId { get; set; }
    public string Label { get; set; } = string.Empty;
    public string AbsoluteUrl { get; set; } = string.Empty;
    public string? SizeRaw { get; set; }
    public string? ParentGroupName { get; set; }
    public int? SeasonNumber { get; set; }
    public int? EpisodeNumber { get; set; }
    public int SortOrder { get; set; }

    public ResolvedDirectoryEntity? ResolvedDirectory { get; set; }
}

public sealed class UserEntity
{
    public int Id { get; set; }
    public string Mobile { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public int Subscription { get; set; }
    public DateTimeOffset? SubscriptionExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class SubscriptionPlanEntity
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int DurationMonths { get; set; }
    public int PriceToman { get; set; }
    public bool IsActive { get; set; }
}

public sealed class CatalogSyncStateEntity
{
    public int Id { get; set; }
    public DateTimeOffset LastSyncedAt { get; set; }
    public string SourceUrl { get; set; } = string.Empty;
    public string? LastError { get; set; }
}
