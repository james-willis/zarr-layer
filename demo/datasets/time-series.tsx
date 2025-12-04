import React from 'react'
// @ts-expect-error - carbonplan components types not available
import { Slider } from '@carbonplan/components'
import { Box } from 'theme-ui'
import {
  DatasetModule,
  DatasetCommonConfig,
  DatasetControlsProps,
  TimeDatasetState,
  defineDatasetModule,
} from './types'

type TimeDatasetConfig = DatasetCommonConfig & { maxTime?: number }

const TimeControls = ({
  state,
  setState,
  max,
}: DatasetControlsProps<TimeDatasetState> & { max: number }) => {
  return (
    <Box>
      Time Index: {state.time}
      <Slider
        min={0}
        max={max}
        step={1}
        value={state.time}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          setState({ time: parseInt(e.target.value) })
        }
      />
    </Box>
  )
}

export const createTimeDatasetModule = ({
  maxTime = 10,
  ...config
}: TimeDatasetConfig): DatasetModule<TimeDatasetState> => {
  const Controls = (props: DatasetControlsProps<TimeDatasetState>) => (
    <TimeControls {...props} max={maxTime} />
  )

  return defineDatasetModule<TimeDatasetState>({
    ...config,
    defaultState: { time: 0 },
    Controls,
    buildLayerProps: ({ state }) => ({
      selector: { time: state.time },
    }),
  })
}
