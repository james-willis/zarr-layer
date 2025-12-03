import React, { useRef, useEffect } from 'react'
import { Box } from 'theme-ui'
// @ts-expect-error - carbonplan layouts types not available
import { Sidebar, SidebarDivider } from '@carbonplan/layouts'
import Controls from './controls'
import { DatasetConfig } from '../lib/constants'

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
  dataset: DatasetConfig
}

const SidebarComponent = ({ onSidebarWidthChange, ...controlsProps }: SidebarProps) => {
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
    // Small timeout to allow layout to settle
    setTimeout(updateSidebarWidth, 100)
    
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
          <Box sx={{ fontSize: 4, fontFamily: 'heading', mb: 4 }}>
            Zarr MapLibre
          </Box>
          <Box sx={{ mb: 4, fontSize: 1 }}>
            This demonstrates rendering Zarr datasets using MapLibre GL JS and
            zarr-maplibre.
          </Box>
          <SidebarDivider sx={{ my: 4 }} />
          <Controls {...controlsProps} />
        </div>
      </Sidebar>
    </Box>
  )
}

export default SidebarComponent

