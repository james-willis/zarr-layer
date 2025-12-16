import React from 'react'
import type { Dataset, DatasetConfig, ControlsProps } from './types'
import { Slider } from '../components/shared-controls'

type TimeState = { time: number }

type TimeDatasetConfig = DatasetConfig & {
  maxTime?: number
  timeSelectorType?: 'index' | 'value'
}

export const createTimeDataset = ({
  maxTime = 10,
  timeSelectorType = 'value',
  ...config
}: TimeDatasetConfig): Dataset<TimeState> => ({
  ...config,
  defaultState: { time: 0 },
  Controls: ({ state, setState }: ControlsProps<TimeState>) => (
    <Slider
      value={state.time}
      onChange={(v) => setState({ time: v })}
      max={maxTime}
      label='Time'
    />
  ),
  buildLayerProps: (state) => ({
    selector:
      timeSelectorType === 'index'
        ? { time: { selected: state.time, type: 'index' } }
        : { time: state.time },
  }),
})
