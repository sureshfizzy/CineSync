/// <reference types="vite/client" />

declare interface ImportMetaEnv {
  readonly VITE_TMDB_API_KEY?: string;
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv;
} 