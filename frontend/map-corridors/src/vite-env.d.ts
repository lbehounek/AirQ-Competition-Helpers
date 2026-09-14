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

// Resolved by a build-time alias (see vite.config.ts) to either the web module,
// which emits MapLibre's worker as an asset, or the desktop stub.
declare module 'virtual:maplibre-worker-url' {
  const workerUrl: string
  export default workerUrl
}
