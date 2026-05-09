export type TitleType = "Movie" | "TvSeries";

export interface DownloadLink {
  label: string;
  url: string;
  size?: string | null;
  parentGroupName?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}

export interface DownloadGroup {
  label: string;
  links: DownloadLink[];
}

export interface SeasonGroup {
  seasonNumber: number;
  groups: DownloadGroup[];
}

export interface CatalogItem {
  id: string;
  title: string;
  year?: number | null;
  type: TitleType;
  imdbCode: string;
  imdbRate: number;
  imdbVotes: number;
  isDubbed: boolean;
  imageUrl?: string | null;
  downloads: DownloadGroup[];
  seasons: SeasonGroup[];
}

export interface CatalogMeta {
  fetchedAt: string;
  sourceUrl: string;
  itemCount: number;
}

export interface CatalogResponse {
  meta: CatalogMeta;
  items: CatalogItem[];
}

export interface ResolvedDirectoryLinks {
  url: string;
  links: DownloadLink[];
  error?: string | null;
}

export interface ResolveDirectoryLinksResponse {
  results: ResolvedDirectoryLinks[];
}
