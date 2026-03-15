import { useEffect, useMemo, useState } from "react";
import { fetchCatalog, reloadCatalog } from "./api";
import type { CatalogItem, CatalogResponse } from "./types";
import "./styles.css";

const TYPE_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Movies", value: "movie" },
  { label: "TV Series", value: "tvSeries" }
] as const;

export default function App() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [meta, setMeta] = useState<CatalogResponse["meta"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_OPTIONS)[number]["value"]>("all");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchCatalog({
        q: query.trim() || undefined,
        type: typeFilter,
        order
      })
        .then((response) => {
          setItems(response.items);
          setMeta(response.meta);
          if (!response.items.find((item) => item.id === selectedId)) {
            setSelectedId(response.items[0]?.id ?? null);
          }
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to load catalog");
        })
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(handle);
  }, [query, typeFilter, order, selectedId]);

  const handleReload = async () => {
    setLoading(true);
    setError(null);
    try {
      await reloadCatalog();
      const response = await fetchCatalog({
        q: query.trim() || undefined,
        type: typeFilter,
        order
      });
      setItems(response.items);
      setMeta(response.meta);
      if (!response.items.find((item) => item.id === selectedId)) {
        setSelectedId(response.items[0]?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">VOD Control Room</p>
          <h1>Offline Archive</h1>
        </div>
        <div className="meta-block">
          <div className="meta-row">
            <span className="meta-label">Items</span>
            <span>{meta?.itemCount ?? "-"}</span>
          </div>
          <div className="meta-row">
            <span className="meta-label">Fetched</span>
            <span>{meta ? new Date(meta.fetchedAt).toLocaleString() : "-"}</span>
          </div>
        </div>
      </header>

      <section className="controls">
        <label className="search">
          <span>Search title</span>
          <input
            type="search"
            placeholder="The Dark Knight"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="control-group">
          <span>Type</span>
          <div className="pill-row">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={option.value === typeFilter ? "pill active" : "pill"}
                onClick={() => setTypeFilter(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <span>IMDb Sort</span>
          <button
            className="pill"
            type="button"
            onClick={() => setOrder(order === "desc" ? "asc" : "desc")}
          >
            {order === "desc" ? "High to Low" : "Low to High"}
          </button>
        </div>

        <div className="control-group">
          <span>Cache</span>
          <button className="pill danger" onClick={handleReload} type="button">
            Reload
          </button>
        </div>
      </section>

      {error ? <div className="error">{error}</div> : null}

      <main className="layout">
        <section className="list">
          {loading ? <div className="loading">Loading catalog…</div> : null}
          {items.map((item) => (
            <button
              key={item.id}
              className={item.id === selectedId ? "card active" : "card"}
              onClick={() => setSelectedId(item.id)}
              type="button"
            >
              <div className="card-header">
                <h3>{item.title}</h3>
                <span className={item.type === "Movie" ? "tag" : "tag alt"}>
                  {item.type === "Movie" ? "Movie" : "TV Series"}
                </span>
              </div>
              <div className="card-meta">
                <span>{item.year ?? "—"}</span>
                <span className="rate">IMDb {item.imdbRate.toFixed(1)}</span>
                <span>{item.imdbVotes.toLocaleString()} votes</span>
              </div>
            </button>
          ))}
        </section>

        <section className="detail">
          {selectedItem ? (
            <div className="detail-inner">
              <header className="detail-header">
                <div>
                  <h2>{selectedItem.title}</h2>
                  <p>
                    {selectedItem.year ?? "Unknown year"} · {selectedItem.type === "Movie" ? "Movie" : "TV Series"}
                  </p>
                </div>
                <a
                  className="imdb"
                  href={`https://www.imdb.com/title/${selectedItem.imdbCode}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View IMDb
                </a>
              </header>

              {selectedItem.type === "Movie" ? (
                <div className="download-section">
                  {selectedItem.downloads.map((group) => (
                    <div key={group.label} className="download-group">
                      <h4>{group.label}</h4>
                      <div className="link-grid">
                        {group.links.map((link) => (
                          <a key={link.url} href={link.url} className="download-link">
                            <span>{link.label}</span>
                            <span className="size">{link.size ?? ""}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="download-section">
                  {selectedItem.seasons.map((season) => (
                    <div key={season.seasonNumber} className="season">
                      <h4>Season {season.seasonNumber}</h4>
                      {season.groups.map((group) => (
                        <div key={group.label} className="download-group">
                          <h5>{group.label}</h5>
                          <div className="link-grid">
                            {group.links.map((link) => (
                              <a key={link.url} href={link.url} className="download-link">
                                <span>{link.label}</span>
                                <span className="size">{link.size ?? ""}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="empty">Select a title to see downloads.</div>
          )}
        </section>
      </main>
    </div>
  );
}
