import React from 'react'
import { Box, Container } from 'theme-ui'
// @ts-expect-error - carbonplan components types not available
import { Dimmer, Header } from '@carbonplan/components'
import { Map } from '../components/map-shared'
import Sidebar from '../components/sidebar'
import { useAppStore } from '../lib/store'

export default function Home() {
  const mapProvider = useAppStore((state) => state.mapProvider)

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
          width: '100vw',
        }}
      >
        <Sidebar />
        <Map key={mapProvider} />
      </Box>
    </>
  )
}
