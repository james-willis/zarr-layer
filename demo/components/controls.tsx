// @ts-expect-error - carbonplan components types not available
import { Filter, Select, Slider } from '@carbonplan/components'
import { Box } from 'theme-ui'
import { DATASETS } from '../lib/constants'
import { combinedBandsCustomFrag } from './map-shared'
import { useAppStore } from '../lib/store'

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
  const opacity = useAppStore((state) => state.opacity)
  const clim = useAppStore((state) => state.clim)
  const colormap = useAppStore((state) => state.colormap)
  const time = useAppStore((state) => state.time)
  const band = useAppStore((state) => state.band)
  const month = useAppStore((state) => state.month)
  const precipWeight = useAppStore((state) => state.precipWeight)
  const globeProjection = useAppStore((state) => state.globeProjection)
  const mapProvider = useAppStore((state) => state.mapProvider)
  const dataset = useAppStore((state) => state.getDataset())

  const setDatasetId = useAppStore((state) => state.setDatasetId)
  const setOpacity = useAppStore((state) => state.setOpacity)
  const setClim = useAppStore((state) => state.setClim)
  const setColormap = useAppStore((state) => state.setColormap)
  const setTime = useAppStore((state) => state.setTime)
  const setBand = useAppStore((state) => state.setBand)
  const setMonth = useAppStore((state) => state.setMonth)
  const setPrecipWeight = useAppStore((state) => state.setPrecipWeight)
  const setGlobeProjection = useAppStore((state) => state.setGlobeProjection)
  const setMapProvider = useAppStore((state) => state.setMapProvider)

  const handleDatasetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDatasetId(e.target.value)
  }

  const handleBandChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setBand(e.target.value)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        Dataset
        <Box sx={{ display: 'block', mt: 1, width: '100%' }}>
          <Select value={datasetId} onChange={handleDatasetChange}>
            {Object.entries(DATASETS).map(([key, config]) => (
              <option key={key} value={key}>
                {config.info}
              </option>
            ))}
          </Select>
        </Box>
      </Box>

      {dataset.has4D ? (
        <>
          <Box>
            <Box>Band</Box>
            <Select value={band} onChange={handleBandChange}>
              <option value='tavg'>tavg</option>
              <option value='prec'>prec</option>
              <option value='combined'>
                combined (custom frag w/ uniform)
              </option>
            </Select>
            {band === 'combined' && (
              <Box
                as='code'
                sx={{ fontSize: 0, color: 'secondary', whiteSpace: 'pre-wrap' }}
              >
                {combinedBandsCustomFrag}
              </Box>
            )}
          </Box>

          <Box>
            Month: {month}
            <Slider
              min={1}
              max={12}
              step={1}
              value={month}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setMonth(parseInt(e.target.value))
              }
            />
          </Box>

          {band === 'combined' && (
            <Box>
              Precip Weight: {precipWeight}
              <Slider
                min={0}
                max={5}
                step={0.1}
                value={precipWeight}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setPrecipWeight(parseFloat(e.target.value))
                }
              />
            </Box>
          )}
        </>
      ) : (
        <Box>
          Time Index: {time}
          <Slider
            min={0}
            max={10}
            step={1}
            value={time}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setTime(parseInt(e.target.value))
            }
          />
        </Box>
      )}

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
          min={dataset.clim[0] - (dataset.clim[1] - dataset.clim[0]) * 0.5}
          max={dataset.clim[1]}
          step={(dataset.clim[1] - dataset.clim[0]) / 100}
          value={clim[0]}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setClim([parseFloat(e.target.value), clim[1]])
          }
        />
      </Box>

      <Box>
        Max value: {clim[1]}
        <Slider
          min={dataset.clim[0]}
          max={dataset.clim[1] + (dataset.clim[1] - dataset.clim[0]) * 0.5}
          step={(dataset.clim[1] - dataset.clim[0]) / 100}
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
