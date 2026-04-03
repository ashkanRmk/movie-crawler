import { Dispatch, FormEvent, RefObject, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  changePassword,
  clearAuthToken,
  fetchCatalog,
  fetchCatalogItem,
  fetchGenres,
  fetchSubscriptionPlans,
  getAuthToken,
  login,
  me,
  register,
  resolveDirectoryLinks,
  setAuthToken
} from "./api";
import type {
  AuthResponse,
  AuthUser,
  CatalogItem,
  DownloadGroup,
  DownloadLink,
  GenreItem,
  SeasonGroup,
  SubscriptionPlan
} from "./types";
import "./styles.css";

const VIDEO_FILE_EXTENSIONS = new Set([
  ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".m2ts", ".webm", ".flv", ".mpeg", ".mpg"
]);
const SEARCH_FOCUS_EVENT = "movie-crawler:focus-search";
const RESOLVE_CHUNK_SIZE = 3;

type ToastState = { tone: "success" | "error"; message: string } | null;
type BrowseType = "movie" | "tvSeries";
type SortOption = "imdb_desc" | "imdb_asc" | "year_desc" | "year_asc";

type FilterState = {
  query: string;
  dubbedOnly: boolean;
  sort: SortOption;
};

function isDirectoryLink(url: string): boolean {
  const safe = url.toLowerCase();
  for (const ext of VIDEO_FILE_EXTENSIONS) {
    if (safe.includes(ext)) {
      return false;
    }
  }

  return true;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia("(max-width: 900px)").matches;
  });

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const listener = () => setIsMobile(media.matches);
    listener();
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  return isMobile;
}

function formatVotes(votes: number): string {
  return votes.toLocaleString("fa-IR");
}

function toPriceLabel(value: number): string {
  return `${value.toLocaleString("fa-IR")} تومان`;
}

function toPersianDigits(value: number): string {
  return value.toLocaleString("fa-IR");
}

function formatRemainingTime(remainingSeconds: number): string {
  if (remainingSeconds <= 0) {
    return "به پایان رسیده";
  }

  const totalHours = Math.floor(remainingSeconds / 3600);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = Math.floor((remainingSeconds % 3600) / 60);

  if (days > 0) {
    return `${toPersianDigits(days)} روز و ${toPersianDigits(hours)} ساعت`;
  }

  if (hours > 0) {
    return `${toPersianDigits(hours)} ساعت و ${toPersianDigits(minutes)} دقیقه`;
  }

  return `${toPersianDigits(minutes)} دقیقه`;
}

function isActiveSubscription(user: AuthUser | null): boolean {
  return Boolean(user && user.hasActiveSubscription);
}

function filterCatalogItems(items: CatalogItem[], query: string): CatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return items;
  }

  return items.filter((item) => {
    const haystack = [
      item.title,
      item.summary,
      item.countryOrigin,
      item.duration,
      item.ageRating,
      ...item.genres,
      ...item.stars
    ].filter(Boolean).join(" ").toLowerCase();

    return haystack.includes(q);
  });
}

function applyFilters(items: CatalogItem[], filter: FilterState): CatalogItem[] {
  let output = filterCatalogItems(items, filter.query);

  if (filter.dubbedOnly) {
    output = output.filter((item) => item.isDubbed);
  }

  output = [...output].sort((a, b) => {
    if (filter.sort === "imdb_desc") return b.imdbRate - a.imdbRate;
    if (filter.sort === "imdb_asc") return a.imdbRate - b.imdbRate;
    if (filter.sort === "year_desc") return (b.year ?? 0) - (a.year ?? 0);
    return (a.year ?? 0) - (b.year ?? 0);
  });

  return output;
}

function extractFileName(url: string): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").filter(Boolean).pop() ?? url;
    return decodeURIComponent(name);
  } catch {
    const name = url.split("/").filter(Boolean).pop() ?? url;
    return decodeURIComponent(name);
  }
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatEpisodePrefix(link: DownloadLink): string | null {
  if (link.seasonNumber && link.episodeNumber) {
    return `S${pad2(link.seasonNumber)}E${pad2(link.episodeNumber)}`;
  }

  return null;
}

function linkDisplayTitle(link: DownloadLink): string {
  const label = (link.label || "").trim();
  const fallbackName = extractFileName(link.url);
  const hasStrongLabel = label.length > 2 && !/^download$/i.test(label) && !/^episode$/i.test(label);
  const episodePrefix = formatEpisodePrefix(link);

  if (episodePrefix && hasStrongLabel) {
    return `${episodePrefix} - ${label}`;
  }

  if (episodePrefix) {
    return `${episodePrefix} - ${fallbackName}`;
  }

  return hasStrongLabel ? label : fallbackName;
}

function resolutionWeight(value: string): number {
  const match = value.match(/(2160|1080|720|480)p/i);
  return match ? Number(match[1]) : 0;
}

function groupSeasonDownloadsByQuality(seasons: SeasonGroup[]): SeasonGroup[] {
  const grouped = new Map<number, Map<string, DownloadLink[]>>();

  for (const season of seasons) {
    for (const section of season.groups) {
      for (const link of section.links) {
        const seasonNumber = link.seasonNumber ?? season.seasonNumber;
        const quality = (link.parentGroupName || section.label || "سایر کیفیت‌ها").trim();

        if (!grouped.has(seasonNumber)) {
          grouped.set(seasonNumber, new Map<string, DownloadLink[]>());
        }

        const qualityMap = grouped.get(seasonNumber)!;
        if (!qualityMap.has(quality)) {
          qualityMap.set(quality, []);
        }

        qualityMap.get(quality)!.push(link);
      }
    }
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([seasonNumber, qualityMap]) => ({
      seasonNumber,
      groups: Array.from(qualityMap.entries())
        .sort((a, b) => resolutionWeight(b[0]) - resolutionWeight(a[0]))
        .map(([label, links]) => ({
          label,
          links: [...links].sort((a, b) => {
            const seasonDiff = (a.seasonNumber ?? seasonNumber) - (b.seasonNumber ?? seasonNumber);
            if (seasonDiff !== 0) return seasonDiff;
            return (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0);
          })
        }))
    }));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }

  return output;
}

function collectDirectoryUrls(item: CatalogItem): string[] {
  const directoryUrls = new Set<string>();

  item.downloads.forEach((group) => group.links.forEach((link) => {
    if (isDirectoryLink(link.url)) directoryUrls.add(link.url);
  }));

  item.seasons.forEach((season) => season.groups.forEach((group) => group.links.forEach((link) => {
    if (isDirectoryLink(link.url)) directoryUrls.add(link.url);
  })));

  return Array.from(directoryUrls);
}

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="m16 16 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconCategory() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="8" height="7" rx="1.5" fill="currentColor" />
      <rect x="13" y="4" width="8" height="7" rx="1.5" fill="currentColor" />
      <rect x="3" y="13" width="8" height="7" rx="1.5" fill="currentColor" />
      <rect x="13" y="13" width="8" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5zm9 3.5-2.1.8a7.3 7.3 0 0 1-.6 1.4l.9 2-1.9 1.9-2-.9a7.3 7.3 0 0 1-1.4.6L12 21h-2l-.8-2.1a7.3 7.3 0 0 1-1.4-.6l-2 .9-1.9-1.9.9-2a7.3 7.3 0 0 1-.6-1.4L3 12v-2l2.1-.8a7.3 7.3 0 0 1 .6-1.4l-.9-2 1.9-1.9 2 .9a7.3 7.3 0 0 1 1.4-.6L10 3h2l.8 2.1a7.3 7.3 0 0 1 1.4.6l2-.9 1.9 1.9-.9 2a7.3 7.3 0 0 1 .6 1.4L21 10z" fill="currentColor" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v-2H5V6h5z" fill="currentColor" />
      <path d="M13 16l1.4 1.4L20.8 11 14.4 4.6 13 6l4 4h-8v2h8z" fill="currentColor" />
    </svg>
  );
}

function IconUp() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 5 7 7-1.5 1.5L13 9v10h-2V9l-4.5 4.5L5 12z" fill="currentColor" />
    </svg>
  );
}

function VideoCard({ item }: { item: CatalogItem }) {
  return (
    <Link to={`/${item.imdbCode}`} className="video-card">
      <div className="video-art-wrap">
        {item.posterUrl ? <img src={item.posterUrl} alt={item.title} className="video-art" /> : <div className="video-art gradient" />}

        <div className="cover-badges">
          <span className="badge rating">IMDb {item.imdbRate.toFixed(1)}</span>
          <span className={item.isDubbed ? "badge dubbed" : "badge subtitled"}>{item.isDubbed ? "دوبله" : "زیرنویس"}</span>
          <span className="badge type">{item.type === "Movie" ? "فیلم" : "سریال"}</span>
        </div>
      </div>

      <div className="video-content">
        <h3 title={item.title}>{item.title}</h3>
        <p>{item.year ?? "-"}</p>
      </div>
    </Link>
  );
}

function DesktopProfileMenu({ loggedIn, onLogout }: { loggedIn: boolean; onLogout: () => void }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div ref={containerRef} className="desktop-profile-menu-wrap">
      <button
        type="button"
        className="profile-icon-btn"
        aria-label="پروفایل کاربری"
        onClick={() => setOpen((prev) => !prev)}
      >
        <IconProfile />
        <span className="profile-label">پروفایل</span>
        <span className="profile-tooltip">پروفایل کاربری</span>
      </button>

      {open ? (
        <div className="profile-dropdown">
          <button type="button" className="profile-item" onClick={() => { setOpen(false); navigate(loggedIn ? "/profile" : "/login"); }}>
            <IconSettings />
            <span>تنظیمات حساب کاربری</span>
          </button>
          <button type="button" className="profile-item" onClick={() => { setOpen(false); navigate("/categories"); }}>
            <IconCategory />
            <span>دسته بندی ها</span>
          </button>
          {loggedIn ? (
            <button type="button" className="profile-item danger" onClick={() => { setOpen(false); onLogout(); }}>
              <IconLogout />
              <span>خروج</span>
            </button>
          ) : (
            <button type="button" className="profile-item" onClick={() => { setOpen(false); navigate("/login"); }}>
              <IconProfile />
              <span>ورود</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MobileSearchHeader() {
  return (
    <section className="panel mobile-search-header">
      <h1>جستجو</h1>
      <p>عنوان فیلم یا سریال را جستجو کنید</p>
    </section>
  );
}

function SearchPage({ items, isMobile }: { items: CatalogItem[]; isMobile: boolean }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterCatalogItems(items, query).slice(0, 80), [items, query]);

  return (
    <main className="page">
      {isMobile ? <MobileSearchHeader /> : null}
      <section className={isMobile ? "panel sticky-controls mobile-search-input-panel" : "panel sticky-controls"}>
        {!isMobile ? <h1>جستجو</h1> : null}
        <input
          type="search"
          className="search-input"
          placeholder="جستجو در عنوان، ژانر، خلاصه..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
      </section>
      <section className="card-grid">
        {visible.map((item) => <VideoCard key={item.imdbCode} item={item} />)}
      </section>
    </main>
  );
}

function CatalogControls({
  filter,
  setFilter,
  inputRef,
  title,
  sticky
}: {
  filter: FilterState;
  setFilter: Dispatch<SetStateAction<FilterState>>;
  inputRef: RefObject<HTMLInputElement | null>;
  title: string;
  sticky?: boolean;
}) {
  useEffect(() => {
    const handler = () => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    window.addEventListener(SEARCH_FOCUS_EVENT, handler);
    return () => window.removeEventListener(SEARCH_FOCUS_EVENT, handler);
  }, [inputRef]);

  return (
    <section className={sticky ? "panel controls-panel sticky-controls" : "panel controls-panel"}>
      <h1>{title}</h1>
      <div className="controls-grid">
        <input
          ref={inputRef}
          type="search"
          value={filter.query}
          onChange={(event) => setFilter((prev) => ({ ...prev, query: event.target.value }))}
          placeholder="جستجو در عنوان، ژانر، بازیگر..."
          className="search-input"
        />

        <select
          className="select-input"
          value={filter.sort}
          onChange={(event) => setFilter((prev) => ({ ...prev, sort: event.target.value as SortOption }))}
        >
          <option value="imdb_desc">IMDb (بیشترین)</option>
          <option value="imdb_asc">IMDb (کمترین)</option>
          <option value="year_desc">سال (جدید به قدیم)</option>
          <option value="year_asc">سال (قدیم به جدید)</option>
        </select>

        <label className="toggle-chip">
          <input
            type="checkbox"
            checked={filter.dubbedOnly}
            onChange={(event) => setFilter((prev) => ({ ...prev, dubbedOnly: event.target.checked }))}
          />
          فقط دوبله
        </label>
      </div>
    </section>
  );
}

function DesktopHome({ items }: { items: CatalogItem[] }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [filter, setFilter] = useState<FilterState>({ query: "", dubbedOnly: false, sort: "imdb_desc" });

  const filtered = useMemo(() => applyFilters(items, filter), [items, filter]);
  const movieItems = filtered.filter((item) => item.type === "Movie").slice(0, 20);
  const tvItems = filtered.filter((item) => item.type === "TvSeries").slice(0, 20);

  return (
    <main className="page desktop-home">
      <CatalogControls filter={filter} setFilter={setFilter} inputRef={inputRef} title="آرشیو فیلم و سریال" sticky />

      <section className="shelf-section">
        <header>
          <h2>فیلم‌ها</h2>
          <Link to="/browse/movie" className="chip">نمایش همه</Link>
        </header>
        <div className="horizontal-row">
          {movieItems.map((item) => <VideoCard key={item.imdbCode} item={item} />)}
        </div>
      </section>

      <section className="shelf-section">
        <header>
          <h2>سریال‌ها</h2>
          <Link to="/browse/tvSeries" className="chip">نمایش همه</Link>
        </header>
        <div className="horizontal-row">
          {tvItems.map((item) => <VideoCard key={item.imdbCode} item={item} />)}
        </div>
      </section>
    </main>
  );
}

function MobileHome({ items }: { items: CatalogItem[] }) {
  const movieItems = useMemo(() => items.filter((item) => item.type === "Movie").slice(0, 12), [items]);
  const tvItems = useMemo(() => items.filter((item) => item.type === "TvSeries").slice(0, 12), [items]);

  return (
    <main className="page mobile-home">
      <section className="panel mobile-hero-panel">
        <h1>سکانس</h1>
        <p>خانه</p>
      </section>

      <section className="shelf-section">
        <header>
          <h2>فیلم‌ها</h2>
          <Link to="/browse/movie" className="chip">نمایش همه</Link>
        </header>
        <div className="horizontal-row">
          {movieItems.map((item) => <VideoCard key={item.imdbCode} item={item} />)}
        </div>
      </section>

      <section className="shelf-section">
        <header>
          <h2>سریال‌ها</h2>
          <Link to="/browse/tvSeries" className="chip">نمایش همه</Link>
        </header>
        <div className="horizontal-row">
          {tvItems.map((item) => <VideoCard key={item.imdbCode} item={item} />)}
        </div>
      </section>
    </main>
  );
}


function BrowsePage({ items }: { items: CatalogItem[] }) {
  const params = useParams<{ kind: BrowseType }>();
  const kind = params.kind === "tvSeries" ? "tvSeries" : "movie";

  const [filter, setFilter] = useState<FilterState>({ query: "", dubbedOnly: false, sort: "imdb_desc" });
  const inputRef = useRef<HTMLInputElement | null>(null);

  const source = useMemo(
    () => items.filter((item) => kind === "movie" ? item.type === "Movie" : item.type === "TvSeries"),
    [items, kind]
  );

  const filtered = useMemo(() => applyFilters(source, filter), [source, filter]);

  const [renderedCount, setRenderedCount] = useState(20);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRenderedCount(20);
  }, [kind, filter]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || renderedCount >= filtered.length) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setRenderedCount((prev) => Math.min(prev + 20, filtered.length));
        }
      });
    }, { rootMargin: "260px" });

    observer.observe(node);
    return () => observer.disconnect();
  }, [renderedCount, filtered.length]);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 440);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className="page page-browse">
      <CatalogControls
        filter={filter}
        setFilter={setFilter}
        inputRef={inputRef}
        title={kind === "movie" ? "همه فیلم‌ها" : "همه سریال‌ها"}
        sticky
      />

      <section className="browse-utility-actions">
        <Link to="/" className="ghost-btn">رفتن به خانه</Link>
      </section>

      <section className="card-grid">
        {filtered.slice(0, renderedCount).map((item) => <VideoCard key={item.imdbCode} item={item} />)}
      </section>

      {renderedCount < filtered.length ? <div ref={sentinelRef} className="infinite-sentinel" /> : null}

      {showBackToTop ? (
        <button
          type="button"
          className="floating-top-btn"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <IconUp />
          <span>بالا</span>
        </button>
      ) : null}
    </main>
  );
}

function applyResolvedToMovie(groups: DownloadGroup[], resolvedByUrl: Map<string, DownloadLink[]>): DownloadGroup[] {
  return groups.map((group) => ({
    ...group,
    links: group.links.flatMap((link) => {
      if (!isDirectoryLink(link.url)) {
        return [link];
      }

      const resolved = resolvedByUrl.get(normalizeUrl(link.url));
      return resolved && resolved.length > 0 ? resolved : [];
    })
  }));
}

function applyResolvedToSeasons(seasons: SeasonGroup[], resolvedByUrl: Map<string, DownloadLink[]>): SeasonGroup[] {
  return seasons.map((season) => ({
    ...season,
    groups: season.groups.map((group) => ({
      ...group,
      links: group.links.flatMap((link) => {
        if (!isDirectoryLink(link.url)) {
          return [link];
        }

        const resolved = resolvedByUrl.get(normalizeUrl(link.url));
        return resolved && resolved.length > 0 ? resolved : [];
      })
    }))
  }));
}

function DetailPage({
  catalogItems,
  user,
  showToast
}: {
  catalogItems: CatalogItem[];
  user: AuthUser | null;
  showToast: (toast: Exclude<ToastState, null>) => void;
}) {
  const { imdbCode = "" } = useParams();
  const canDownload = isActiveSubscription(user);

  const [item, setItem] = useState<CatalogItem | null>(() => catalogItems.find((entry) => entry.imdbCode === imdbCode) ?? null);
  const [loading, setLoading] = useState(!item);
  const [error, setError] = useState<string | null>(null);
  const [movieDownloads, setMovieDownloads] = useState<DownloadGroup[]>([]);
  const [seasonDownloads, setSeasonDownloads] = useState<SeasonGroup[]>([]);
  const [isResolvingLinks, setIsResolvingLinks] = useState(false);
  const [failedDirectoryUrls, setFailedDirectoryUrls] = useState<string[]>([]);

  useEffect(() => {
    const fromCache = catalogItems.find((entry) => entry.imdbCode === imdbCode) ?? null;
    setItem(fromCache);
    setMovieDownloads(fromCache?.downloads ?? []);
    setSeasonDownloads(fromCache?.seasons ?? []);
    setFailedDirectoryUrls([]);

    if (fromCache) {
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void fetchCatalogItem(imdbCode)
      .then((result) => {
        if (cancelled) return;
        setItem(result);
        setMovieDownloads(result.downloads);
        setSeasonDownloads(result.seasons);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "خطا در دریافت اطلاعات");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [catalogItems, imdbCode]);

  const similarItems = useMemo(() => {
    if (!item) return [];

    const baseGenres = new Set(item.genres.map((genre) => genre.toLowerCase()));
    return catalogItems
      .filter((candidate) => candidate.imdbCode !== item.imdbCode && candidate.type === item.type)
      .map((candidate) => {
        const overlap = candidate.genres.reduce((score, genre) => score + (baseGenres.has(genre.toLowerCase()) ? 1 : 0), 0);
        return { candidate, score: overlap * 10 + candidate.imdbRate };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((entry) => entry.candidate);
  }, [catalogItems, item]);

  useEffect(() => {
    if (!item || !canDownload) {
      return;
    }

    const directoryUrls = collectDirectoryUrls(item);
    if (directoryUrls.length === 0) {
      setMovieDownloads(item.downloads);
      setSeasonDownloads(item.seasons);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const runResolve = async (targetUrls: string[]) => {
      setIsResolvingLinks(true);

      const map = new Map<string, DownloadLink[]>();
      const failed = new Set<string>();
      const chunks = chunkArray(targetUrls, RESOLVE_CHUNK_SIZE);

      for (const chunk of chunks) {
        if (cancelled) return;

        try {
          const response = await resolveDirectoryLinks(chunk, item.type, controller.signal);

          response.results.forEach((entry) => {
            if (entry.error) {
              failed.add(entry.url);
              return;
            }

            map.set(normalizeUrl(entry.url), entry.links);
          });

          if (!cancelled) {
            setMovieDownloads(applyResolvedToMovie(item.downloads, map));
            setSeasonDownloads(applyResolvedToSeasons(item.seasons, map));
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return;
          }

          chunk.forEach((value) => failed.add(value));
          showToast({ tone: "error", message: err instanceof Error ? err.message : "خطا در استخراج لینک‌ها" });
        }
      }

      if (!cancelled) {
        setFailedDirectoryUrls(Array.from(failed));
        setIsResolvingLinks(false);
      }
    };

    void runResolve(directoryUrls).finally(() => {
      if (!cancelled) setIsResolvingLinks(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [item, canDownload, showToast]);

  const retryFailed = async () => {
    if (!item || failedDirectoryUrls.length === 0) {
      return;
    }

    setIsResolvingLinks(true);
    const controller = new AbortController();
    const map = new Map<string, DownloadLink[]>();
    const failed = new Set<string>();

    const chunks = chunkArray(collectDirectoryUrls(item), RESOLVE_CHUNK_SIZE);
    for (const chunk of chunks) {
      try {
        const response = await resolveDirectoryLinks(chunk, item.type, controller.signal);

        response.results.forEach((entry) => {
          if (entry.error) {
            failed.add(entry.url);
            return;
          }

          map.set(normalizeUrl(entry.url), entry.links);
        });
      } catch (err) {
        chunk.forEach((value) => failed.add(value));
        showToast({ tone: "error", message: err instanceof Error ? err.message : "خطا در بازیابی لینک‌ها" });
      }
    }

    setMovieDownloads(applyResolvedToMovie(item.downloads, map));
    setSeasonDownloads(applyResolvedToSeasons(item.seasons, map));
    setFailedDirectoryUrls(Array.from(failed));
    setIsResolvingLinks(false);
  };

  if (loading) return <main className="page"><p className="feedback">در حال بارگذاری...</p></main>;
  if (error || !item) return <main className="page"><p className="feedback error">{error ?? "عنوان یافت نشد"}</p></main>;

  const groupedSeasons = groupSeasonDownloadsByQuality(seasonDownloads);

  return (
    <main className="page page-detail">
      <section className="detail-hero">
        <div className="detail-cover-wrap">
          {item.coverUrl || item.posterUrl
            ? <img src={item.coverUrl ?? item.posterUrl ?? ""} alt={item.title} className="detail-hero-art" />
            : <div className="detail-hero-art gradient" />}
        </div>

        <div className="detail-hero-copy">
          <h1>{item.title}</h1>
          <p>{item.type === "Movie" ? "فیلم" : "سریال"} • IMDb {item.imdbRate.toFixed(1)} • {formatVotes(item.imdbVotes)} رای</p>
          <p className="summary-text">{item.summary || "خلاصه داستان هنوز ثبت نشده است."}</p>
          <div className="meta-grid">
            <div><span>مدت</span><strong>{item.duration || "-"}</strong></div>
            <div><span>کشور</span><strong>{item.countryOrigin || "-"}</strong></div>
            <div><span>رده سنی</span><strong>{item.ageRating || "-"}</strong></div>
            <div><span>سال</span><strong>{item.year ?? "-"}</strong></div>
            <div><span>ژانر</span><strong>{item.genres.length > 0 ? item.genres.join("، ") : "-"}</strong></div>
            <div><span>بازیگران</span><strong>{item.stars.length > 0 ? item.stars.join("، ") : "-"}</strong></div>
          </div>
        </div>
      </section>

      <section className="detail-downloads">
        <div className="detail-download-header">
          <h2>بخش دانلود</h2>
          {isResolvingLinks ? <span className="loading-chip">در حال آماده‌سازی لینک‌ها...</span> : null}
        </div>

        {!canDownload ? (
          <div className="locked-box">
            <p>برای مشاهده لینک دانلود باید اشتراک فعال داشته باشید.</p>
            <Link to={user ? "/profile" : "/login"} className="primary-btn">
              {user ? "مدیریت اشتراک" : "ورود"}
            </Link>
          </div>
        ) : item.type === "Movie" ? (
          <div className="download-stack">
            {movieDownloads.map((group) => (
              <article key={group.label} className="download-panel">
                <h3>{group.label}</h3>
                <div className="download-links">
                  {group.links.map((link) => (
                    <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="download-link">
                      <span>{linkDisplayTitle(link)}</span>
                      <strong>{link.size || "Open"}</strong>
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : isResolvingLinks ? (
          <div className="download-stack">
            <article className="download-panel">
              <h3>در حال استخراج لینک‌های سریال...</h3>
              <p className="feedback">لطفا چند لحظه صبر کنید.</p>
            </article>
          </div>
        ) : (
          <div className="download-stack">
            {groupedSeasons.map((season) => (
              <article key={season.seasonNumber} className="download-panel">
                <h3>فصل {season.seasonNumber.toLocaleString("fa-IR")}</h3>
                {season.groups.map((group) => (
                  <div key={group.label} className="season-group">
                    <h4>{group.label}</h4>
                    <div className="download-links">
                      {group.links.map((link) => (
                        <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="download-link">
                          <span>{linkDisplayTitle(link)}</span>
                          <strong>{link.size || "Open"}</strong>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}

        {canDownload && failedDirectoryUrls.length > 0 ? (
          <div className="resolve-error-box">
            <p>{failedDirectoryUrls.length.toLocaleString("fa-IR")} پوشه هنوز لود نشده است.</p>
            <button type="button" className="ghost-btn" onClick={retryFailed} disabled={isResolvingLinks}>تلاش مجدد</button>
          </div>
        ) : null}
      </section>

      {similarItems.length > 0 ? (
        <section className="shelf-section">
          <header>
            <h2>عناوین مشابه</h2>
          </header>
          <div className="horizontal-row">
            {similarItems.map((similar) => <VideoCard key={similar.imdbCode} item={similar} />)}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function CategoriesPage() {
  const [tab, setTab] = useState<BrowseType>("movie");
  const [genres, setGenres] = useState<GenreItem[]>([]);

  useEffect(() => {
    void fetchGenres().then(setGenres).catch(() => setGenres([]));
  }, []);

  const visible = genres.filter((genre) => tab === "movie" ? genre.titleType === "Movie" : genre.titleType === "TvSeries");

  return (
    <main className="page">
      <section className="panel">
        <h1>دسته بندی ها</h1>
        <div className="chip-row">
          <button type="button" className={tab === "movie" ? "chip active" : "chip"} onClick={() => setTab("movie")}>فیلم</button>
          <button type="button" className={tab === "tvSeries" ? "chip active" : "chip"} onClick={() => setTab("tvSeries")}>سریال</button>
        </div>
        <div className="genre-grid">
          {visible.map((genre) => (
            <div key={genre.id} className="genre-pill">
              <span>{genre.label}</span>
              <strong>{genre.count.toLocaleString("fa-IR")}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function LoginPage({ onAuth }: { onAuth: (response: AuthResponse) => void }) {
  const navigate = useNavigate();
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const response = await login(mobile, password);
      onAuth(response);
      navigate("/profile", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "ورود ناموفق بود");
    }
  };

  return (
    <main className="page auth-page">
      <form className="panel auth-form" onSubmit={onSubmit}>
        <h1>ورود</h1>
        <label>موبایل<input type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} required /></label>
        <label>رمز عبور<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error ? <p className="feedback error">{error}</p> : null}
        <button type="submit" className="primary-btn">ورود</button>
        <p>حساب ندارید؟ <Link to="/register">ثبت نام</Link></p>
      </form>
    </main>
  );
}

function RegisterPage({ onAuth }: { onAuth: (response: AuthResponse) => void }) {
  const navigate = useNavigate();
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const response = await register(mobile, password);
      onAuth(response);
      navigate("/profile", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت نام ناموفق بود");
    }
  };

  return (
    <main className="page auth-page">
      <form className="panel auth-form" onSubmit={onSubmit}>
        <h1>ثبت نام</h1>
        <label>موبایل<input type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} required /></label>
        <label>رمز عبور<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error ? <p className="feedback error">{error}</p> : null}
        <button type="submit" className="primary-btn">ثبت نام</button>
      </form>
    </main>
  );
}

function ProfilePage({
  user,
  onLogout,
  showToast
}: {
  user: AuthUser | null;
  onLogout: () => void;
  showToast: (toast: Exclude<ToastState, null>) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    void fetchSubscriptionPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    setRemainingSeconds(user?.remainingSeconds ?? 0);
  }, [user?.remainingSeconds]);

  useEffect(() => {
    if (!user?.hasActiveSubscription) {
      return;
    }

    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 30));
    }, 30000);

    return () => window.clearInterval(timer);
  }, [user?.hasActiveSubscription]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();

    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      showToast({ tone: "success", message: "رمز عبور تغییر کرد" });
    } catch (err) {
      showToast({ tone: "error", message: err instanceof Error ? err.message : "خطا" });
    }
  };

  return (
    <main className="page">
      <section className="panel profile-panel">
        <h1>پروفایل</h1>
        <p>سلام {user.mobile}</p>
        <p>وضعیت اشتراک: {user.hasActiveSubscription ? (user.subscription === 1 ? "یک ماهه فعال" : "سه ماهه فعال") : "غیرفعال"}</p>
        <p>زمان باقی‌مانده: {user.hasActiveSubscription ? formatRemainingTime(remainingSeconds) : "ندارد"}</p>
        <button type="button" className="ghost-btn" onClick={onLogout}>خروج</button>

        <details className="password-accordion">
          <summary>تغییر رمز عبور</summary>
          <form className="auth-form" onSubmit={onSubmit}>
            <label>رمز فعلی<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label>
            <label>رمز جدید<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></label>
            <button type="submit" className="primary-btn">ثبت</button>
          </form>
        </details>

        {!user.hasActiveSubscription ? (
          <div className="plan-grid">
            {plans.map((plan) => (
              <article key={plan.code} className="plan-card">
                <h3>{plan.title}</h3>
                <p>{plan.durationMonths} ماه</p>
                <strong>{toPriceLabel(plan.priceToman)}</strong>
                <a href={plan.paymentUrl} target="_blank" rel="noreferrer" className="primary-btn">خرید</a>
              </article>
            ))}
          </div>
        ) : (
          <div className="active-plan-note">
            <p>اشتراک شما فعال است و نیازی به خرید مجدد ندارید.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function MobileBottomNav({ loggedIn }: { loggedIn: boolean }) {
  return (
    <nav className="mobile-bottom-nav" aria-label="ناوبری موبایل">
      <NavLink to="/" end className={({ isActive }) => isActive ? "nav-btn active" : "nav-btn"}>
        <IconHome />
        <span>خانه</span>
      </NavLink>
      <NavLink to="/search" className={({ isActive }) => isActive ? "nav-btn active" : "nav-btn"}>
        <IconSearch />
        <span>جستجو</span>
      </NavLink>
      <NavLink to="/categories" className={({ isActive }) => isActive ? "nav-btn active" : "nav-btn"}>
        <IconCategory />
        <span>دسته‌بندی</span>
      </NavLink>
      <NavLink to={loggedIn ? "/profile" : "/login"} className={({ isActive }) => isActive ? "nav-btn active" : "nav-btn"}>
        <IconProfile />
        <span>پروفایل</span>
      </NavLink>
    </nav>
  );
}

export default function App() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    void fetchCatalog()
      .then((response) => {
        setCatalogItems(response.items);
        setCatalogError(null);
      })
      .catch((err) => {
        setCatalogError(err instanceof Error ? err.message : "خطا در دریافت فهرست");
      })
      .finally(() => setLoadingCatalog(false));
  }, []);

  const reloadMe = async () => {
    if (!getAuthToken()) {
      return;
    }

    try {
      const profile = await me();
      setUser(profile);
    } catch {
      clearAuthToken();
      setUser(null);
    }
  };

  useEffect(() => {
    void reloadMe();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const handleAuth = (response: AuthResponse) => {
    setAuthToken(response.token);
    setUser(response.user);
  };

  const handleLogout = () => {
    clearAuthToken();
    setUser(null);
    navigate("/");
  };

  const homeNode = loadingCatalog
    ? <main className="page"><p className="feedback">در حال دریافت اطلاعات...</p></main>
    : catalogError
      ? <main className="page"><p className="feedback error">{catalogError}</p></main>
      : isMobile
        ? <MobileHome items={catalogItems} />
        : <DesktopHome items={catalogItems} />;

  return (
    <div className={isMobile ? "app-shell mobile" : "app-shell desktop"}>
      {!isMobile ? <DesktopProfileMenu loggedIn={Boolean(user)} onLogout={handleLogout} /> : null}

      <Routes>
        <Route path="/" element={homeNode} />
        <Route path="/search" element={<SearchPage items={catalogItems} isMobile={isMobile} />} />
        <Route path="/browse/:kind" element={<BrowsePage items={catalogItems} />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/login" element={<LoginPage onAuth={handleAuth} />} />
        <Route path="/register" element={<RegisterPage onAuth={handleAuth} />} />
        <Route path="/profile" element={<ProfilePage user={user} onLogout={handleLogout} showToast={setToast} />} />
        <Route path="/:imdbCode" element={<DetailPage catalogItems={catalogItems} user={user} showToast={setToast} />} />
      </Routes>

      {isMobile ? <MobileBottomNav loggedIn={Boolean(user)} /> : null}
      {toast ? <div className={toast.tone === "error" ? "toast error" : "toast"}>{toast.message}</div> : null}
    </div>
  );
}
