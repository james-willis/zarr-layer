import React from 'react'
import { DatasetControlsProps, DatasetModule, BuildLayerResult } from './types'
import { Slider, BandSelector } from '../components/shared-controls'
import { useAppStore } from '../lib/store'

const VARIABLE_OPTIONS = ['surface_pressure', 'velocity'] as const

type VariableOption = (typeof VARIABLE_OPTIONS)[number]

// surface_pressure is 3D (time, lat, lon), others are 4D (time, level, lat, lon)
const is4DVariable = (variable: VariableOption) =>
  variable !== 'surface_pressure'

type HurricaneState = {
  variable: VariableOption
  time: number
  level: number
}

const HurricaneControls = ({
  state,
  setState,
}: DatasetControlsProps<HurricaneState>) => {
  const setClim = useAppStore((s) => s.setClim)
  const setColormap = useAppStore((s) => s.setColormap)

  const handleVariableChange = (variable: VariableOption) => {
    setState({ variable })
    if (variable === 'surface_pressure') {
      setClim([100000, 102500])
      setColormap('cool')
    } else {
      setClim([0, 50])
      setColormap('warm')
    }
  }

  return (
    <>
      <BandSelector
        value={state.variable}
        options={VARIABLE_OPTIONS}
        onChange={handleVariableChange}
        label='Variable'
      />
      <Slider
        value={state.time}
        onChange={(v) => setState({ time: v })}
        min={0}
        max={95}
        label='Time'
      />
      {is4DVariable(state.variable) && (
        <Slider
          value={state.level}
          onChange={(v) => setState({ level: v })}
          min={0}
          max={36}
          label='Level'
        />
      )}
    </>
  )
}

const buildLayerProps = ({
  state,
}: {
  state: HurricaneState
}): BuildLayerResult => {
  if (is4DVariable(state.variable)) {
    return {
      selector: {
        time: { selected: state.time, type: 'index' as const },
        level: { selected: state.level, type: 'index' as const },
      },
      variable: state.variable,
    }
  }

  return {
    selector: {
      time: { selected: state.time, type: 'index' as const },
    },
    variable: state.variable,
  }
}

const hurricaneDataset: DatasetModule<HurricaneState> = {
  id: 'hurricane_florence',
  source: 'https://atlantis-vis-o.s3-ext.jc.rl.ac.uk/hurricanes/era5/florence',
  variable: 'surface_pressure',
  clim: [100000, 102500],
  colormap: 'cool',
  zarrVersion: 3,
  info: 'Hurricane Florence (4D)',
  sourceInfo:
    'Zarr v3 with time and level dimensions. Switch between surface pressure and wind velocity.',
  defaultState: {
    variable: 'surface_pressure',
    time: 0,
    level: 15,
  },
  Controls: HurricaneControls,
  buildLayerProps,
}

export default hurricaneDataset
