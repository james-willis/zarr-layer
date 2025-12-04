// @ts-expect-error - carbonplan components types not available
import { Filter, Select, Slider } from '@carbonplan/components'
import { Box } from 'theme-ui'
import { DATASET_MODULES } from '../lib/constants'
import { useAppStore } from '../lib/store'
import { DatasetControlsProps } from '../datasets/types'

const colormaps = [
  'reds',
  'oranges',
  'yellows',
  'greens',
  'teals',
  'blues',
  'purples',
  'pinks',
  'greys',
  'fire',
  'earth',
  'water',
  'heart',
  'wind',
  'warm',
  'cool',
  'pinkgreen',
  'redteal',
  'orangeblue',
  'yellowpurple',
  'redgrey',
  'orangegrey',
  'yellowgrey',
  'greengrey',
  'tealgrey',
  'bluegrey',
  'purplegrey',
  'pinkgrey',
  'rainbow',
  'sinebow',
]

const Controls = () => {
  const datasetId = useAppStore((state) => state.datasetId)
  const datasetModule = useAppStore((state) => state.getDatasetModule())
  const datasetState = useAppStore((state) => state.getDatasetState())
  const opacity = useAppStore((state) => state.opacity)
  const clim = useAppStore((state) => state.clim)
  const colormap = useAppStore((state) => state.colormap)
  const globeProjection = useAppStore((state) => state.globeProjection)
  const mapProvider = useAppStore((state) => state.mapProvider)

  const setDatasetId = useAppStore((state) => state.setDatasetId)
  const setOpacity = useAppStore((state) => state.setOpacity)
  const setClim = useAppStore((state) => state.setClim)
  const setColormap = useAppStore((state) => state.setColormap)
  const setGlobeProjection = useAppStore((state) => state.setGlobeProjection)
  const setMapProvider = useAppStore((state) => state.setMapProvider)
  const setActiveDatasetState = useAppStore(
    (state) => state.setActiveDatasetState
  )

  const handleDatasetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDatasetId(e.target.value)
  }

  const ActiveDatasetControls =
    datasetModule.Controls as React.FC<DatasetControlsProps<any>>

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        Dataset
        <Box sx={{ display: 'block', mt: 1, width: '100%' }}>
          <Select value={datasetId} onChange={handleDatasetChange}>
            {Object.entries(DATASET_MODULES).map(([key, config]) => (
              <option key={key} value={key}>
                {config.info}
              </option>
            ))}
          </Select>
        </Box>
      </Box>

      <ActiveDatasetControls
        state={datasetState as any}
        setState={setActiveDatasetState as any}
      />

      <Box>
        Opacity: {opacity}
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={opacity}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setOpacity(parseFloat(e.target.value))
          }
        />
      </Box>

      <Box>
        Min value: {clim[0]}
        <Slider
          min={
            datasetModule.clim[0] - (datasetModule.clim[1] - datasetModule.clim[0]) * 0.5
          }
          max={datasetModule.clim[1]}
          step={(datasetModule.clim[1] - datasetModule.clim[0]) / 100}
          value={clim[0]}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setClim([parseFloat(e.target.value), clim[1]])
          }
        />
      </Box>

      <Box>
        Max value: {clim[1]}
        <Slider
          min={datasetModule.clim[0]}
          max={
            datasetModule.clim[1] +
            (datasetModule.clim[1] - datasetModule.clim[0]) * 0.5
          }
          step={(datasetModule.clim[1] - datasetModule.clim[0]) / 100}
          value={clim[1]}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setClim([clim[0], parseFloat(e.target.value)])
          }
        />
      </Box>

      <Box>
        Projection
        <Filter
          values={{ mercator: !globeProjection, globe: globeProjection }}
          setValues={(obj: Record<string, boolean>) => {
            if (obj.mercator) setGlobeProjection(false)
            if (obj.globe) setGlobeProjection(true)
          }}
        />
      </Box>

      <Box>
        Map provider
        <Filter
          values={{
            maplibre: mapProvider === 'maplibre',
            mapbox: mapProvider === 'mapbox',
          }}
          setValues={(obj: Record<string, boolean>) => {
            if (obj.maplibre) setMapProvider('maplibre')
            if (obj.mapbox) setMapProvider('mapbox')
          }}
        />
      </Box>

      <Box>
        Colormap
        <Box sx={{ display: 'block', mt: 1, width: '100%' }}>
          <Select
            value={colormap}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setColormap(e.target.value)
            }
          >
            {colormaps.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Box>
      </Box>
    </Box>
  )
}

export default Controls
