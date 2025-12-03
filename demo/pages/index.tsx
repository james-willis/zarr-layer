import React, { useState } from 'react'
import { Box, Container, useThemeUI } from 'theme-ui'
// @ts-expect-error - carbonplan components types not available
import { Header, Dimmer } from '@carbonplan/components'
import Map from '../components/map'
import Sidebar from '../components/sidebar'
import { DATASETS } from '../lib/constants'

export default function Home() {
  const { theme } = useThemeUI()
  const [sidebarWidth, setSidebarWidth] = useState(0)

  const [datasetId, setDatasetId] = useState('salinity_v2')
  const [opacity, setOpacity] = useState(0.7)
  const [clim, setClim] = useState<[number, number]>([30, 37])
  const [colormap, setColormap] = useState('warm')
  const [time, setTime] = useState(0)
  const [band, setBand] = useState('0')
  const [month, setMonth] = useState(0)
  const [precipWeight, setPrecipWeight] = useState(1.0)
  const [globeProjection, setGlobeProjection] = useState(true)

  const dataset = DATASETS[datasetId]

  return (
    <>
      <Container>
        <Box sx={{ position: 'relative', zIndex: 2000 }}>
          <Header
            menuItems={[
              <Dimmer key='dimmer' sx={{ mt: '-2px', color: 'primary' }} />,
            ]}
          />
        </Box>
      </Container>
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: '100%',
          overflowX: 'hidden',
          scrollbarColor: `${theme?.colors?.hinted} ${theme?.colors?.background}`,
        }}
      >
        <Map
          sidebarWidth={sidebarWidth}
          datasetId={datasetId}
          dataset={dataset}
          opacity={opacity}
          clim={clim}
          colormap={colormap}
          time={time}
          band={band}
          month={month}
          precipWeight={precipWeight}
          globeProjection={globeProjection}
        />
        <Sidebar
          onSidebarWidthChange={setSidebarWidth}
          datasetId={datasetId}
          setDatasetId={setDatasetId}
          opacity={opacity}
          setOpacity={setOpacity}
          clim={clim}
          setClim={setClim}
          colormap={colormap}
          setColormap={setColormap}
          time={time}
          setTime={setTime}
          band={band}
          setBand={setBand}
          month={month}
          setMonth={setMonth}
          precipWeight={precipWeight}
          setPrecipWeight={setPrecipWeight}
          globeProjection={globeProjection}
          setGlobeProjection={setGlobeProjection}
          dataset={dataset}
        />
      </Box>
    </>
  )
}
