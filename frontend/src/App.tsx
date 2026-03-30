import { type MouseEvent as ReactMouseEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { fetchCatalog } from "./api";
import type { CatalogItem, TitleType } from "./types";
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

function CardBadges({ item }: { item: CatalogItem }) {
  return (
    <div className="card-art-badges">
      <span className="card-art-badge">{formatType(item.type)}</span>
      {item.isDubbed ? <span className="card-art-badge dubbed">دوبله شده</span> : null}
    </div>
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
  const [browseMode, setBrowseMode] = useState<BrowseMode>("home");
  const [categoryRenderedCount, setCategoryRenderedCount] = useState(20);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pendingSharedTitle, setPendingSharedTitle] = useState<string | null>(() => readRequestedTitle());
  const [shareState, setShareState] = useState<ShareState>(null);
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

    return sortItems(next, sort, order);
  }, [items, order, sort, trimmedQuery]);

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

                {activeItem.type === "Movie" ? (
                  <div className="download-stack">
                    {activeItem.downloads.map((group) => (
                      <section key={group.label} className="download-panel">
                        <header className="download-heading">
                          <h3>{localizeDynamicLabel(group.label)}</h3>
                          <span>{group.links.length.toLocaleString("fa-IR")} گزینه</span>
                        </header>
                        <div className="download-grid">
                          {group.links.map((link) => (
                            <a key={link.url} href={link.url} className="download-link" target="_blank" rel="noreferrer">
                              <span>{localizeDynamicLabel(link.label)}</span>
                              <strong>{link.size ?? "باز کردن"}</strong>
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
                              <div className="download-grid">
                                {group.links.map((link) => (
                                  <a key={link.url} href={link.url} className="download-link" target="_blank" rel="noreferrer">
                                    <span>{localizeDynamicLabel(link.label)}</span>
                                    <strong>{link.size ?? "باز کردن"}</strong>
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
