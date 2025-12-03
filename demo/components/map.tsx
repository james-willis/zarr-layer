import React, { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { layers, namedFlavor } from '@protomaps/basemaps'
import { Protocol } from 'pmtiles'
import { Box } from 'theme-ui'
import { useThemedColormap } from '@carbonplan/colormaps'
import { ZarrLayer } from 'zarr-maplibre'
import { DatasetConfig } from '../lib/constants'

const combinedBandsCustomFrag = `
  uniform float u_precipWeight;

  if (tavg > 1e20 || prec > 1e20) {
    discard;
  }
  
  float combined = tavg + prec * u_precipWeight;
  
  float norm = (combined - clim.x) / (clim.y - clim.x);
  float cla = clamp(norm, 0.0, 1.0);
  vec4 c = texture(colormap, vec2(cla, 0.5));
  fragColor = vec4(c.r, c.g, c.b, opacity);
`

const backgroundColor = '#1b1e23'
const mapTheme = {
  ...namedFlavor('black'),
  buildings: '#00000000',
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

interface MapProps {
  sidebarWidth: number
  datasetId: string
  dataset: DatasetConfig
  opacity: number
  clim: [number, number]
  colormap: string
  time: number
  band: string
  month: number
  precipWeight: number
  globeProjection: boolean
}

const MapComponent = ({
  sidebarWidth,
  datasetId,
  dataset,
  opacity,
  clim,
  colormap,
  time,
  band,
  month,
  precipWeight,
  globeProjection,
}: MapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [isMapLoaded, setIsMapLoaded] = useState(false)
  const zarrLayerRef = useRef<ZarrLayer | null>(null)
  const colormapArray = useThemedColormap(colormap, { format: 'hex' })

  // Initialize Map
  useEffect(() => {
    if (!mapContainer.current || map) return

    let protocol = new Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)

    const newMap = new maplibregl.Map({
      container: mapContainer.current,
      style: {
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
        layers: layers('protomaps', mapTheme, { lang: 'en' }),
      },
      center: [0, 20],
      zoom: 2,
    })

    newMap.on('load', () => {
      setMap(newMap)
      setIsMapLoaded(true)
    })

    return () => {
      newMap.remove()
      setMap(null)
    }
  }, [])

  // Handle Globe Projection
  useEffect(() => {
    if (!map) return
    map.setProjection(
      globeProjection ? { type: 'globe' } : { type: 'mercator' },
    )
  }, [map, globeProjection])

  // Handle Layer Lifecycle
  useEffect(() => {
    if (!map || !isMapLoaded) return

    const isCombined = band === 'combined'

    if (zarrLayerRef.current) {
      if (map.getLayer('zarr-layer')) {
        map.removeLayer('zarr-layer')
      }
      zarrLayerRef.current = null
    }

    let selector: any = {}
    if (dataset.has4D) {
      if (isCombined) {
        selector = { band: ['tavg', 'prec'], month }
      } else {
        selector = { band: parseInt(band), month }
      }
    } else {
      selector = { time }
    }

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
    }

    try {
      const layer = new ZarrLayer(options)
      map.addLayer(layer, 'landuse_pedestrian')
      zarrLayerRef.current = layer

      if (dataset.center) {
        map.flyTo({ center: dataset.center, zoom: dataset.zoom || 4 })
      }
    } catch (error) {
      console.error('Error creating ZarrLayer:', error)
    }

    // We rely on recreating layer when key props change for simplicity in this demo
    // Real app might want more granular updates, but ZarrLayer is fast to recreate mostly.
    // However, to avoid flickering, we should try to update props when possible.
    // For now, this Effect runs on datasetId change primarily.
    // Wait, I should separate creation from updating.
  }, [map, isMapLoaded, datasetId, band, colormapArray])

  // Handle Lightweight Updates
  useEffect(() => {
    const layer = zarrLayerRef.current
    if (!layer || !map || !isMapLoaded) return

    // If source changed, we might be in a race with the creation effect.
    // But since effects run in order, creation effect runs first if deps change.

    // Actually, the creation effect above depends on `datasetId`.
    // If we only change opacity, creation effect won't run.

    layer.setOpacity(opacity)
    layer.setColormap(colormapArray)
    layer.setClim(clim)

    const isCombined = band === 'combined'
    let selector: any = {}
    if (dataset.has4D) {
      if (isCombined) {
        selector = { band: ['tavg', 'prec'], month }
      } else {
        selector = { band: parseInt(band), month }
      }
    } else {
      selector = { time }
    }
    layer.setSelector(selector)

    if (isCombined) {
      layer.setUniforms({ u_precipWeight: precipWeight })
    }
  }, [
    opacity,
    clim,
    colormapArray,
    time,
    band,
    month,
    precipWeight,
    dataset,
    map,
    isMapLoaded,
  ])

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

export default MapComponent
