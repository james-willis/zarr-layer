export type DatasetConfig = {
  source: string
  variable: string
  clim: [number, number]
  colormap: string
  zarrVersion: 2 | 3
  info: string
  sourceInfo: string
  fillValue?: number
  center?: [number, number]
  zoom?: number
  has4D?: boolean
  bandSelector?: string
  monthSelector?: string
  minRenderZoom?: number
  dimensionNames?: {
    lat: string
    lon: string
  }
}

export const DATASETS: Record<string, DatasetConfig> = {
  salinity_v2: {
    source:
      'https://atlantis-vis-o.s3-ext.jc.rl.ac.uk/nemotest101/pyramid2/T1d/sos_abs.zarr',
    variable: 'sos_abs',
    clim: [30, 37],
    colormap: 'blues',
    zarrVersion: 2,
    info: 'NEMO NPD-EORCA1 Salinity',
    sourceInfo: 'Zarr v2 pyramid format (EPSG:3857)',
  },
  temperature_v3: {
    source:
      'https://atlantis-vis-o.s3-ext.jc.rl.ac.uk/noc-npd-era5-demo/npd-eorca1-era5v1/gn/T1y/tos_con',
    variable: 'tos_con',
    clim: [0, 27],
    colormap: 'fire',
    zarrVersion: 3,
    info: 'NEMO NPD-EORCA1 Temperature',
    sourceInfo: 'Zarr v3 pyramid format (EPSG:3857)',
  },
  pressure_v3: {
    source:
      'https://atlantis-vis-o.s3-ext.jc.rl.ac.uk/hurricanes/era5/florence',
    variable: 'surface_pressure',
    clim: [75000, 104000],
    colormap: 'cool',
    zarrVersion: 3,
    info: 'Hurricane Florence Surface Pressure',
    sourceInfo: 'Zarr v3 format (EPSG:4326)',
  },
  wind_risk: {
    source:
      'https://carbonplan-ocr.s3.amazonaws.com/output/fire-risk/pyramid/production/v0.13.2/pyramid.zarr',
    variable: 'wind_risk_2011',
    clim: [0, 20],
    colormap: 'warm',
    zarrVersion: 2,
    info: 'Wind Risk (2011)',
    sourceInfo: 'CarbonPlan Fire Risk Pyramid (Zarr v2)',
    center: [-98, 39],
    zoom: 4,
  },
  carbonplan_4d: {
    source:
      'https://carbonplan-maps.s3.us-west-2.amazonaws.com/v2/demo/4d/tavg-prec-month',
    variable: 'climate',
    clim: [-20, 30],
    colormap: 'redteal',
    zarrVersion: 2,
    info: 'CarbonPlan Climate Demo (4D)',
    sourceInfo: 'Zarr v2 pyramid - temp avg & precipitation by month',
    has4D: true,
    bandSelector: 'band',
    monthSelector: 'month',
    dimensionNames: {
      lat: 'y',
      lon: 'x',
    },
  },
}
