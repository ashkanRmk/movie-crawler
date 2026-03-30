import { type MouseEvent as ReactMouseEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { fetchCatalog, resolveDirectoryLinks } from "./api";
import type { CatalogItem, DownloadGroup, DownloadLink, SeasonGroup, TitleType } from "./types";
import "./styles.css";

const SORT_OPTIONS = [
  { label: "IMDb", value: "rate" },
  { label: "تعداد رای", value: "votes" },
  { label: "سال", value: "date" }
] as const;

const ART_STYLES = [
  ["#74f2ce", "#2d79f3", "#091327"],
  ["#ffd36f", "#fd5e89", "#2d1223"],
  ["#f9a66c", "#ffda79", "#231532"],
  ["#8ff7d4", "#50a7ff", "#071b2f"],
  ["#e7b2ff", "#6373ff", "#180f2d"],
  ["#ff9270", "#fdcd5a", "#28140d"]
];

type SortKey = (typeof SORT_OPTIONS)[number]["value"];
type SyncState = "idle" | "loading" | "error";
type BrowseMode = "home" | "movie" | "tvSeries";
type ShareState =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }
  | null;
type DirectoryResolutionState = {
  itemId: string;
  loading: boolean;
  movieDownloads: DownloadGroup[];
  seasonDownloads: SeasonGroup[];
  sectionErrors: Record<string, string>;
  pendingSections: Record<string, boolean>;
};
type ResolvedSeasonBucket = {
  seasonNumber: number | null;
  links: DownloadLink[];
};
type ResolvedParentBucket = {
  parentGroupName: string;
  seasons: ResolvedSeasonBucket[];
};

const VIDEO_FILE_EXTENSIONS = new Set([
  ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".m2ts", ".webm", ".flv", ".mpeg", ".mpg"
]);
const DIRECTORY_CHUNK_THRESHOLD = 3;
const DIRECTORY_CHUNK_SIZE = 3;
const EPISODE_ORDINAL_WORDS: Record<number, string> = {
  1: "اول",
  2: "دوم",
  3: "سوم",
  4: "چهارم",
  5: "پنجم",
  6: "ششم",
  7: "هفتم",
  8: "هشتم",
  9: "نهم",
  10: "دهم",
  11: "یازدهم",
  12: "دوازدهم",
  13: "سیزدهم",
  14: "چهاردهم",
  15: "پانزدهم",
  16: "شانزدهم",
  17: "هفدهم",
  18: "هجدهم",
  19: "نوزدهم",
  20: "بیستم"
};

function hashTitle(value: string): number {
  return value.split("").reduce((acc, char) => acc * 31 + char.charCodeAt(0), 7);
}

function getArtwork(item: CatalogItem) {
  const palette = ART_STYLES[Math.abs(hashTitle(item.id)) % ART_STYLES.length];
  const initials = item.title
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return {
    initials,
    background: `linear-gradient(145deg, ${palette[0]} 0%, ${palette[1]} 55%, ${palette[2]} 100%)`
  };
}

function formatType(type: TitleType): string {
  return type === "Movie" ? "فیلم" : "سریال";
}

function localizeDynamicLabel(value: string): string {
  return value
    .replace(/soft[\s-]?sub/gi, "زیرنویس چسبیده")
    .replace(/dubbed/gi, "نسخه دوبله شده");
}

function getUrlPath(url: string): string | null {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    const trimmed = url.trim();
    if (!trimmed) {
      return null;
    }

    const withoutQuery = trimmed.split(/[?#]/)[0];
    return withoutQuery.toLowerCase();
  }
}

function isVideoFileUrl(url: string): boolean {
  const pathname = getUrlPath(url);
  if (!pathname) {
    return false;
  }

  const dotIndex = pathname.lastIndexOf(".");
  if (dotIndex === -1) {
    return false;
  }

  return VIDEO_FILE_EXTENSIONS.has(pathname.slice(dotIndex));
}

function isDirectoryLink(url: string): boolean {
  return !isVideoFileUrl(url);
}

function toDirectoryResolveKey(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function buildSectionError(
  sectionErrors: Record<string, string>,
  sectionKey: string,
  message: string
): Record<string, string> {
  if (sectionErrors[sectionKey]) {
    return sectionErrors;
  }

  return { ...sectionErrors, [sectionKey]: message };
}

function isResolvedDirectoryLink(link: DownloadLink): boolean {
  return Boolean(link.parentGroupName ?? link.seasonNumber ?? link.episodeNumber);
}

function toPersianNumber(value: number): string {
  return value.toLocaleString("fa-IR");
}

function formatEpisodeLabel(link: DownloadLink): string {
  if (!link.episodeNumber || link.episodeNumber <= 0) {
    return localizeDynamicLabel(link.label);
  }

  const ordinal = EPISODE_ORDINAL_WORDS[link.episodeNumber];
  if (ordinal) {
    return `قسمت ${ordinal}`;
  }

  return `قسمت ${toPersianNumber(link.episodeNumber)}`;
}

function formatSeasonTitle(seasonNumber: number | null): string {
  if (seasonNumber === null) {
    return "سایر";
  }

  const ordinal = EPISODE_ORDINAL_WORDS[seasonNumber];
  if (ordinal) {
    return `فصل ${ordinal}`;
  }

  return `فصل ${toPersianNumber(seasonNumber)}`;
}

function toResolvedBuckets(links: DownloadLink[]): ResolvedParentBucket[] {
  const resolvedLinks = links.filter(isResolvedDirectoryLink);
  const grouped = new Map<string, Map<number | null, DownloadLink[]>>();

  resolvedLinks.forEach((link) => {
    const parentGroupName = link.parentGroupName?.trim() || "سایر";
    const seasonKey = link.seasonNumber ?? null;
    const parentMap = grouped.get(parentGroupName) ?? new Map<number | null, DownloadLink[]>();
    if (!grouped.has(parentGroupName)) {
      grouped.set(parentGroupName, parentMap);
    }

    const seasonLinks = parentMap.get(seasonKey) ?? [];
    if (!parentMap.has(seasonKey)) {
      parentMap.set(seasonKey, seasonLinks);
    }

    seasonLinks.push(link);
  });

  return Array.from(grouped.entries()).map(([parentGroupName, seasonsMap]) => ({
    parentGroupName,
    seasons: Array.from(seasonsMap.entries())
      .map(([seasonNumber, seasonLinks]) => ({
        seasonNumber,
        links: seasonLinks
      }))
      .sort((a, b) => {
        if (a.seasonNumber === null) return 1;
        if (b.seasonNumber === null) return -1;
        return a.seasonNumber - b.seasonNumber;
      })
  }));
}

function withoutDirectoryLinks(links: DownloadLink[]): DownloadLink[] {
  return links.filter((link) => !isDirectoryLink(link.url));
}

function withoutDirectoryLinksInMovieGroups(groups: DownloadGroup[]): DownloadGroup[] {
  return groups.map((group) => ({
    ...group,
    links: withoutDirectoryLinks(group.links)
  }));
}

function withoutDirectoryLinksInSeasonGroups(seasons: SeasonGroup[]): SeasonGroup[] {
  return seasons.map((season) => ({
    ...season,
    groups: season.groups.map((group) => ({
      ...group,
      links: withoutDirectoryLinks(group.links)
    }))
  }));
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    return [items];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function DirectorySectionSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="drawer-section-skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton-line drawer-section-skeleton-line" />
      ))}
    </div>
  );
}

function CardBadges({ item }: { item: CatalogItem }) {
  return (
    <div className="card-art-badges">
      <span className="card-art-badge">{formatType(item.type)}</span>
      {item.isDubbed ? <span className="card-art-badge dubbed">دوبله شده</span> : null}
    </div>
  );
}

function DownloadLinksBlock({ links }: { links: DownloadLink[] }) {
  const plainLinks = links.filter((link) => !isResolvedDirectoryLink(link));
  const resolvedBuckets = toResolvedBuckets(links);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOpenSections({});
  }, [links]);

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <>
      {plainLinks.length > 0 ? (
        <div className="download-grid">
          {plainLinks.map((link) => (
            <a key={link.url} href={link.url} className="download-link" target="_blank" rel="noreferrer">
              <span>{localizeDynamicLabel(link.label)}</span>
              <strong>{link.size ?? "باز کردن"}</strong>
            </a>
          ))}
        </div>
      ) : null}

      {resolvedBuckets.map((bucket) => (
        <div key={bucket.parentGroupName} className="season-group">
          {(() => {
            const sectionKey = bucket.parentGroupName;
            const isOpen = Boolean(openSections[sectionKey]);
            const totalEpisodes = bucket.seasons.reduce((sum, season) => sum + season.links.length, 0);
            return (
              <>
                <button
                  type="button"
                  className="resolved-collapsible-trigger"
                  onClick={() => toggleSection(sectionKey)}
                  aria-expanded={isOpen}
                >
                  <span className="resolved-group-season-title">{localizeDynamicLabel(bucket.parentGroupName)}</span>
                  <span className="resolved-collapsible-meta">
                    {totalEpisodes.toLocaleString("fa-IR")} قسمت {isOpen ? "▾" : "▸"}
                  </span>
                </button>
                {isOpen ? (
                  <div className="season-stack">
                    {bucket.seasons.map((season) => (
                      <div key={`${bucket.parentGroupName}:${season.seasonNumber ?? "other"}`} className="season-group">
                        {season.seasonNumber !== null ? (
                          <span className="season-label">{formatSeasonTitle(season.seasonNumber)}</span>
                        ) : null}
                        <div className="download-grid">
                          {season.links.map((link) => (
                            <a key={link.url} href={link.url} className="download-link" target="_blank" rel="noreferrer">
                              <span>{formatEpisodeLabel(link)}</span>
                              <strong>{link.size ?? "باز کردن"}</strong>
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            );
          })()}
        </div>
      ))}
    </>
  );
}

function formatCompactVotes(votes: number): string {
  if (votes >= 1_000_000) {
    return `${(votes / 1_000_000).toFixed(1)} میلیون رای`;
  }

  if (votes >= 1_000) {
    return `${(votes / 1_000).toFixed(0)} هزار رای`;
  }

  return `${votes.toLocaleString("fa-IR")} رای`;
}

function sortItems(items: CatalogItem[], sort: SortKey, order: "asc" | "desc") {
  const sorted = [...items];
  const direction = order === "asc" ? 1 : -1;

  sorted.sort((left, right) => {
    if (sort === "rate") {
      return (left.imdbRate - right.imdbRate) * direction;
    }

    if (sort === "votes") {
      return (left.imdbVotes - right.imdbVotes) * direction;
    }

    return ((left.year ?? 0) - (right.year ?? 0)) * direction;
  });

  return sorted;
}

const ImdbIcon = () => (
  <svg viewBox="0 0 64 32" aria-hidden="true">
    <rect x="1" y="1" width="62" height="30" rx="6" fill="currentColor" />
    <path
      d="M10 24h4V8h-4v16zm10-10c0-2 1-3 3-3 1.9 0 3 1 3 3v10h-4V14c0-0.7-0.3-1-0.9-1s-1.1 0.4-1.1 1.1V24h-4V14zm16-3h-4v13h4c3.5 0 6-2.2 6-6.4 0-4.5-2.4-6.6-6-6.6zm0 3c1.5 0 2.6 1.2 2.6 3.6 0 2.2-1.1 3.4-2.6 3.4h-0.1V14h0.1zm16-3h-4v13h4c3.5 0 6-2.2 6-6.4 0-4.5-2.4-6.6-6-6.6zm0 3c1.5 0 2.6 1.2 2.6 3.6 0 2.2-1.1 3.4-2.6 3.4h-0.1V14h0.1z"
      fill="#111111"
    />
  </svg>
);

function SkeletonCards() {
  return (
    <section className="browse-grid" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="catalog-card skeleton-card">
          <div className="card-art skeleton-block" />
          <div className="skeleton-line skeleton-title" />
          <div className="skeleton-line skeleton-meta" />
          <div className="skeleton-line skeleton-meta short" />
        </div>
      ))}
    </section>
  );
}

function RowCards({ items, onOpen }: { items: CatalogItem[]; onOpen: (itemId: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
    lastX: number;
    lastTime: number;
    velocity: number;
  }>({
    active: false,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
    lastX: 0,
    lastTime: 0,
    velocity: 0
  });
  const suppressClickRef = useRef(false);
  const inertiaRafRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const stopInertia = () => {
    if (inertiaRafRef.current === null) {
      return;
    }

    cancelAnimationFrame(inertiaRafRef.current);
    inertiaRafRef.current = null;
  };

  const startInertia = () => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let velocity = dragStateRef.current.velocity;
    if (Math.abs(velocity) < 0.02) {
      return;
    }

    const step = () => {
      const node = containerRef.current;
      if (!node) {
        inertiaRafRef.current = null;
        return;
      }

      node.scrollLeft -= velocity * 16;
      velocity *= 0.92;

      if (Math.abs(velocity) < 0.02) {
        inertiaRafRef.current = null;
        return;
      }

      inertiaRafRef.current = requestAnimationFrame(step);
    };

    inertiaRafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    return () => {
      stopInertia();
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleMouseMove = (event: MouseEvent) => {
    const container = containerRef.current;
    if (!container || !dragStateRef.current.active) {
      return;
    }

    const now = performance.now();
    const deltaFromLast = event.clientX - dragStateRef.current.lastX;
    const dt = now - dragStateRef.current.lastTime;
    if (dt > 0) {
      dragStateRef.current.velocity = deltaFromLast / dt;
    }
    dragStateRef.current.lastX = event.clientX;
    dragStateRef.current.lastTime = now;

    const deltaX = event.clientX - dragStateRef.current.startX;
    if (Math.abs(deltaX) > 6) {
      dragStateRef.current.moved = true;
      if (!isDragging) {
        setIsDragging(true);
      }
    }

    container.scrollLeft = dragStateRef.current.startScrollLeft - deltaX;
    event.preventDefault();
  };

  const handleMouseUp = () => {
    if (!dragStateRef.current.active) {
      return;
    }

    dragStateRef.current.active = false;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);

    suppressClickRef.current = dragStateRef.current.moved;
    setIsDragging(false);
    if (dragStateRef.current.moved) {
      startInertia();
    }
    dragStateRef.current.moved = false;
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    stopInertia();

    const now = performance.now();
    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startScrollLeft: container.scrollLeft,
      moved: false,
      lastX: event.clientX,
      lastTime: now,
      velocity: 0
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: false });
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) {
      return;
    }

    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={containerRef}
      className={isDragging ? "category-scroll dragging" : "category-scroll"}
      role="list"
      onMouseDown={handleMouseDown}
      onClickCapture={handleClickCapture}
    >
      {items.map((item) => {
        const artwork = getArtwork(item);

        return (
          <button
            key={item.id}
            type="button"
            className="catalog-card row-card"
            onClick={() => onOpen(item.id)}
            role="listitem"
          >
            <div className="card-art" style={{ background: artwork.background }}>
              <div className="card-art-noise" />
              <span className="card-imdb-badge">IMDb {item.imdbRate.toFixed(1)}</span>
              <span className="card-art-initials">{artwork.initials}</span>
              <CardBadges item={item} />
            </div>

            <div className="catalog-copy">
              <h3 className="catalog-title" title={item.title}>{item.title}</h3>
              <p className="catalog-meta">
                <span>{item.year ?? "نامشخص"}</span>
                <span>{formatCompactVotes(item.imdbVotes)}</span>
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const readRequestedTitle = () => {
    if (typeof window === "undefined") {
      return null;
    }

    return new URL(window.location.href).searchParams.get("title");
  };

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [sort, setSort] = useState<SortKey>("rate");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [dubbedOnly, setDubbedOnly] = useState(false);
  const [browseMode, setBrowseMode] = useState<BrowseMode>("home");
  const [categoryRenderedCount, setCategoryRenderedCount] = useState(20);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pendingSharedTitle, setPendingSharedTitle] = useState<string | null>(() => readRequestedTitle());
  const [shareState, setShareState] = useState<ShareState>(null);
  const [directoryResolution, setDirectoryResolution] = useState<DirectoryResolutionState | null>(null);
  const [showScrollTopButton, setShowScrollTopButton] = useState(false);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const loadCatalog = async () => {
    setError(null);
    setSyncState("loading");

    try {
      const response = await fetchCatalog({});
      setItems(response.items);
      setSyncState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "دریافت فهرست با خطا مواجه شد");
      setSyncState("error");
    }
  };

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setPendingSharedTitle(readRequestedTitle());
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const toggleScrollTopButton = () => {
      setShowScrollTopButton(window.scrollY > 700);
    };

    toggleScrollTopButton();
    window.addEventListener("scroll", toggleScrollTopButton, { passive: true });
    return () => window.removeEventListener("scroll", toggleScrollTopButton);
  }, []);

  const trimmedQuery = deferredQuery.trim().toLowerCase();

  const filteredItems = useMemo(() => {
    let next = [...items];

    if (trimmedQuery) {
      next = next.filter((item) => item.title.toLowerCase().includes(trimmedQuery));
    }

    if (dubbedOnly) {
      next = next.filter((item) => item.isDubbed);
    }

    return sortItems(next, sort, order);
  }, [dubbedOnly, items, order, sort, trimmedQuery]);

  useEffect(() => {
    if (trimmedQuery && browseMode !== "home") {
      setBrowseMode("home");
    }
  }, [browseMode, trimmedQuery]);

  const movieItems = useMemo(
    () => filteredItems.filter((item) => item.type === "Movie").slice(0, 17),
    [filteredItems]
  );
  const seriesItems = useMemo(
    () => filteredItems.filter((item) => item.type === "TvSeries").slice(0, 17),
    [filteredItems]
  );

  const categoryItems = useMemo(() => {
    if (browseMode === "movie") {
      return filteredItems.filter((item) => item.type === "Movie");
    }

    if (browseMode === "tvSeries") {
      return filteredItems.filter((item) => item.type === "TvSeries");
    }

    return [] as CatalogItem[];
  }, [browseMode, filteredItems]);

  const isSearchMode = trimmedQuery.length > 0;
  const showGrid = isSearchMode || browseMode !== "home";
  const gridItems = isSearchMode ? filteredItems : categoryItems.slice(0, categoryRenderedCount);
  const canLoadMoreCategory =
    !isSearchMode && browseMode !== "home" && categoryRenderedCount < categoryItems.length;

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeId) ?? null,
    [activeId, items]
  );

  const navigableItems = useMemo(() => {
    if (showGrid) {
      return gridItems;
    }

    return [...movieItems, ...seriesItems];
  }, [gridItems, movieItems, seriesItems, showGrid]);

  useEffect(() => {
    if (browseMode === "home" || isSearchMode) {
      return;
    }

    setCategoryRenderedCount(20);
  }, [browseMode, isSearchMode]);

  useEffect(() => {
    if (isSearchMode || browseMode === "home") {
      return;
    }

    setCategoryRenderedCount((prev) => Math.min(Math.max(20, prev), categoryItems.length || 20));
  }, [browseMode, categoryItems.length, isSearchMode]);

  useEffect(() => {
    if (!canLoadMoreCategory) {
      return;
    }

    const node = loadMoreRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setCategoryRenderedCount((prev) => Math.min(prev + 20, categoryItems.length));
          }
        });
      },
      { rootMargin: "320px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadMoreCategory, categoryItems.length]);

  useEffect(() => {
    if (activeId && !filteredItems.some((item) => item.id === activeId)) {
      setActiveId(null);
      setIsDrawerOpen(false);
    }
  }, [activeId, filteredItems]);

  useEffect(() => {
    if (!isDrawerOpen) {
      previouslyFocusedRef.current?.focus();
      return;
    }

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusTarget = drawerRef.current?.querySelector<HTMLElement>(
      "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );
    focusTarget?.focus();
  }, [isDrawerOpen]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (!isDrawerOpen) {
      return;
    }

    const { body } = document;
    const scrollY = window.scrollY;
    const previousPosition = body.style.position;
    const previousTop = body.style.top;
    const previousLeft = body.style.left;
    const previousRight = body.style.right;
    const previousWidth = body.style.width;
    const previousOverflow = body.style.overflow;

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = previousPosition;
      body.style.top = previousTop;
      body.style.left = previousLeft;
      body.style.right = previousRight;
      body.style.width = previousWidth;
      body.style.overflow = previousOverflow;
      window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });
    };
  }, [isDrawerOpen]);

  useEffect(() => {
    if (!isSortMenuOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsSortMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSortMenuOpen]);

  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }

    setIsSortMenuOpen(false);
  }, [isDrawerOpen]);

  useEffect(() => {
    setShareState(null);
  }, [activeId]);

  useEffect(() => {
    if (!activeItem) {
      setDirectoryResolution(null);
      return;
    }

    const collectDirectoryUrls = () => {
      const urls = new Set<string>();

      activeItem.downloads.forEach((group) => {
        group.links.forEach((link) => {
          if (isDirectoryLink(link.url)) {
            urls.add(link.url);
          }
        });
      });

      activeItem.seasons.forEach((season) => {
        season.groups.forEach((group) => {
          group.links.forEach((link) => {
            if (isDirectoryLink(link.url)) {
              urls.add(link.url);
            }
          });
        });
      });

      return Array.from(urls);
    };

    const directoryUrls = collectDirectoryUrls();
    if (directoryUrls.length === 0) {
      setDirectoryResolution({
        itemId: activeItem.id,
        loading: false,
        movieDownloads: activeItem.downloads,
        seasonDownloads: activeItem.seasons,
        sectionErrors: {},
        pendingSections: {}
      });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const urlByKey = new Map<string, string>();
    const sectionToDirectoryKeys = new Map<string, Set<string>>();
    const directoryKeys = new Set<string>();

    const registerDirectoryLink = (url: string, sectionKey: string) => {
      if (!isDirectoryLink(url)) {
        return;
      }

      const key = toDirectoryResolveKey(url);
      if (!key) {
        return;
      }

      const normalizedUrl = url.trim();
      if (!normalizedUrl) {
        return;
      }

      directoryKeys.add(key);
      if (!urlByKey.has(key)) {
        urlByKey.set(key, normalizedUrl);
      }

      const sectionKeys = sectionToDirectoryKeys.get(sectionKey) ?? new Set<string>();
      sectionKeys.add(key);
      if (!sectionToDirectoryKeys.has(sectionKey)) {
        sectionToDirectoryKeys.set(sectionKey, sectionKeys);
      }
    };

    activeItem.downloads.forEach((group) => {
      const sectionKey = `movie:${group.label}`;
      group.links.forEach((link) => registerDirectoryLink(link.url, sectionKey));
    });

    activeItem.seasons.forEach((season) => {
      season.groups.forEach((group) => {
        const sectionKey = `season:${season.seasonNumber}:${group.label}`;
        group.links.forEach((link) => registerDirectoryLink(link.url, sectionKey));
      });
    });

    const allDirectoryKeys = Array.from(directoryKeys);
    if (allDirectoryKeys.length === 0) {
      setDirectoryResolution({
        itemId: activeItem.id,
        loading: false,
        movieDownloads: activeItem.downloads,
        seasonDownloads: activeItem.seasons,
        sectionErrors: {},
        pendingSections: {}
      });
      return;
    }

    const run = async () => {
      try {
        const resolvedByKey = new Map<string, { links: DownloadLink[]; error?: string | null }>();
        const completedKeys = new Set<string>();
        let sectionErrors: Record<string, string> = {};

        const getPendingSections = (): Record<string, boolean> => {
          const pendingSections: Record<string, boolean> = {};
          sectionToDirectoryKeys.forEach((keys, sectionKey) => {
            const hasPending = Array.from(keys).some((key) => !completedKeys.has(key));
            if (hasPending) {
              pendingSections[sectionKey] = true;
            }
          });
          return pendingSections;
        };

        const markSectionsForKeyError = (key: string, message: string) => {
          sectionToDirectoryKeys.forEach((keys, sectionKey) => {
            if (keys.has(key)) {
              sectionErrors = buildSectionError(sectionErrors, sectionKey, message);
            }
          });
        };

        const buildResolvedDownloads = () => {
          const resolveGroupLinks = (links: DownloadLink[], sectionKey: string): DownloadLink[] => {
            const nextLinks: DownloadLink[] = [];

            links.forEach((link) => {
              if (!isDirectoryLink(link.url)) {
                nextLinks.push(link);
                return;
              }

              const resolvedEntry = resolvedByKey.get(toDirectoryResolveKey(link.url));
              if (!resolvedEntry) {
                return;
              }

              if (resolvedEntry.error) {
                sectionErrors = buildSectionError(sectionErrors, sectionKey, resolvedEntry.error);
                return;
              }

              if (resolvedEntry.links.length === 0) {
                sectionErrors = buildSectionError(sectionErrors, sectionKey, "فایلی در پوشه پیدا نشد.");
                return;
              }

              nextLinks.push(...resolvedEntry.links);
            });

            return nextLinks;
          };

          const movieDownloads = activeItem.downloads.map((group) => ({
            ...group,
            links: resolveGroupLinks(group.links, `movie:${group.label}`)
          }));

          const seasonDownloads = activeItem.seasons.map((season) => ({
            ...season,
            groups: season.groups.map((group) => ({
              ...group,
              links: resolveGroupLinks(group.links, `season:${season.seasonNumber}:${group.label}`)
            }))
          }));

          return { movieDownloads, seasonDownloads };
        };

        const publishState = () => {
          if (cancelled) {
            return;
          }

          const { movieDownloads, seasonDownloads } = buildResolvedDownloads();
          const pendingSections = getPendingSections();
          setDirectoryResolution({
            itemId: activeItem.id,
            loading: Object.keys(pendingSections).length > 0,
            movieDownloads,
            seasonDownloads,
            sectionErrors,
            pendingSections
          });
        };

        setDirectoryResolution({
          itemId: activeItem.id,
          loading: true,
          movieDownloads: withoutDirectoryLinksInMovieGroups(activeItem.downloads),
          seasonDownloads: withoutDirectoryLinksInSeasonGroups(activeItem.seasons),
          sectionErrors: {},
          pendingSections: getPendingSections()
        });

        const requestUrls = Array.from(urlByKey.values());
        const chunks = requestUrls.length > DIRECTORY_CHUNK_THRESHOLD
          ? chunkArray(requestUrls, DIRECTORY_CHUNK_SIZE)
          : [requestUrls];

        for (const chunkUrls of chunks) {
          if (cancelled) {
            return;
          }

          const chunkKeys = new Set(chunkUrls.map((url) => toDirectoryResolveKey(url)));

          try {
            const resolved = await resolveDirectoryLinks(chunkUrls, controller.signal);
            if (cancelled) {
              return;
            }

            const seenKeys = new Set<string>();
            resolved.results.forEach((entry) => {
              const key = toDirectoryResolveKey(entry.url);
              if (!chunkKeys.has(key)) {
                return;
              }

              resolvedByKey.set(key, { links: entry.links, error: entry.error });
              completedKeys.add(key);
              seenKeys.add(key);
            });

            chunkKeys.forEach((key) => {
              if (!seenKeys.has(key)) {
                markSectionsForKeyError(key, "پاسخ استخراج لینک برای پوشه دریافت نشد.");
                completedKeys.add(key);
              }
            });

            publishState();
          } catch (err) {
            if (cancelled || (err instanceof DOMException && err.name === "AbortError")) {
              return;
            }

            const message = err instanceof Error ? err.message : "استخراج پوشه با خطا مواجه شد.";
            chunkKeys.forEach((key) => {
              markSectionsForKeyError(key, message);
              completedKeys.add(key);
            });
            publishState();
          }
        }
      } catch (err) {
        if (cancelled) {
          return;
        }

        setDirectoryResolution({
          itemId: activeItem.id,
          loading: false,
          movieDownloads: withoutDirectoryLinksInMovieGroups(activeItem.downloads),
          seasonDownloads: withoutDirectoryLinksInSeasonGroups(activeItem.seasons),
          sectionErrors: {
            global: err instanceof Error ? err.message : "استخراج پوشه با خطا مواجه شد."
          },
          pendingSections: {}
        });
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeItem]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    if (isDrawerOpen && activeItem) {
      url.searchParams.set("title", activeItem.imdbCode);
    } else if (!pendingSharedTitle) {
      url.searchParams.delete("title");
    } else {
      return;
    }

    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [activeItem, isDrawerOpen, pendingSharedTitle]);

  useEffect(() => {
    if (!pendingSharedTitle) {
      setActiveId(null);
      setIsDrawerOpen(false);
      return;
    }

    if (items.length === 0) {
      return;
    }

    const matchedItem = items.find((item) => item.imdbCode === pendingSharedTitle);
    if (!matchedItem) {
      return;
    }

    setActiveId(matchedItem.id);
    setIsDrawerOpen(true);
  }, [items, pendingSharedTitle]);

  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }

      if (event.key === "Tab") {
        const focusables = drawerRef.current?.querySelectorAll<HTMLElement>(
          "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
        );

        if (!focusables || focusables.length === 0) {
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }

        return;
      }

      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
        return;
      }

      if (!activeId || navigableItems.length === 0) {
        return;
      }

      const currentIndex = navigableItems.findIndex((item) => item.id === activeId);
      if (currentIndex === -1) {
        return;
      }

      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + delta + navigableItems.length) % navigableItems.length;
      setActiveId(navigableItems[nextIndex].id);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeId, isDrawerOpen, navigableItems]);

  const openItem = (itemId: string) => {
    setActiveId(itemId);
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setActiveId(null);
    setIsDrawerOpen(false);
    setPendingSharedTitle(null);
  };

  const applySort = (value: SortKey) => {
    setSort(value);
  };

  const applyOrder = (value: "asc" | "desc") => {
    setOrder(value);
  };

  const openCategory = (type: "movie" | "tvSeries") => {
    setBrowseMode(type);
  };

  const backToHome = () => {
    setBrowseMode("home");
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  };

  const shareTitle = async (item: CatalogItem) => {
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set("title", item.imdbCode);

    const method = typeof navigator !== "undefined" && typeof navigator.share === "function"
      ? "web_share"
      : "copy_link";

    try {
      if (method === "web_share") {
        await navigator.share({
          title: item.title,
          text: `نمایش ${item.title} در سکانس.`,
          url: shareUrl.toString()
        });
        setShareState({ tone: "success", message: "با موفقیت ارسال شد" });
        return;
      }

      if (!navigator.clipboard?.writeText) {
        throw new Error("امکان کپی لینک در این مرورگر وجود ندارد.");
      }

      await navigator.clipboard.writeText(shareUrl.toString());
      setShareState({ tone: "success", message: "لینک کپی شد" });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      setShareState({
        tone: "error",
        message: err instanceof Error ? err.message : "اشتراک‌گذاری ناموفق بود"
      });
    }
  };

  const hasNoResults = syncState !== "loading" && (showGrid ? gridItems.length === 0 : movieItems.length + seriesItems.length === 0) && !error;
  const appClassName = isDrawerOpen ? "app drawer-active" : "app";
  const resolvedForActive =
    activeItem && directoryResolution?.itemId === activeItem.id
      ? directoryResolution
      : null;
  const displayedMovieDownloads = resolvedForActive?.movieDownloads ?? activeItem?.downloads ?? [];
  const displayedSeasonDownloads = resolvedForActive?.seasonDownloads ?? activeItem?.seasons ?? [];

  const searchControl = (
    <label className="hero-search">
      <span className="sr-only">جستجو</span>
      <input
        type="search"
        placeholder="جستجو در عنوان فیلم یا سریال..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </label>
  );

  return (
    <div className={appClassName}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="hero glass-panel">
        <div className="hero-copy">
          <h1>🎬 سکانس</h1>
          <p className="hero-text">
            دنیای کامل فیلم و سریال، همیشه در دسترس تو
          </p>
          <div className="hero-controls">
            {searchControl}
            <div className="hero-sort-controls">
              <span className="sort-title">مرتب سازی بر اساس</span>
              <div className="chip-row sort-chip-row">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={sort === option.value ? "chip active" : "chip"}
                    onClick={() => applySort(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={dubbedOnly ? "chip active" : "chip"}
                  onClick={() => setDubbedOnly((prev) => !prev)}
                >
                  فقط دوبله شده
                </button>
                <button
                  type="button"
                  className={order === "desc" ? "sort-icon-btn active" : "sort-icon-btn"}
                  onClick={() => applyOrder("desc")}
                  aria-label="نزولی"
                  title="نزولی"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={order === "asc" ? "sort-icon-btn active" : "sort-icon-btn"}
                  onClick={() => applyOrder("asc")}
                  aria-label="صعودی"
                  title="صعودی"
                >
                  ↑
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mobile-sticky-controls">
        {searchControl}
        <button
          type="button"
          className="mobile-sort-trigger"
          aria-label="باز کردن مرتب‌سازی"
          aria-expanded={isSortMenuOpen}
          onClick={() => setIsSortMenuOpen(true)}
        >
          ☰
        </button>
      </div>

      {error ? (
        <section className="feedback-panel error-panel glass-panel">
          <p className="section-kicker">خطا</p>
          <h2>دریافت فهرست انجام نشد</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {syncState === "loading" ? <SkeletonCards /> : null}

      {syncState !== "loading" && !hasNoResults ? (
        <>
          {showGrid ? (
            <>
              <section className="section-header browse-header show-all-header">
                <div>
                  <h2>
                    {isSearchMode
                      ? `${gridItems.length.toLocaleString("fa-IR")} نتیجه`
                      : browseMode === "movie"
                        ? "همه فیلم‌ها"
                        : "همه سریال‌ها"}
                  </h2>
                </div>
                {!isSearchMode ? (
                  <div className="browse-header-actions">
                    <button type="button" className="chip" onClick={backToHome}>
                      بازگشت به صفحه اصلی
                    </button>
                  </div>
                ) : null}
              </section>

              <section className="browse-grid">
                {gridItems.map((item) => {
                  const artwork = getArtwork(item);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="catalog-card"
                      onClick={() => openItem(item.id)}
                    >
                      <div className="card-art" style={{ background: artwork.background }}>
                        <div className="card-art-noise" />
                        <span className="card-imdb-badge">IMDb {item.imdbRate.toFixed(1)}</span>
                        <span className="card-art-initials">{artwork.initials}</span>
                        <CardBadges item={item} />
                      </div>

                      <div className="catalog-copy">
                        <h3 className="catalog-title" title={item.title}>{item.title}</h3>
                        <p className="catalog-meta">
                          <span>{item.year ?? "نامشخص"}</span>
                          <span>{formatCompactVotes(item.imdbVotes)}</span>
                        </p>
                      </div>
                    </button>
                  );
                })}
              </section>
              {canLoadMoreCategory ? <div ref={loadMoreRef} className="infinite-sentinel" /> : null}
            </>
          ) : (
            <>
              <section className="section-header browse-header vitrin-header">
                <div>
                  <h2>فیلم‌ها</h2>
                </div>
                <button type="button" className="chip" onClick={() => openCategory("movie")}>
                  نمایش همه
                </button>
              </section>

              <RowCards items={movieItems} onOpen={openItem} />

              <section className="section-header browse-header vitrin-header">
                <div>
                  <h2>سریال‌ها</h2>
                </div>
                <button type="button" className="chip" onClick={() => openCategory("tvSeries")}>
                  نمایش همه
                </button>
              </section>

              <RowCards items={seriesItems} onOpen={openItem} />
            </>
          )}
        </>
      ) : null}

      {hasNoResults ? (
        <section className="feedback-panel empty-panel glass-panel">
          <p className="section-kicker">نتیجه‌ای پیدا نشد</p>
          <h2>چیزی مطابق جستجو یا فیلتر فعلی نیست</h2>
          <p>عبارت جستجو یا ترتیب مرتب‌سازی را تغییر دهید.</p>
        </section>
      ) : null}

      <div className={isDrawerOpen ? "drawer-shell open" : "drawer-shell"}>
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="بستن پنل جزئیات"
          onClick={closeDrawer}
        />
        <aside
          ref={drawerRef}
          className="detail-drawer glass-panel"
          aria-hidden={!isDrawerOpen}
          aria-label="جزئیات عنوان"
        >
          {activeItem ? (
            <>
              <div className="drawer-hero" style={{ background: getArtwork(activeItem).background }}>
                <div className="drawer-hero-overlay" />
                <button type="button" className="drawer-close" onClick={closeDrawer}>
                  بستن
                </button>
                <div className="drawer-hero-copy">
                  <span className="section-kicker">{formatType(activeItem.type)}</span>
                  <h2>{activeItem.title}</h2>
                  <div className="drawer-meta-grid">
                    <div className="drawer-meta-item">
                      <span>سال ساخت</span>
                      <strong>{activeItem.year ?? "نامشخص"}</strong>
                    </div>
                    <div className="drawer-meta-item">
                      <span>تعداد رای</span>
                      <strong>{activeItem.imdbVotes.toLocaleString("fa-IR")}</strong>
                    </div>
                    <div className="drawer-meta-item">
                      <span>امتیاز IMDb</span>
                      <strong>{activeItem.imdbRate.toFixed(1)}</strong>
                    </div>
                  </div>
                </div>
              </div>

              <div className="drawer-body">
                <div className="drawer-actions">
                  <button
                    type="button"
                    className="drawer-share-button"
                    onClick={() => void shareTitle(activeItem)}
                  >
                    اشتراک‌گذاری عنوان
                  </button>
                  <a
                    className="imdb-link"
                    href={`https://www.imdb.com/title/${activeItem.imdbCode}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ImdbIcon />
                    مشاهده در IMDb
                  </a>
                </div>
                {shareState ? (
                  <p className={shareState.tone === "success" ? "drawer-status success" : "drawer-status error"}>
                    {shareState.message}
                  </p>
                ) : null}
                {resolvedForActive?.sectionErrors.global ? (
                  <p className="drawer-status error">{resolvedForActive.sectionErrors.global}</p>
                ) : null}

                {activeItem.type === "Movie" ? (
                  <div className="download-stack">
                    {displayedMovieDownloads.map((group) => (
                      <section key={group.label} className="download-panel">
                        <header className="download-heading">
                          <h3>{localizeDynamicLabel(group.label)}</h3>
                          <span>{group.links.length.toLocaleString("fa-IR")} گزینه</span>
                        </header>
                        {resolvedForActive?.sectionErrors[`movie:${group.label}`] ? (
                          <p className="drawer-status error">
                            {resolvedForActive.sectionErrors[`movie:${group.label}`]}
                          </p>
                        ) : null}
                        <DownloadLinksBlock links={group.links} />
                        {resolvedForActive?.pendingSections[`movie:${group.label}`] ? (
                          <DirectorySectionSkeleton />
                        ) : null}
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="download-stack">
                    {displayedSeasonDownloads.map((season) => (
                      <section key={season.seasonNumber} className="download-panel">
                        <header className="download-heading">
                          <h3>فصل {season.seasonNumber.toLocaleString("fa-IR")}</h3>
                          <span>
                            {season.groups
                              .reduce((sum, group) => sum + group.links.length, 0)
                              .toLocaleString("fa-IR")} لینک
                          </span>
                        </header>
                        <div className="season-stack">
                          {season.groups.map((group) => (
                            <div key={group.label} className="season-group">
                              <span className="season-label">{localizeDynamicLabel(group.label)}</span>
                              {resolvedForActive?.sectionErrors[`season:${season.seasonNumber}:${group.label}`] ? (
                                <p className="drawer-status error">
                                  {resolvedForActive.sectionErrors[`season:${season.seasonNumber}:${group.label}`]}
                                </p>
                              ) : null}
                              <DownloadLinksBlock links={group.links} />
                              {resolvedForActive?.pendingSections[`season:${season.seasonNumber}:${group.label}`] ? (
                                <DirectorySectionSkeleton />
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="drawer-empty">
              <p className="section-kicker">پنل جزئیات</p>
              <h2>یک عنوان را انتخاب کنید</h2>
              <p>برای نمایش لینک‌ها و جزئیات IMDb روی یکی از کارت‌ها بزنید.</p>
            </div>
          )}
        </aside>
      </div>

      {!isDrawerOpen && showScrollTopButton ? (
        <button type="button" className="scroll-top-fab" onClick={scrollToTop} aria-label="بازگشت به بالای صفحه">
          ⇧
        </button>
      ) : null}

      <div className={isSortMenuOpen ? "mobile-sort-sheet open" : "mobile-sort-sheet"}>
        <button
          type="button"
          className="mobile-sort-backdrop"
          aria-label="بستن منوی مرتب‌سازی"
          onClick={() => setIsSortMenuOpen(false)}
        />
        <section className="mobile-sort-panel" aria-hidden={!isSortMenuOpen} aria-label="تنظیمات مرتب‌سازی">
          <header className="mobile-sort-header">
            <h3>مرتب‌سازی</h3>
            <button type="button" className="mobile-sort-close" onClick={() => setIsSortMenuOpen(false)}>
              بستن
            </button>
          </header>

          <div className="mobile-sort-group">
            <span className="sort-title">مرتب سازی بر اساس</span>
            <div className="chip-row">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={sort === option.value ? "chip active" : "chip"}
                  onClick={() => {
                    applySort(option.value);
                    setIsSortMenuOpen(false);
                  }}
                >
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                className={dubbedOnly ? "chip active" : "chip"}
                onClick={() => {
                  setDubbedOnly((prev) => !prev);
                  setIsSortMenuOpen(false);
                }}
              >
                فقط دوبله شده
              </button>
            </div>
          </div>

          <div className="mobile-sort-group">
            <span className="sort-title">جهت مرتب‌سازی</span>
            <div className="chip-row">
              <button
                type="button"
                className={order === "desc" ? "chip active" : "chip"}
                onClick={() => {
                  applyOrder("desc");
                  setIsSortMenuOpen(false);
                }}
              >
                نزولی
              </button>
              <button
                type="button"
                className={order === "asc" ? "chip active" : "chip"}
                onClick={() => {
                  applyOrder("asc");
                  setIsSortMenuOpen(false);
                }}
              >
                صعودی
              </button>
            </div>
          </div>

        </section>
      </div>
    </div>
  );
}
