# @carbonplan/zarr-layer

MapLibre/Mapbox GL custom layer for rendering Zarr datasets, inspired by
[zarr-cesium](https://github.com/NOC-OI/zarr-cesium),
[zarr-gl](https://github.com/carderne/zarr-gl), and
[carbonplan/maps](https://github.com/carbonplan/maps).

## Install

```bash
npm install zarr-maplibre maplibre-gl
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
      colormap: [...],
      selector: { time: 0 },
      zarrVersion: 3,
    })
  )
})
```
