import { useRef, useEffect } from 'react'
import { Box } from 'theme-ui'
// @ts-expect-error - carbonplan layouts types not available
import { Sidebar } from '@carbonplan/layouts'
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
          <Controls />
        </div>
      </Sidebar>
    </Box>
  )
}

export default SidebarComponent
