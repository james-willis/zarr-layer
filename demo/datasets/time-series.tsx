import React from 'react'
// @ts-expect-error - carbonplan components types not available
import { Slider, Row, Column } from '@carbonplan/components'
import { Box, Flex } from 'theme-ui'
import {
  DatasetModule,
  DatasetCommonConfig,
  DatasetControlsProps,
  TimeDatasetState,
  defineDatasetModule,
} from './types'

const subheadingSx = {
  mt: 3,
  mb: 1,
  fontFamily: 'mono',
  letterSpacing: 'smallcaps',
  textTransform: 'uppercase' as const,
  fontSize: [1, 1, 1, 2],
  color: 'secondary',
}

type TimeDatasetConfig = DatasetCommonConfig & { maxTime?: number }

const TimeControls = ({
  state,
  setState,
  max,
}: DatasetControlsProps<TimeDatasetState> & { max: number }) => {
  const labelSx = {
    fontFamily: 'mono',
    letterSpacing: 'smallcaps',
    textTransform: 'uppercase' as const,
    fontSize: [1, 1, 1, 2],
    color: 'secondary',
    mb: 2,
  }

  return (
    <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline', mt: 2 }}>
      <Column start={1} width={1}>
        <Box sx={subheadingSx}>Time</Box>
      </Column>
      <Column start={2} width={3}>
        <Flex sx={{ flexDirection: 'column' }}>
          <Slider
            min={0}
            max={max}
            step={1}
            value={state.time}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setState({ time: parseInt(e.target.value) })
            }
          />
          <Box sx={{ textAlign: 'center' }}>{state.time}</Box>
        </Flex>
      </Column>
    </Row>

    // <Box>
    //   <Box sx={labelSx}>Time index</Box>
    //   <Flex>
    //     <Slider
    //       min={0}
    //       max={max}
    //       step={1}
    //       value={state.time}
    //       onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
    //         setState({ time: parseInt(e.target.value) })
    //       }
    //     />
    //   </Flex>
    // </Box>
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
