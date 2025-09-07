export type MapProviderId = 'maplibre' | 'mapbox'

export type ProviderConfig = {
  accessToken?: string
  styles: {
    streets: string
    satellite: string
  }
}

export const mapProviders: Record<MapProviderId, ProviderConfig> = {
  maplibre: {
    styles: {
      streets: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
      satellite: (() => {
        const key = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_MAPTILER_KEY) || ''
        return key
          ? `https://api.maptiler.com/maps/hybrid/style.json?key=${key}`
          : 'https://api.maptiler.com/maps/hybrid/style.json?key=GET_YOUR_OWN_KEY'
      })(),
    },
  },
  mapbox: {
    accessToken: (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_MAPBOX_TOKEN) || undefined,
    styles: {
      streets: 'mapbox://styles/mapbox/streets-v12',
      satellite: 'mapbox://styles/mapbox/satellite-v9',
    },
  },
}


