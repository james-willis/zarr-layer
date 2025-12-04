import React, { useEffect, useRef, useState } from 'react'
import { Box } from 'theme-ui'
// @ts-expect-error - carbonplan colormaps types not available
import { useThemedColormap } from '@carbonplan/colormaps'
import { ZarrLayer } from '@carbonplan/zarr-layer'
import maplibregl from 'maplibre-gl'
import mapboxgl from 'mapbox-gl'
import { layers, namedFlavor } from '@protomaps/basemaps'
import { Protocol } from 'pmtiles'
import { useAppStore } from '../lib/store'

export type MapProvider = 'maplibre' | 'mapbox'

const backgroundColor = '#1b1e23'
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const mapLibreTheme = {
  ...namedFlavor('black'),
  buildings: 'rgba(0, 0, 0, 0)',
  background: backgroundColor,
  earth: backgroundColor,
  park_a: backgroundColor,
  park_b: backgroundColor,
  golf_course: backgroundColor,
  aerodrome: backgroundColor,
  industrial: backgroundColor,
  university: backgroundColor,
  school: backgroundColor,
  zoo: backgroundColor,
  farmland: backgroundColor,
  wood_a: backgroundColor,
  wood_b: backgroundColor,
  residential: backgroundColor,
  protected_area: backgroundColor,
  scrub_a: backgroundColor,
  scrub_b: backgroundColor,
  landcover: {
    barren: backgroundColor,
    farmland: backgroundColor,
    forest: backgroundColor,
    glacier: backgroundColor,
    grassland: backgroundColor,
    scrub: backgroundColor,
    urban_area: backgroundColor,
  },
  regular: 'Relative Pro Book',
  bold: 'Relative Pro Book',
  italic: 'Relative Pro Book',
}

export const combinedBandsCustomFrag = `
  uniform float u_precipWeight;
  float combined = tavg + prec * u_precipWeight;
  float norm = (combined - clim.x) / (clim.y - clim.x);
  float cla = clamp(norm, 0.0, 1.0);
  vec4 c = texture(colormap, vec2(cla, 0.5));
  fragColor = vec4(c.r, c.g, c.b, opacity);
`

export const monthRangeAverageFrag = `
  uniform float u_monthStart;
  uniform float u_monthEnd;
  float sum = 0.0;
  float count = 0.0;
  ${ALL_MONTHS.map(
    (month) => `
  if (u_monthStart <= ${month.toFixed(1)} && ${month.toFixed(
      1
    )} <= u_monthEnd) {
    sum += month_${month};
    count += 1.0;
  }`
  ).join('')}
  float average = count > 0.0 ? sum / count : 0.0;
  float rescaled = (average - clim.x) / (clim.y - clim.x);
  vec4 c = texture(colormap, vec2(clamp(rescaled, 0.0, 1.0), 0.5));
  fragColor = vec4(c.r, c.g, c.b, opacity);
`

export interface MapInstance {
  on(event: string, callback: () => void): void
  remove(): void
  getLayer(id: string): any
  removeLayer(id: string): void
  addLayer(layer: any, beforeId?: string): void
  setProjection(projection: any): void
  resize?(): void
  flyTo(options: { center: [number, number]; zoom: number }): void
}

export interface MapConfig {
  createMap: (
    container: HTMLDivElement,
    globeProjection: boolean,
  ) => MapInstance
  setProjection: (map: MapInstance, globeProjection: boolean) => void
  getLayerBeforeId: (map: MapInstance) => string | undefined
  needsResize?: boolean
}

const mapLibreConfig: MapConfig = {
  createMap: (container: HTMLDivElement, globeProjection: boolean) => {
    const protocol = new Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)

    return new maplibregl.Map({
      container,
      style: {
        projection: globeProjection ? { type: 'globe' } : { type: 'mercator' },
        version: 8,
        glyphs:
          'https://carbonplan-maps.s3.us-west-2.amazonaws.com/basemaps/fonts/{fontstack}/{range}.pbf',
        sources: {
          protomaps: {
            type: 'vector',
            url: 'pmtiles://https://carbonplan-maps.s3.us-west-2.amazonaws.com/basemaps/pmtiles/global.pmtiles',
            attribution:
              '<a href="https://overturemaps.org/">Overture Maps</a>, <a href="https://protomaps.com">Protomaps</a>, © <a href="https://openstreetmap.org">OpenStreetMap</a>',
          },
        },
        layers: layers('protomaps', mapLibreTheme, { lang: 'en' }),
      },
      center: [0, 20],
      zoom: 2,
    }) as MapInstance
  },
  setProjection: (map: MapInstance, globeProjection: boolean) => {
    ;(map as maplibregl.Map).setProjection(
      globeProjection ? { type: 'globe' } : { type: 'mercator' },
    )
  },
  getLayerBeforeId: () => 'landuse_pedestrian',
}

const mapboxConfig: MapConfig = {
  createMap: (container: HTMLDivElement, globeProjection: boolean) => {
    if (process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN) {
      mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
    }

    return new mapboxgl.Map({
      container,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [0, 20],
      zoom: 2,
      projection: globeProjection ? 'globe' : 'mercator',
    }) as unknown as MapInstance
  },
  setProjection: (map: MapInstance, globeProjection: boolean) => {
    ;(map as mapboxgl.Map).setProjection({
      name: globeProjection ? 'globe' : 'mercator',
    } as mapboxgl.ProjectionSpecification)
  },
  getLayerBeforeId: (map: MapInstance) => {
    const styleLayers = (map as mapboxgl.Map).getStyle().layers
    return styleLayers?.find((layer) => layer.type === 'symbol')?.id
  },
  needsResize: true,
}

export const getMapConfig = (provider: MapProvider): MapConfig => {
  return provider === 'mapbox' ? mapboxConfig : mapLibreConfig
}

export const useMapLayer = (map: MapInstance | null, isMapLoaded: boolean) => {
  const zarrLayerRef = useRef<InstanceType<typeof ZarrLayer> | null>(null)
  const datasetId = useAppStore((state) => state.datasetId)
  const dataset = useAppStore((state) => state.getDataset())
  const opacity = useAppStore((state) => state.opacity)
  const clim = useAppStore((state) => state.clim)
  const colormap = useAppStore((state) => state.colormap)
  const time = useAppStore((state) => state.time)
  const band = useAppStore((state) => state.band)
  const month = useAppStore((state) => state.month)
  const monthStart = useAppStore((state) => state.monthStart)
  const monthEnd = useAppStore((state) => state.monthEnd)
  const precipWeight = useAppStore((state) => state.precipWeight)
  const mapProvider = useAppStore((state) => state.mapProvider)
  const colormapArray = useThemedColormap(colormap, { format: 'hex' })

  const isCombined = band === 'combined'
  const isRangeAverage =
    band === 'tavg_range_avg' || band === 'prec_range_avg'
  const baseRangeBand = isRangeAverage
    ? band.startsWith('prec')
      ? 'prec'
      : 'tavg'
    : null

  const buildSelector = (): Record<
    string,
    number | number[] | string | string[]
  > => {
    if (dataset.has4D) {
      if (isCombined) {
        return { band: ['tavg', 'prec'], month: month }
      } else if (isRangeAverage && baseRangeBand) {
        return { band: baseRangeBand, month: ALL_MONTHS }
      } else {
        return { band: band, month: month }
      }
    } else {
      return { time: time }
    }
  }

  useEffect(() => {
    if (!map || !isMapLoaded) return

    const mapConfig = getMapConfig(mapProvider)

    if (zarrLayerRef.current) {
      try {
        if (map.getLayer('zarr-layer')) {
          map.removeLayer('zarr-layer')
        }
      } catch (e) {}
      zarrLayerRef.current = null
    }

    const selector = buildSelector()

    const options: any = {
      id: 'zarr-layer',
      source: dataset.source,
      variable: dataset.variable,
      clim: clim,
      colormap: colormapArray,
      opacity: opacity,
      selector: selector,
      zarrVersion: dataset.zarrVersion,
      minRenderZoom: dataset.minRenderZoom ?? 0,
      fillValue: dataset.fillValue,
      dimensionNames: dataset.dimensionNames,
    }

    if (isCombined) {
      options.customFrag = combinedBandsCustomFrag
      options.uniforms = { u_precipWeight: precipWeight }
    } else if (isRangeAverage) {
      options.customFrag = monthRangeAverageFrag
      options.uniforms = {
        u_monthStart: monthStart,
        u_monthEnd: monthEnd,
      }
    }

    try {
      const layer = new ZarrLayer(options)
      let beforeId: string | undefined
      try {
        beforeId = mapConfig.getLayerBeforeId(map)
      } catch (e) {}
      map.addLayer(layer, beforeId)
      zarrLayerRef.current = layer

      if (dataset.center) {
        map.flyTo({
          center: dataset.center,
          zoom: dataset.zoom || 4,
        })
      }
    } catch (error) {
      console.error('Error creating ZarrLayer:', error)
    }

    return () => {
      if (zarrLayerRef.current) {
        try {
          if (map.getLayer('zarr-layer')) {
            map.removeLayer('zarr-layer')
          }
        } catch (e) {}
        zarrLayerRef.current = null
      }
    }
  }, [map, isMapLoaded, datasetId, band, colormapArray])

  useEffect(() => {
    const layer = zarrLayerRef.current
    if (!layer || !map || !isMapLoaded) return

    layer.setOpacity(opacity)
    layer.setColormap(colormapArray)
    layer.setClim(clim)

    const selector = buildSelector()
    layer.setSelector(selector)

    const uniforms: Record<string, number> = {}
    if (band === 'combined') {
      uniforms.u_precipWeight = precipWeight
    }
    if (isRangeAverage) {
      uniforms.u_monthStart = monthStart
      uniforms.u_monthEnd = monthEnd
    }
    if (Object.keys(uniforms).length > 0) {
      layer.setUniforms(uniforms)
    }
  }, [
    opacity,
    clim,
    colormapArray,
    time,
    band,
    month,
    monthStart,
    monthEnd,
    precipWeight,
    dataset,
    map,
    isMapLoaded,
  ])

  return zarrLayerRef
}

export const Map = () => {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<MapInstance | null>(null)
  const [map, setMap] = useState<MapInstance | null>(null)
  const [isMapLoaded, setIsMapLoaded] = useState(false)

  const sidebarWidth = useAppStore((state) => state.sidebarWidth)
  const mapProvider = useAppStore((state) => state.mapProvider)
  const globeProjection = useAppStore((state) => state.globeProjection)

  const mapConfig = getMapConfig(mapProvider)

  useMapLayer(map, isMapLoaded)

  useEffect(() => {
    if (!mapContainer.current) return

    const newMap = mapConfig.createMap(mapContainer.current, globeProjection)
    mapInstanceRef.current = newMap

    newMap.on('load', () => {
      setMap(newMap)
      setIsMapLoaded(true)
    })

    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove()
        } catch (error) {
          console.warn('Error removing map:', error)
        }
        mapInstanceRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!map || !isMapLoaded) return
    mapConfig.setProjection(map, globeProjection)
  }, [map, isMapLoaded, globeProjection])

  useEffect(() => {
    if (!map || !isMapLoaded || !mapConfig.needsResize) return
    if (map.resize) {
      map.resize()
    }
  }, [map, isMapLoaded, sidebarWidth])

  return (
    <Box
      ref={mapContainer}
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: sidebarWidth,
        transition: 'left 0.2s',
      }}
    />
  )
}
