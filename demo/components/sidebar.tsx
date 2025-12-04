import { useRef, useEffect } from 'react'
import { Box } from 'theme-ui'
// @ts-expect-error - carbonplan layouts types not available
import { Sidebar } from '@carbonplan/layouts'
import Controls from './controls'
import { DatasetConfig } from '../lib/constants'
import { MapProvider } from './map-shared'

interface SidebarProps {
  onSidebarWidthChange: (width: number) => void
  datasetId: string
  setDatasetId: (id: string) => void
  opacity: number
  setOpacity: (opacity: number) => void
  clim: [number, number]
  setClim: (clim: [number, number]) => void
  colormap: string
  setColormap: (colormap: string) => void
  time: number
  setTime: (time: number) => void
  band: string
  setBand: (band: string) => void
  month: number
  setMonth: (month: number) => void
  precipWeight: number
  setPrecipWeight: (weight: number) => void
  globeProjection: boolean
  setGlobeProjection: (globeProjection: boolean) => void
  mapProvider: MapProvider
  setMapProvider: (provider: MapProvider) => void
  dataset: DatasetConfig
}

const SidebarComponent = ({
  onSidebarWidthChange,
  ...controlsProps
}: SidebarProps) => {
  const sidebarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const updateSidebarWidth = () => {
      if (sidebarRef.current) {
        const width =
          sidebarRef.current.parentElement?.parentElement?.offsetWidth ?? 0
        onSidebarWidthChange(width)
      }
    }
    updateSidebarWidth()
    window.addEventListener('resize', updateSidebarWidth)
    return () => {
      window.removeEventListener('resize', updateSidebarWidth)
      onSidebarWidthChange(0)
    }
  }, [onSidebarWidthChange])

  return (
    <Box sx={{ display: ['none', 'none', 'block'] }}>
      <Sidebar expanded={true} side='left' width={4}>
        <div ref={sidebarRef}>
          <Box
            as='h1'
            sx={{
              fontSize: [4],
              fontFamily: 'heading',
              letterSpacing: 'heading',
              lineHeight: 'heading',
              mb: 3,
            }}
          >
            @carbonplan/zarr-layer demo
          </Box>
          <Controls {...controlsProps} />
        </div>
      </Sidebar>
    </Box>
  )
}

export default SidebarComponent
