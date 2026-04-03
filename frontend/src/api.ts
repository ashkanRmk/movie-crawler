import type {
  AuthResponse,
  AuthUser,
  CatalogItem,
  CatalogResponse,
  GenreItem,
  ResolveDirectoryLinksResponse,
  SubscriptionPlan,
  TitleType
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const TOKEN_KEY = "movie_crawler_token";

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  withAuth = false
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (withAuth) {
    const token = getAuthToken();
    if (!token) {
      throw new Error("Authentication required");
    }

    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Unauthorized");
    }

    if (res.status === 403) {
      throw new Error("Subscription required");
    }

    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function fetchCatalog(params: {
  q?: string;
  type?: "all" | "movie" | "tvSeries";
  sort?: "rate" | "votes" | "date";
  order?: "asc" | "desc";
} = {}): Promise<CatalogResponse> {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set("q", params.q);
  if (params.type) searchParams.set("type", params.type);
  if (params.sort) searchParams.set("sort", params.sort);
  if (params.order) searchParams.set("order", params.order);

  const query = searchParams.toString();
  return apiFetch<CatalogResponse>(`/api/catalog${query ? `?${query}` : ""}`);
}

export async function fetchCatalogItem(imdbCode: string): Promise<CatalogItem> {
  return apiFetch<CatalogItem>(`/api/catalog/${encodeURIComponent(imdbCode)}`);
}

export async function resolveDirectoryLinks(
  urls: string[],
  titleType: TitleType,
  signal?: AbortSignal
): Promise<ResolveDirectoryLinksResponse> {
  const normalizedUrls = Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean)));
  if (normalizedUrls.length === 0) {
    return { results: [] };
  }

  return apiFetch<ResolveDirectoryLinksResponse>(
    "/api/download-links/resolve",
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ urls: normalizedUrls, titleType })
    },
    true
  );
}

export async function register(mobile: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>(
    "/api/auth/register",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mobile, password })
    },
    false
  );
}

export async function login(mobile: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>(
    "/api/auth/login",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mobile, password })
    },
    false
  );
}

export async function me(): Promise<AuthUser> {
  return apiFetch<AuthUser>("/api/auth/me", {}, true);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiFetch<{ status: string }>(
    "/api/auth/change-password",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ currentPassword, newPassword })
    },
    true
  );
}

export async function fetchSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  return apiFetch<SubscriptionPlan[]>("/api/subscriptions/plans");
}

export async function fetchGenres(type?: "movie" | "tvSeries"): Promise<GenreItem[]> {
  const query = type ? `?type=${encodeURIComponent(type)}` : "";
  return apiFetch<GenreItem[]>(`/api/genres${query}`);
}
