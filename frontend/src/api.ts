import type { CatalogResponse, ShareEventName, ShareEventPayload } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export async function fetchCatalog(params: {
  q?: string;
  type?: "all" | "movie" | "tvSeries";
  sort?: "rate" | "votes" | "date";
  order?: "asc" | "desc";
} = {}): Promise<CatalogResponse> {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set("q", params.q);
  if (params.type) searchParams.set("type", params.type);
  if (params.sort) {
    searchParams.set("sort", params.sort);
  } else {
    searchParams.set("sort", "rate");
  }
  if (params.order) searchParams.set("order", params.order);

  const res = await fetch(`${API_BASE}/api/catalog?${searchParams.toString()}`);
  if (!res.ok) {
    throw new Error(`Catalog request failed: ${res.status}`);
  }
  return res.json();
}

export async function reloadCatalog(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/catalog/reload`, {
    method: "POST"
  });
  if (!res.ok) {
    throw new Error(`Reload failed: ${res.status}`);
  }
}

export async function trackEvent(name: ShareEventName, payload: ShareEventPayload): Promise<void> {
  await fetch(`${API_BASE}/api/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name, payload })
  });
}
