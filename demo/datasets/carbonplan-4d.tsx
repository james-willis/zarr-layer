import React from 'react'
import { Box } from 'theme-ui'
import { BuildLayerResult, DatasetControlsProps, DatasetModule } from './types'
import { useAppStore } from '../lib/store'
import {
  Slider,
  RangeSlider,
  BandSelector,
} from '../components/shared-controls'

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export const combinedBandsCustomFrag = `
  // custom fragment shader w/ uniform example
  uniform float u_precipWeight;
  float combined = prec * u_precipWeight;
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
  float inRange_${month} = step(u_monthStart, ${month.toFixed(1)}) * step(${month.toFixed(1)}, u_monthEnd);
  sum += month_${month} * inRange_${month};
  count += inRange_${month};`,
  ).join('')}
  float average = sum / max(count, 1.0);
  float rescaled = (average - clim.x) / (clim.y - clim.x);
  vec4 c = texture(colormap, vec2(clamp(rescaled, 0.0, 1.0), 0.5));
  fragColor = vec4(c.r, c.g, c.b, opacity);
`

const BAND_OPTIONS = [
  'prec',
  'tavg',
  'tavg_range',
  'prec_range',
  'weighted',
] as const

type Carbonplan4dState = {
  band: 'prec' | 'tavg' | 'tavg_range' | 'prec_range' | 'weighted'
  month: number
  monthStart: number
  monthEnd: number
  precipWeight: number
}
const buildLayerProps = ({ state }: { state: Carbonplan4dState }) => {
  const isCombined = state.band === 'weighted'
  const isRangeAverage =
    state.band === 'tavg_range' || state.band === 'prec_range'
  let baseRangeBand: 'prec' | 'tavg' | null = null
  if (isRangeAverage) {
    baseRangeBand = state.band.startsWith('prec') ? 'prec' : 'tavg'
  } else {
    baseRangeBand = null
  }

  let selector: BuildLayerResult['selector']
  if (isCombined) {
    selector = { band: ['tavg', 'prec'], month: state.month }
  } else if (isRangeAverage && baseRangeBand) {
    selector = { band: baseRangeBand, month: ALL_MONTHS }
  } else {
    selector = { band: state.band, month: state.month }
  }

  const result: BuildLayerResult = {
    selector,
  }

  if (isCombined) {
    result.customFrag = combinedBandsCustomFrag
    result.uniforms = { u_precipWeight: state.precipWeight }
  } else if (isRangeAverage) {
    result.customFrag = monthRangeAverageFrag
    result.uniforms = {
      u_monthStart: state.monthStart,
      u_monthEnd: state.monthEnd,
    }
  }

  return result
}

const Carbonplan4dControls = ({
  state,
  setState,
}: DatasetControlsProps<Carbonplan4dState>) => {
  const setColormap = useAppStore((state) => state.setColormap)
  const setClim = useAppStore((state) => state.setClim)

  const handleBandChange = (band: Carbonplan4dState['band']) => {
    setState({ band })
    if (band === 'prec' || band === 'prec_range' || band === 'weighted') {
      setColormap('cool')
      setClim([0, 300])
    } else {
      setColormap('warm')
      setClim([-20, 30])
    }
  }

  const isRangeAverage =
    state.band === 'tavg_range' || state.band === 'prec_range'

  return (
    <>
      <BandSelector
        value={state.band}
        options={BAND_OPTIONS}
        onChange={handleBandChange}
        label='Selector'
      />

      {state.band === 'weighted' && (
        <Box
          as='code'
          sx={{
            fontSize: 0,
            color: 'secondary',
            whiteSpace: 'pre-wrap',
            display: 'block',
            mb: 3,
          }}
        >
          {combinedBandsCustomFrag}
        </Box>
      )}

      {isRangeAverage && (
        <Box
          as='code'
          sx={{
            fontSize: 0,
            color: 'secondary',
            whiteSpace: 'pre-wrap',
            display: 'block',
            mb: 3,
          }}
        >
          {monthRangeAverageFrag.slice(0, 250)}
        </Box>
      )}

      {isRangeAverage ? (
        <RangeSlider
          startValue={state.monthStart}
          endValue={state.monthEnd}
          onStartChange={(v) => setState({ monthStart: v })}
          onEndChange={(v) => setState({ monthEnd: v })}
          min={1}
          max={12}
          label='Month range'
        />
      ) : (
        <Slider
          value={state.month}
          onChange={(v) => setState({ month: v })}
          min={1}
          max={12}
          label='Month'
        />
      )}

      {state.band === 'weighted' && (
        <Slider
          value={state.precipWeight}
          onChange={(v) => setState({ precipWeight: v })}
          min={0}
          max={5}
          step={0.1}
          label='Precip weight'
        />
      )}
    </>
  )
}

const carbonplan4dDataset: DatasetModule<Carbonplan4dState> = {
  id: 'carbonplan_4d',
  source:
    'https://carbonplan-maps.s3.us-west-2.amazonaws.com/v2/demo/4d/tavg-prec-month',
  variable: 'climate',
  clim: [0, 300],
  colormap: 'cool',
  zarrVersion: 2,
  info: '4d pyramid, temp/precip by month',
  sourceInfo:
    'Zarr v2 pyramid. Select different bands for demonstrations of custom fragment shaders and uniform variables.',
  spatialDimensions: {
    lat: 'y',
    lon: 'x',
  },
  defaultState: {
    band: 'prec',
    month: 1,
    monthStart: 1,
    monthEnd: 6,
    precipWeight: 1.0,
  },
  Controls: Carbonplan4dControls,
  buildLayerProps,
}

export default carbonplan4dDataset
