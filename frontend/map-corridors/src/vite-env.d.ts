/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN?: string
  readonly VITE_MAPYCZ_TOKEN?: string
  readonly VITE_MAPTILER_KEY?: string
  readonly VITE_DESKTOP_BUILD?: string
  readonly VITE_DEBUG_CORRIDORS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
