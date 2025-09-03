import React from 'react'
import Map, { Layer, Source } from '@vis.gl/react-maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapProviderId, ProviderConfig } from './providers'

type Overlay = {
  id: string
  data: any
  type: 'line' | 'fill' | 'circle'
  paint?: any
  layout?: any
}

export function MapProviderView(props: {
  provider: MapProviderId
  baseStyle: 'streets' | 'satellite'
  providerConfig: ProviderConfig
  geojsonOverlays?: Overlay[]
}) {
  const { baseStyle, providerConfig, geojsonOverlays } = props

  const styleUrl = providerConfig.styles[baseStyle]

  return (
    <Map
      mapStyle={styleUrl}
      initialViewState={{ longitude: 14.42076, latitude: 50.08804, zoom: 6 }}
      style={{ width: '100%', height: '100%' }}
    >
      {geojsonOverlays?.map((ov) => (
        <Source id={ov.id} key={ov.id} type="geojson" data={ov.data}>
          {ov.type === 'line' && (
            <Layer id={`${ov.id}-line`} type="line" paint={{ 'line-color': '#00b3ff', 'line-width': 3, ...(ov.paint || {}) }} layout={ov.layout ?? {}} />
          )}
          {ov.type === 'fill' && (
            <Layer id={`${ov.id}-fill`} type="fill" paint={{ 'fill-color': '#1d4ed8', 'fill-opacity': 0.25, ...(ov.paint || {}) }} layout={ov.layout ?? {}} />
          )}
          {ov.type === 'circle' && [
            <Layer key={`${ov.id}-circle`} id={`${ov.id}-circle`} type="circle" paint={{ 'circle-color': '#ef4444', 'circle-radius': 4, ...(ov.paint || {}) }} layout={ov.layout ?? {}} />,
            <Layer 
              key={`${ov.id}-labels`}
              id={`${ov.id}-labels`} 
              type="symbol" 
              paint={{ 'text-color': '#000000', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }} 
              layout={{ 
                'text-field': ['get', 'name'], 
                'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'], 
                'text-size': 12, 
                'text-offset': [0, -2],
                'text-anchor': 'bottom',
                ...(ov.layout ?? {}) 
              }} 
            />
          ]}
        </Source>
      ))}
    </Map>
  )
}


