export type TitleType = "Movie" | "TvSeries";

export interface DownloadLink {
  label: string;
  url: string;
  size?: string | null;
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
