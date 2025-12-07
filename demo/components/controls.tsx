import {
  Filter,
  Select,
  Slider,
  Row,
  Column,
  Colorbar,
  // @ts-expect-error - carbonplan components types not available
} from '@carbonplan/components'
// @ts-expect-error - carbonplan colormaps types not available
import { useThemedColormap } from '@carbonplan/colormaps'
import { Box, Divider, Flex } from 'theme-ui'
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

const headingSx = {
  fontFamily: 'heading',
  letterSpacing: 'smallcaps',
  textTransform: 'uppercase',
  fontSize: [2, 2, 3, 3],
}

const subheadingSx = {
  mt: 3,
  mb: 1,
  fontFamily: 'mono',
  letterSpacing: 'smallcaps',
  textTransform: 'uppercase',
  fontSize: [1, 1, 1, 2],
  color: 'secondary',
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

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
    (state) => state.setActiveDatasetState,
  )
  const themedColormap = useThemedColormap(colormap)

  const handleClimChange = (
    next: (prev: [number, number]) => [number, number],
  ) => {
    const base = datasetModule.clim
    const resolved = next(clim)
    if (!Array.isArray(resolved) || resolved.length < 2) return setClim(base)

    const [rawLo, rawHi] = resolved
    if (!Number.isFinite(rawLo) || !Number.isFinite(rawHi)) return setClim(base)

    const span = Math.max(base[1] - base[0], 1)
    const lower = base[0] - span * 0.5
    const upper = base[1] + span * 0.5
    const [lo, hiRaw] = [Math.min(rawLo, rawHi), Math.max(rawLo, rawHi)].map(
      (value) => clamp(value, lower, upper),
    )
    const hi = hiRaw === lo ? lo + span * 0.001 : hiRaw

    setClim([lo, hi])
  }

  const handleDatasetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDatasetId(e.target.value)
  }

  const ActiveDatasetControls = datasetModule.Controls as React.FC<
    DatasetControlsProps<any>
  >

  return (
    <Box>
      <Box sx={headingSx}>Dataset</Box>

      <Box sx={{ width: '100%', my: 2 }}>
        <Select value={datasetId} onChange={handleDatasetChange}>
          {Object.entries(DATASET_MODULES).map(([key, config]) => (
            <option key={key} value={key}>
              {config.info}
            </option>
          ))}
        </Select>
        <Box sx={{ color: 'secondary', mt: 1 }}>{datasetModule.sourceInfo}</Box>
      </Box>

      <ActiveDatasetControls
        state={datasetState as any}
        setState={setActiveDatasetState as any}
      />

      <Divider sx={{ mt: 4, mb: 3 }} />

      <Row columns={[4, 4, 4, 4]} sx={{ rowGap: 3 }}>
        <Column start={1} width={4}>
          <Box sx={headingSx}>Display</Box>
        </Column>
      </Row>

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
        <Column start={1} width={1}>
          <Box sx={subheadingSx}>Colormap</Box>
        </Column>
        <Column start={2} width={3}>
          <Select
            value={colormap}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setColormap(e.target.value)
            }
            size='xs'
          >
            {colormaps.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Column>
      </Row>

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
        <Column start={1} width={1}>
          <Box sx={subheadingSx}>Range</Box>
        </Column>
        <Column start={2} width={3}>
          <Colorbar
            width='100%'
            colormap={themedColormap}
            units=''
            clim={clim}
            setClim={handleClimChange}
            horizontal
          />
        </Column>
      </Row>

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
        <Column start={1} width={1}>
          <Box sx={subheadingSx}>Opacity</Box>
        </Column>

        <Column start={2} width={3}>
          <Flex>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={opacity}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setOpacity(parseFloat(e.target.value))
              }
            />
          </Flex>
        </Column>
      </Row>

      <Divider sx={{ mt: 4, mb: 3 }} />

      <Box sx={headingSx}>Map</Box>

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
        <Column start={1} width={1} sx={subheadingSx}>
          provider
        </Column>
        <Column start={2} width={3}>
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
        </Column>
      </Row>

      <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline' }}>
        <Column start={1} width={1} sx={subheadingSx}>
          Projection
        </Column>
        <Column start={2} width={3}>
          <Filter
            values={{ globe: globeProjection, mercator: !globeProjection }}
            setValues={(obj: Record<string, boolean>) => {
              if (obj.mercator) setGlobeProjection(false)
              if (obj.globe) setGlobeProjection(true)
            }}
          />
        </Column>
      </Row>
    </Box>
  )
}

export default Controls
