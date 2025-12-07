import { useRef, useEffect } from 'react'
import { Box, Divider } from 'theme-ui'
// @ts-expect-error - carbonplan layouts types not available
import { Sidebar } from '@carbonplan/layouts'
// @ts-expect-error - carbonplan components types not available
import { Link } from '@carbonplan/components'
import Controls from './controls'
import { useAppStore } from '../lib/store'

const SidebarComponent = () => {
  const sidebarRef = useRef<HTMLDivElement>(null)
  const setSidebarWidth = useAppStore((state) => state.setSidebarWidth)

  useEffect(() => {
    const updateSidebarWidth = () => {
      if (sidebarRef.current) {
        const width =
          sidebarRef.current.parentElement?.parentElement?.offsetWidth ?? 0
        setSidebarWidth(width)
      }
    }
    updateSidebarWidth()
    window.addEventListener('resize', updateSidebarWidth)
    return () => {
      window.removeEventListener('resize', updateSidebarWidth)
      setSidebarWidth(0)
    }
  }, [setSidebarWidth])

  return (
    <Sidebar expanded={true} side='left' width={4}>
      <div ref={sidebarRef}>
        <Box
          as='h1'
          sx={{
            fontSize: [4],
            fontFamily: 'heading',
            letterSpacing: 'heading',
            lineHeight: 'heading',
          }}
        >
          @carbonplan/zarr-layer
        </Box>
        <Box sx={{ color: 'secondary', my: 1 }}>
          Flexible zarr rendering for MapLibre/Mapbox.{' '}
          <Link
            href='https://github.com/carbonplan/zarr-layer'
            target='_blank'
            sx={{ color: 'secondary' }}
          >
            GitHub
          </Link>
        </Box>
        <Divider sx={{ my: 3 }} />
        <Controls />
      </div>
    </Sidebar>
  )
}

export default SidebarComponent
