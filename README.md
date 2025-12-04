# @carbonplan/zarr-layer

MapLibre/Mapbox GL custom layer for rendering Zarr datasets, inspired by
[zarr-cesium](https://github.com/NOC-OI/zarr-cesium),
[zarr-gl](https://github.com/carderne/zarr-gl), and
[carbonplan/maps](https://github.com/carbonplan/maps).

## Install

```bash
npm install @carbonplan/zarr-layer maplibre-gl
```

## Build locally

```bash
npm install
npm run build
```

## Usage

```ts
import maplibregl from 'maplibre-gl'
import { ZarrLayer } from '@carbonplan/zarr-layer'

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  zoom: 2,
})

map.on('load', () => {
  map.addLayer(
    new ZarrLayer({
      id: 'zarr-layer',
      source: 'https://example.com/my.zarr',
      variable: 'temperature',
      clim: [270, 310],
      // Accepts either an array of [r,g,b] numbers (0-255 or 0-1)
      // or an array of hex strings like ['#000000', '#ffffff']
      colormap: ['#000000', '#ffffff'],
      selector: { time: 0 },
      zarrVersion: 3,
    })
  )
})
```
