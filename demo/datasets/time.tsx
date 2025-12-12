import React from 'react'
import type { Selector } from '@carbonplan/zarr-layer'
import {
  DatasetModule,
  DatasetCommonConfig,
  DatasetControlsProps,
  TimeDatasetState,
  defineDatasetModule,
} from './types'
import { Slider } from '../components/shared-controls'

type TimeDatasetConfig = DatasetCommonConfig & {
  maxTime?: number
  timeSelectorType?: Selector['type']
}

export const createTimeDatasetModule = ({
  maxTime = 10,
  timeSelectorType = 'value',
  ...config
}: TimeDatasetConfig): DatasetModule<TimeDatasetState> => {
  const Controls = ({
    state,
    setState,
  }: DatasetControlsProps<TimeDatasetState>) => (
    <Slider
      value={state.time}
      onChange={(v) => setState({ time: v })}
      max={maxTime}
      label='Time'
    />
  )

  return defineDatasetModule<TimeDatasetState>({
    ...config,
    defaultState: { time: 0 },
    Controls,
    buildLayerProps: ({ state }) => ({
      selector:
        timeSelectorType === 'index'
          ? { time: { selected: state.time, type: 'index' } }
          : { time: state.time },
    }),
  })
}
