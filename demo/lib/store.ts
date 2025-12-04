import { create } from 'zustand'
import {
  DATASET_MODULES,
  DEFAULT_DATASET_ID,
  DatasetId,
  DatasetModuleMap,
  DatasetStateMap,
  AnyDatasetModule,
} from './constants'
import { MapProvider } from '../components/map-shared'

type DatasetStateStore = {
  [K in DatasetId]?: Partial<DatasetStateMap[K]>
}

interface AppState {
  sidebarWidth: number
  datasetId: DatasetId
  opacity: number
  clim: [number, number]
  colormap: string
  globeProjection: boolean
  mapProvider: MapProvider
  datasetState: DatasetStateStore
  setSidebarWidth: (width: number) => void
  setDatasetId: (id: DatasetId) => void
  setOpacity: (opacity: number) => void
  setClim: (clim: [number, number]) => void
  setColormap: (colormap: string) => void
  setGlobeProjection: (globeProjection: boolean) => void
  setMapProvider: (provider: MapProvider) => void
  setDatasetState: <K extends DatasetId>(
    id: K,
    updates: Partial<DatasetStateMap[K]>
  ) => void
  setActiveDatasetState: (updates: Partial<DatasetStateMap[DatasetId]>) => void
  getDatasetModule: () => DatasetModuleMap[DatasetId]
  getDatasetState: () => DatasetStateMap[DatasetId]
}

export const useAppStore = create<AppState>((set, get) => ({
  sidebarWidth: 0,
  datasetId: DEFAULT_DATASET_ID,
  opacity: 1,
  clim: DATASET_MODULES[DEFAULT_DATASET_ID].clim,
  colormap: DATASET_MODULES[DEFAULT_DATASET_ID].colormap,
  globeProjection: true,
  mapProvider: 'maplibre',
  datasetState: {
    [DEFAULT_DATASET_ID]: {
      ...DATASET_MODULES[DEFAULT_DATASET_ID].defaultState,
    },
  },
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setDatasetId: (id) => {
    const module = DATASET_MODULES[id]
    if (!module) return

    set((state) => ({
      datasetId: id,
      clim: module.clim,
      colormap: module.colormap,
      datasetState: {
        ...state.datasetState,
        [id]: state.datasetState[id] ?? module.defaultState,
      },
    }))
  },
  setOpacity: (opacity) => set({ opacity }),
  setClim: (clim) => set({ clim }),
  setColormap: (colormap) => set({ colormap }),
  setGlobeProjection: (globeProjection) => set({ globeProjection }),
  setMapProvider: (mapProvider) => set({ mapProvider }),
  setDatasetState: (id, updates) =>
    set((state): Partial<AppState> => {
      const module = DATASET_MODULES[id]
      const current = state.datasetState[id] ?? module?.defaultState
      const nextDatasetState: DatasetStateStore = {
        ...state.datasetState,
        [id]: { ...(current ?? {}), ...updates } as DatasetStateStore[typeof id],
      }
      return { datasetState: nextDatasetState }
    }),
  setActiveDatasetState: (updates) => {
    const activeId = get().datasetId
    get().setDatasetState(activeId, updates)
  },
  getDatasetModule: () => DATASET_MODULES[get().datasetId],
  getDatasetState: () => {
    const id = get().datasetId
    const module = DATASET_MODULES[id]
    const stored = get().datasetState[id]
    return (stored ?? module.defaultState) as DatasetStateMap[DatasetId]
  },
}))
