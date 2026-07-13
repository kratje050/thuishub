export type MetadataProviderId = 'tvmaze' | 'omdb' | 'local_nfo' | 'embedded' | 'manual';
export type MetadataMediaType = 'movie' | 'series' | 'season' | 'episode';
export type MetadataConfidence = 'very_certain' | 'probable' | 'review' | 'none';
export type MetadataImageType = 'poster' | 'backdrop' | 'banner' | 'logo' | 'landscape' | 'episode';

export type MetadataExternalIds = {
  imdb?: string | null;
  tvmaze?: string | null;
  thetvdb?: string | null;
  omdb?: string | null;
  legacyTmdb?: string | null;
};

export type MetadataPerson = {
  name: string;
  role?: string;
  character?: string;
  order?: number;
};

export type MetadataRating = {
  source: string;
  value: number;
  maxValue: number;
  votes?: number;
};

export type MetadataImage = {
  type: MetadataImageType;
  url?: string;
  localPath?: string;
  width?: number;
  height?: number;
  primary?: boolean;
};

export type MetadataSeasonInfo={providerId:string;number:number;episodeOrder?:number;premiereDate?:string;endDate?:string;image?:MetadataImage};

export type MetadataRecord = {
  mediaType: MetadataMediaType;
  title: string;
  originalTitle?: string;
  sortTitle?: string;
  year?: number;
  premiered?: string;
  summary?: string;
  runtimeMinutes?: number;
  genres: string[];
  cast: MetadataPerson[];
  crew: MetadataPerson[];
  ratings: MetadataRating[];
  contentRating?: string;
  originalContentRating?: string;
  language?: string;
  country?: string;
  studio?: string;
  status?: string;
  network?: string;
  streamingService?: string;
  officialUrl?: string;
  awards?: string;
  tagline?: string;
  season?: number;
  episode?: number;
  absoluteEpisode?: number;
  aired?: string;
  displaySeason?:number;
  displayEpisode?:number;
  tags?:string[];
  collection?: string;
  trailer?: string;
  images: MetadataImage[];
  externalIds: MetadataExternalIds;
  provider: MetadataProviderId;
  providerId: string;
  providerUrl?: string;
  confidence?: MetadataConfidence;
  rawContentRating?: string;
};

export type MetadataSearchQuery = {
  title: string;
  year?: number;
  imdbId?: string;
  tvmazeId?: string;
  thetvdbId?: string;
  mediaType?: 'movie' | 'series';
};

export type MetadataItemContext = MetadataSearchQuery & {
  mediaId?: number;
  filePath?: string;
  sourcePath?: string;
  seriesTitle?: string;
  season?: number;
  episode?: number;
  absoluteEpisode?: number;
  aired?: string;
};

export type ProviderStatus = {
  id: MetadataProviderId;
  label: string;
  enabled: boolean;
  configured: boolean;
  available: boolean;
  attribution?: string;
  informationUrl?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  rateLimitedUntil?: string;
  requestsToday: number;
  cacheHits: number;
  cacheMisses: number;
  failures: number;
  localDailyLimit?: number;
  remainingLocalRequests?: number;
};

export interface MetadataProvider {
  readonly id: MetadataProviderId;
  readonly label: string;
  readonly attribution?: string;
  readonly informationUrl?: string;
  searchMovies(query: MetadataSearchQuery): Promise<MetadataRecord[]>;
  searchSeries(query: MetadataSearchQuery): Promise<MetadataRecord[]>;
  getMovie(providerId: string): Promise<MetadataRecord | null>;
  getSeries(providerId: string): Promise<MetadataRecord | null>;
  getSeason(seriesId: string, season: number): Promise<MetadataRecord[]>;
  getEpisode(seriesId: string, season: number, episode: number): Promise<MetadataRecord | null>;
  getAllEpisodes?(seriesId: string): Promise<MetadataRecord[]>;
  getSeasons?(seriesId:string):Promise<MetadataSeasonInfo[]>;
  getCast(providerId: string): Promise<MetadataPerson[]>;
  getCrew(providerId: string): Promise<MetadataPerson[]>;
  getImages(providerId: string): Promise<MetadataImage[]>;
  getRatings(providerId: string): Promise<MetadataRating[]>;
  findByExternalId(ids: MetadataExternalIds): Promise<MetadataRecord | null>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  getProviderStatus(): ProviderStatus;
}

export const EMPTY_METHODS = {
  searchMovies: async () => [] as MetadataRecord[],
  searchSeries: async () => [] as MetadataRecord[],
  getMovie: async () => null as MetadataRecord | null,
  getSeries: async () => null as MetadataRecord | null,
  getSeason: async () => [] as MetadataRecord[],
  getEpisode: async () => null as MetadataRecord | null,
  getCast: async () => [] as MetadataPerson[],
  getCrew: async () => [] as MetadataPerson[],
  getImages: async () => [] as MetadataImage[],
  getRatings: async () => [] as MetadataRating[],
  findByExternalId: async () => null as MetadataRecord | null,
};
