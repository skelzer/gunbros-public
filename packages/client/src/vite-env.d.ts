/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Baked in by vite.config.ts; empty means "derive from the page origin". */
  readonly VITE_WS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
