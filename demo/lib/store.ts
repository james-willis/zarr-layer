import { create } from 'zustand'
import { DATASETS, DatasetConfig } from './constants'
import { MapProvider } from '../components/map-shared'

interface AppState {
  sidebarWidth: number
  datasetId: string
  opacity: number
  clim: [number, number]
  colormap: string
  time: number
  band: string
  month: number
  precipWeight: number
  globeProjection: boolean
  mapProvider: MapProvider
  setSidebarWidth: (width: number) => void
  setDatasetId: (id: string) => void
  setOpacity: (opacity: number) => void
  setClim: (clim: [number, number]) => void
  setColormap: (colormap: string) => void
  setTime: (time: number) => void
  setBand: (band: string) => void
  setMonth: (month: number) => void
  setPrecipWeight: (weight: number) => void
  setGlobeProjection: (globeProjection: boolean) => void
  setMapProvider: (provider: MapProvider) => void
  getDataset: () => DatasetConfig
}

export const useAppStore = create<AppState>((set, get) => ({
  sidebarWidth: 0,
  datasetId: 'salinity_v2',
  opacity: 1,
  clim: [30, 37],
  colormap: 'warm',
  time: 0,
  band: 'tavg',
  month: 1,
  precipWeight: 1.0,
  globeProjection: true,
  mapProvider: 'maplibre',
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setDatasetId: (id) => {
    const config = DATASETS[id]
    const updates: Partial<AppState> = {
      datasetId: id,
      clim: config.clim,
      colormap: config.colormap,
    }
    if (config.has4D) {
      updates.band = 'tavg'
      updates.month = 1
    } else {
      updates.time = 0
    }
    set(updates)
  },
  setOpacity: (opacity) => set({ opacity }),
  setClim: (clim) => set({ clim }),
  setColormap: (colormap) => set({ colormap }),
  setTime: (time) => set({ time }),
  setBand: (band) => set({ band }),
  setMonth: (month) => set({ month }),
  setPrecipWeight: (precipWeight) => set({ precipWeight }),
  setGlobeProjection: (globeProjection) => set({ globeProjection }),
  setMapProvider: (mapProvider) => set({ mapProvider }),
  getDataset: () => DATASETS[get().datasetId],
}))
