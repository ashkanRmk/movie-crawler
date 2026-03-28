import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { fetchCatalog, reloadCatalog, trackEvent } from "./api";
import type { CatalogItem, CatalogResponse, TitleType } from "./types";
import "./styles.css";

const TYPE_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Movies", value: "movie" },
  { label: "TV Series", value: "tvSeries" }
] as const;

const SORT_OPTIONS = [
  { label: "IMDb", value: "rate" },
  { label: "Votes", value: "votes" },
  { label: "Year", value: "date" }
] as const;

const ART_STYLES = [
  ["#74f2ce", "#2d79f3", "#091327"],
  ["#ffd36f", "#fd5e89", "#2d1223"],
  ["#f9a66c", "#ffda79", "#231532"],
  ["#8ff7d4", "#50a7ff", "#071b2f"],
  ["#e7b2ff", "#6373ff", "#180f2d"],
  ["#ff9270", "#fdcd5a", "#28140d"]
];

type FilterType = (typeof TYPE_OPTIONS)[number]["value"];
type SortKey = (typeof SORT_OPTIONS)[number]["value"];
type SyncState = "idle" | "loading" | "reloading" | "error";
type ShareState =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }
  | null;

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
  return type === "Movie" ? "Movie" : "TV Series";
}

function formatCompactVotes(votes: number): string {
  if (votes >= 1_000_000) {
    return `${(votes / 1_000_000).toFixed(1)}M votes`;
  }

  if (votes >= 1_000) {
    return `${(votes / 1_000).toFixed(0)}K votes`;
  }

  return `${votes} votes`;
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

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M4 7h16M4 12h16M4 17h16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
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

export default function App() {
  const readRequestedTitle = () => {
    if (typeof window === "undefined") {
      return null;
    }

    return new URL(window.location.href).searchParams.get("title");
  };

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [meta, setMeta] = useState<CatalogResponse["meta"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortKey>("rate");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [batchSize, setBatchSize] = useState(18);
  const [renderedCount, setRenderedCount] = useState(18);
  const [pendingSharedTitle, setPendingSharedTitle] = useState<string | null>(() => readRequestedTitle());
  const [shareState, setShareState] = useState<ShareState>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const trackedSharedOpensRef = useRef<Set<string>>(new Set());
  const mobileFilterRef = useRef<HTMLElement | null>(null);

  const loadCatalog = async (mode: "initial" | "reload") => {
    setError(null);
    setSyncState(mode === "initial" ? "loading" : "reloading");

    try {
      if (mode === "reload") {
        await reloadCatalog();
      }

      const response = await fetchCatalog({});
      setItems(response.items);
      setMeta(response.meta);
      setSyncState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Catalog load failed");
      setSyncState("error");
    }
  };

  useEffect(() => {
    void loadCatalog("initial");
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setPendingSharedTitle(readRequestedTitle());
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const filteredItems = useMemo(() => {
    let next = [...items];
    const trimmed = deferredQuery.trim().toLowerCase();

    if (trimmed) {
      next = next.filter((item) => item.title.toLowerCase().includes(trimmed));
    }

    if (typeFilter !== "all") {
      next = next.filter((item) => {
        if (typeFilter === "movie") {
          return item.type === "Movie";
        }

        return item.type === "TvSeries";
      });
    }

    return sortItems(next, sort, order);
  }, [deferredQuery, items, order, sort, typeFilter]);

  const featuredItems = useMemo(() => filteredItems.slice(0, 3), [filteredItems]);
  const browseItems = useMemo(() => filteredItems.slice(3), [filteredItems]);
  const renderedItems = useMemo(
    () => browseItems.slice(0, renderedCount),
    [browseItems, renderedCount]
  );
  const activeItem = useMemo(
    () => items.find((item) => item.id === activeId) ?? null,
    [activeId, items]
  );
  const navigableItems = useMemo(
    () => [...featuredItems, ...renderedItems],
    [featuredItems, renderedItems]
  );

  useEffect(() => {
    setRenderedCount((prev) => {
      const desired = Math.max(batchSize, prev);
      return Math.min(desired, browseItems.length || batchSize);
    });
  }, [batchSize, browseItems.length]);

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
    if (!isMobileFilterOpen) {
      return;
    }

    const focusTarget = mobileFilterRef.current?.querySelector<HTMLElement>(
      "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );
    focusTarget?.focus();
  }, [isMobileFilterOpen]);

  useEffect(() => {
    setShareState(null);
  }, [activeId]);

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

    if (!trackedSharedOpensRef.current.has(pendingSharedTitle)) {
      trackedSharedOpensRef.current.add(pendingSharedTitle);
      void trackEvent("share_opened", {
        itemId: matchedItem.id,
        imdbCode: matchedItem.imdbCode,
        method: "deep_link"
      }).catch(() => undefined);
    }
  }, [items, pendingSharedTitle]);

  useEffect(() => {
    if (!isDrawerOpen && !isMobileFilterOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (isDrawerOpen) {
          closeDrawer();
          return;
        }

        closeMobileFilters();
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
  }, [activeId, isDrawerOpen, isMobileFilterOpen, navigableItems]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || renderedCount >= browseItems.length) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setRenderedCount((prev) => Math.min(prev + batchSize, browseItems.length));
          }
        });
      },
      { rootMargin: "320px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [batchSize, browseItems.length, renderedCount]);

  const openItem = (itemId: string) => {
    setIsMobileFilterOpen(false);
    setActiveId(itemId);
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setActiveId(null);
    setIsDrawerOpen(false);
    setPendingSharedTitle(null);
  };

  const closeMobileFilters = () => {
    setIsMobileFilterOpen(false);
  };

  const toggleMobileFilters = () => {
    setIsMobileFilterOpen((prev) => !prev);
  };

  const applyTypeFilter = (value: FilterType) => {
    setTypeFilter(value);
    closeMobileFilters();
  };

  const applySort = (value: SortKey) => {
    setSort(value);
    closeMobileFilters();
  };

  const toggleOrder = () => {
    setOrder((current) => (current === "desc" ? "asc" : "desc"));
    closeMobileFilters();
  };

  const applyBatchSize = (size: number) => {
    setBatchSize(size);
    closeMobileFilters();
  };

  const reloadFromFilters = () => {
    closeMobileFilters();
    void loadCatalog("reload");
  };

  const shareTitle = async (item: CatalogItem) => {
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set("title", item.imdbCode);

    const method = typeof navigator !== "undefined" && typeof navigator.share === "function"
      ? "web_share"
      : "copy_link";

    void trackEvent("share_clicked", {
      itemId: item.id,
      imdbCode: item.imdbCode,
      method
    }).catch(() => undefined);

    try {
      if (method === "web_share") {
        await navigator.share({
          title: item.title,
          text: `Open ${item.title} in the archive.`,
          url: shareUrl.toString()
        });
        setShareState({ tone: "success", message: "Shared" });
        return;
      }

      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard sharing is not available in this browser.");
      }

      await navigator.clipboard.writeText(shareUrl.toString());
      setShareState({ tone: "success", message: "Link copied" });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      setShareState({
        tone: "error",
        message: err instanceof Error ? err.message : "Share failed"
      });
    }
  };

  const hasNoResults = syncState !== "loading" && filteredItems.length === 0 && !error;
  const lastSyncLabel = meta ? new Date(meta.fetchedAt).toLocaleString() : "Not synced yet";
  const appClassName = isDrawerOpen || isMobileFilterOpen ? "app drawer-active" : "app";

  const searchControl = (
    <label className="hero-search">
      <span className="sr-only">Search titles</span>
      <input
        type="search"
        placeholder="Search title, series, franchise..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </label>
  );

  const filterControls = (
    <>
      <div className="filter-block">
        <span className="filter-label">Type</span>
        <div className="chip-row">
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={typeFilter === option.value ? "chip active" : "chip"}
              onClick={() => applyTypeFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-block">
        <span className="filter-label">Sort</span>
        <div className="chip-row">
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
        </div>
      </div>

      <div className="filter-block compact">
        <span className="filter-label">Direction</span>
        <button type="button" className="chip" onClick={toggleOrder}>
          {order === "desc" ? "High to Low" : "Low to High"}
        </button>
      </div>

      <div className="filter-block compact">
        <span className="filter-label">Flow</span>
        <div className="chip-row">
          {[18, 30, 48].map((size) => (
            <button
              key={size}
              type="button"
              className={batchSize === size ? "chip active" : "chip"}
              onClick={() => applyBatchSize(size)}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-block compact">
        <span className="filter-label">Sync</span>
        <button
          type="button"
          className="chip chip-accent"
          onClick={reloadFromFilters}
          disabled={syncState === "loading" || syncState === "reloading"}
        >
          {syncState === "reloading" ? "Refreshing..." : "Reload source"}
        </button>
      </div>
    </>
  );

  return (
    <div className={appClassName}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="mobile-search-bar glass-panel">
        {searchControl}
      </section>

      <section className="hero glass-panel">
        <div className="hero-copy">
          <p className="section-kicker">Premium archive</p>
          <h1>Offline archive.</h1>
          <p className="hero-text">
            Explore standout titles, refine the catalog instantly, and open download options in a
            dedicated side panel without losing your place.
          </p>
          <div className="hero-search-desktop">{searchControl}</div>
          <button
            type="button"
            className="mobile-filter-trigger"
            onClick={toggleMobileFilters}
            aria-expanded={isMobileFilterOpen}
            aria-controls="mobile-filter-drawer"
          >
            <MenuIcon />
            Filters & sort
          </button>
        </div>

        <div className="hero-side">
          <div className="hero-stat">
            <span className="hero-stat-label">Catalog</span>
            <strong>{meta?.itemCount ?? items.length}</strong>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-label">Last sync</span>
            <strong>{lastSyncLabel}</strong>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-label">Status</span>
            <strong>{syncState === "reloading" ? "Refreshing" : "Ready"}</strong>
          </div>
        </div>
      </section>

      <section className="filter-rail glass-panel">
        {filterControls}
      </section>

      {error ? (
        <section className="feedback-panel error-panel glass-panel">
          <p className="section-kicker">Source issue</p>
          <h2>Catalog sync failed.</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {syncState === "loading" ? (
        <>
          <section className="featured-strip">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="featured-card skeleton-card">
                <div className="card-art skeleton-block tall" />
              </div>
            ))}
          </section>
          <SkeletonCards />
        </>
      ) : null}

      {syncState !== "loading" && !hasNoResults ? (
        <>
          <section className="section-header">
            <div>
              <p className="section-kicker">Featured picks</p>
              <h2>Featured titles</h2>
            </div>
            <p className="section-note">
              {filteredItems.length} matching titles • {Math.min(renderedCount, browseItems.length)} in
              browse view
            </p>
          </section>

          <section className="featured-strip">
            {featuredItems.map((item, index) => {
              const artwork = getArtwork(item);

              return (
                <button
                  key={item.id}
                  type="button"
                  className={index === 0 ? "featured-card featured-card-large" : "featured-card"}
                  style={{ background: artwork.background }}
                  onClick={() => openItem(item.id)}
                >
                  <div className="featured-overlay" />
                  <div className="featured-topline">
                    <span>{formatType(item.type)}</span>
                    <span>IMDb {item.imdbRate.toFixed(1)}</span>
                  </div>
                  <div className="featured-copy">
                    <span className="featured-initials">{artwork.initials}</span>
                    <h3>{item.title}</h3>
                    <p>{item.year ?? "Unknown year"} • {formatCompactVotes(item.imdbVotes)}</p>
                  </div>
                </button>
              );
            })}
          </section>

          <section className="section-header browse-header">
            <div>
              <p className="section-kicker">Browse wall</p>
              <h2>Continuous catalog browsing</h2>
            </div>
            <p className="section-note">Auto-loads as you scroll. Opening a title keeps the wall in place.</p>
          </section>

          <section className="browse-grid">
            {renderedItems.map((item) => {
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
                    <span className="card-art-initials">{artwork.initials}</span>
                    <span className="card-art-badge">{formatType(item.type)}</span>
                  </div>

                  <div className="catalog-copy">
                    <div className="catalog-topline">
                      <h3>{item.title}</h3>
                      <span className="catalog-rate">IMDb {item.imdbRate.toFixed(1)}</span>
                    </div>
                    <p className="catalog-meta">
                      <span>{item.year ?? "Unknown year"}</span>
                      <span>{formatCompactVotes(item.imdbVotes)}</span>
                    </p>
                  </div>
                </button>
              );
            })}
          </section>

          <section className="footer-bar glass-panel">
            <span>{Math.min(renderedCount, browseItems.length)} of {browseItems.length} browse titles visible</span>
            <span>{meta ? `Synced ${new Date(meta.fetchedAt).toLocaleString()}` : "Waiting for source"}</span>
          </section>
          <div ref={loadMoreRef} className="infinite-sentinel" />
        </>
      ) : null}

      {hasNoResults ? (
        <section className="feedback-panel empty-panel glass-panel">
          <p className="section-kicker">No match</p>
          <h2>Nothing fits the current filters.</h2>
          <p>Try a broader search, switch type, or change the sort focus.</p>
        </section>
      ) : null}

      <div className={isMobileFilterOpen ? "mobile-filter-shell open" : "mobile-filter-shell"}>
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close filter panel"
          onClick={closeMobileFilters}
        />
        <aside
          id="mobile-filter-drawer"
          ref={mobileFilterRef}
          className="mobile-filter-drawer glass-panel"
          aria-hidden={!isMobileFilterOpen}
          aria-label="Catalog filters"
        >
          <div className="mobile-filter-header">
            <div>
              <p className="section-kicker">Browse controls</p>
              <h2>Filters & sort</h2>
            </div>
            <button type="button" className="drawer-close" onClick={closeMobileFilters}>
              Close
            </button>
          </div>
          <div className="mobile-filter-body">
            {filterControls}
          </div>
        </aside>
      </div>

      <div className={isDrawerOpen ? "drawer-shell open" : "drawer-shell"}>
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close detail panel"
          onClick={closeDrawer}
        />
        <aside
          ref={drawerRef}
          className="detail-drawer glass-panel"
          aria-hidden={!isDrawerOpen}
          aria-label="Title details"
        >
          {activeItem ? (
            <>
              <div className="drawer-hero" style={{ background: getArtwork(activeItem).background }}>
                <div className="drawer-hero-overlay" />
                <button type="button" className="drawer-close" onClick={closeDrawer}>
                  Close
                </button>
                <div className="drawer-hero-copy">
                  <span className="section-kicker">{formatType(activeItem.type)}</span>
                  <h2>{activeItem.title}</h2>
                  <p>
                    {activeItem.year ?? "Unknown year"} • IMDb {activeItem.imdbRate.toFixed(1)} •{" "}
                    {activeItem.imdbVotes.toLocaleString()} votes
                  </p>
                </div>
              </div>

              <div className="drawer-body">
                <div className="drawer-actions">
                  <button
                    type="button"
                    className="drawer-share-button"
                    onClick={() => void shareTitle(activeItem)}
                  >
                    Share title
                  </button>
                  <a
                    className="imdb-link"
                    href={`https://www.imdb.com/title/${activeItem.imdbCode}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ImdbIcon />
                    Open on IMDb
                  </a>
                </div>
                {shareState ? (
                  <p className={shareState.tone === "success" ? "drawer-status success" : "drawer-status error"}>
                    {shareState.message}
                  </p>
                ) : null}

                {activeItem.type === "Movie" ? (
                  <div className="download-stack">
                    {activeItem.downloads.map((group) => (
                      <section key={group.label} className="download-panel">
                        <header className="download-heading">
                          <h3>{group.label}</h3>
                          <span>{group.links.length} options</span>
                        </header>
                        <div className="download-grid">
                          {group.links.map((link) => (
                            <a key={link.url} href={link.url} className="download-link">
                              <span>{link.label}</span>
                              <strong>{link.size ?? "Open"}</strong>
                            </a>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="download-stack">
                    {activeItem.seasons.map((season) => (
                      <section key={season.seasonNumber} className="download-panel">
                        <header className="download-heading">
                          <h3>Season {season.seasonNumber}</h3>
                          <span>{season.groups.reduce((sum, group) => sum + group.links.length, 0)} links</span>
                        </header>
                        <div className="season-stack">
                          {season.groups.map((group) => (
                            <div key={group.label} className="season-group">
                              <span className="season-label">{group.label}</span>
                              <div className="download-grid">
                                {group.links.map((link) => (
                                  <a key={link.url} href={link.url} className="download-link">
                                    <span>{link.label}</span>
                                    <strong>{link.size ?? "Open"}</strong>
                                  </a>
                                ))}
                              </div>
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
              <p className="section-kicker">Detail panel</p>
              <h2>Select a title</h2>
              <p>Open any card to inspect IMDb details and jump to the available downloads.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
