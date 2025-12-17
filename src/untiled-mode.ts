/**
 * @module untiled-mode
 *
 * Unified mode for non-tiled Zarr datasets.
 * Handles both single-level datasets and multi-level datasets following
 * the zarr-conventions/multiscales standard. Loads full images at each
 * resolution level (not slippy map tiles) with automatic level selection
 * based on map zoom.
 */

import * as zarr from 'zarrita'
import type {
  ZarrMode,
  RenderContext,
  TileId,
  SingleImageRenderState,
} from './zarr-mode'
import type { QueryGeometry, QueryResult } from './query/types'
import type {
  LoadingStateCallback,
  MapLike,
  NormalizedSelector,
  Selector,
  CRS,
  DimIndicesProps,
  UntiledLevel,
} from './types'
import { ZarrStore } from './zarr-store'
import {
  boundsToMercatorNorm,
  type MercatorBounds,
  type XYLimits,
} from './map-utils'
import { loadDimensionValues, normalizeSelector } from './zarr-utils'
import {
  mustCreateBuffer,
  mustCreateTexture,
  createSubdividedQuad,
} from './webgl-utils'
import { SINGLE_IMAGE_TILE_SUBDIVISIONS } from './constants'
import type { ZarrRenderer } from './zarr-renderer'
import { isGlobeProjection } from './render-utils'
import { renderMapboxTile } from './mapbox-globe-tile-renderer'
import { queryRegionSingleImage } from './query/region-query'
import { mercatorBoundsToPixel } from './query/query-utils'
import { setObjectValues } from './query/selector-utils'

export class UntiledMode implements ZarrMode {
  isMultiscale: boolean = false

  // Data state (single-level mode)
  private data: Float32Array | null = null
  private width: number = 0
  private height: number = 0
  private channels: number = 1

  // WebGL resources
  private texture: WebGLTexture | null = null
  private vertexBuffer: WebGLBuffer | null = null
  private pixCoordBuffer: WebGLBuffer | null = null
  private vertexArr: Float32Array = new Float32Array()
  private pixCoordArr: Float32Array = new Float32Array()
  private currentSubdivisions: number = 0
  private geometryVersion: number = 0
  private dataVersion: number = 0

  // Texture transforms
  private texScale: [number, number] = [1, 1]
  private texOffset: [number, number] = [0, 0]

  // Bounds
  private mercatorBounds: MercatorBounds | null = null

  // Store and metadata
  private zarrStore: ZarrStore
  private variable: string
  private selector: NormalizedSelector
  private invalidate: () => void
  private dimIndices: DimIndicesProps = {}
  private xyLimits: XYLimits | null = null
  private crs: CRS = 'EPSG:4326'
  private zarrArray: zarr.Array<zarr.DataType> | null = null
  private latIsAscending: boolean | null = null

  // Multi-level support
  private levels: UntiledLevel[] = []
  private currentLevelIndex: number = 0

  // Loading state
  private isRemoved: boolean = false
  private loadingCallback: LoadingStateCallback | undefined
  private isLoadingData: boolean = false
  private metadataLoading: boolean = false
  private fetchRequestId: number = 0
  private lastRenderedRequestId: number = 0
  private pendingControllers: Map<number, AbortController> = new Map()
  private lastFetchTime: number = 0
  private throttleTimeout: ReturnType<typeof setTimeout> | null = null
  private throttledFetchPromise: Promise<void> | null = null
  private throttleMs: number

  // Dimension values cache
  private dimensionValues: { [key: string]: Float64Array | number[] } = {}

  // Data processing
  private clim: [number, number] = [0, 1]

  constructor(
    store: ZarrStore,
    variable: string,
    selector: NormalizedSelector,
    invalidate: () => void,
    throttleMs: number = 100
  ) {
    this.zarrStore = store
    this.variable = variable
    this.selector = selector
    this.invalidate = invalidate
    this.throttleMs = throttleMs
  }

  async initialize(): Promise<void> {
    this.metadataLoading = true
    this.emitLoadingState()

    try {
      const desc = this.zarrStore.describe()
      this.dimIndices = desc.dimIndices
      this.crs = desc.crs
      this.xyLimits = desc.xyLimits
      this.latIsAscending = desc.latIsAscending ?? null

      // Check if this is a multi-level dataset
      if (desc.untiledLevels && desc.untiledLevels.length > 0) {
        this.levels = desc.untiledLevels
        this.isMultiscale = true
        await this.loadLevelMetadata()
        // Don't load data yet - defer to update() where we have the actual zoom level
        // This avoids loading low-res then immediately switching to high-res
        this.currentLevelIndex = -1 // Mark as not yet selected
      } else {
        // Single-level dataset - load immediately
        this.isMultiscale = false
        this.zarrArray = await this.zarrStore.getArray()
        this.width = this.zarrArray.shape[this.dimIndices.lon.index]
        this.height = this.zarrArray.shape[this.dimIndices.lat.index]
      }

      if (this.xyLimits) {
        this.mercatorBounds = boundsToMercatorNorm(this.xyLimits, this.crs)
      } else {
        console.warn('UntiledMode: No XY limits found')
      }

      this.updateGeometryForProjection(false)
      this.updateTexTransform()
    } finally {
      this.metadataLoading = false
      this.emitLoadingState()
    }
  }

  private async loadLevelMetadata(): Promise<void> {
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i]
      try {
        const meta = await this.zarrStore.getUntiledLevelMetadata(level.asset)
        level.shape = meta.shape
        level.chunks = meta.chunks
      } catch (err) {
        console.warn(`Failed to load metadata for level ${level.asset}:`, err)
      }
    }
  }

  update(map: MapLike, gl: WebGL2RenderingContext): void {
    if (!this.texture) {
      this.texture = mustCreateTexture(gl)
    }
    if (!this.vertexBuffer) {
      this.vertexBuffer = mustCreateBuffer(gl)
    }
    if (!this.pixCoordBuffer) {
      this.pixCoordBuffer = mustCreateBuffer(gl)
    }

    const projection = map.getProjection ? map.getProjection() : null
    const isGlobe = isGlobeProjection(projection)
    this.updateGeometryForProjection(isGlobe)

    // For multi-level datasets, select/switch levels based on zoom
    if (this.isMultiscale && this.levels.length > 0) {
      const mapZoom = map.getZoom?.() ?? 0
      const bestLevelIndex = this.selectLevelForZoom(mapZoom)

      // Initial load or level switch needed
      if (this.currentLevelIndex === -1) {
        // First time - load the appropriate level for current zoom
        this.initializeLevel(bestLevelIndex)
        return
      } else if (bestLevelIndex !== this.currentLevelIndex) {
        // Zoom changed enough to warrant level switch
        this.switchToLevel(bestLevelIndex)
        return
      }
    }

    // Fetch data if not already loaded (single-level datasets)
    if (!this.data && !this.isLoadingData) {
      this.fetchData().then(() => {
        this.invalidate()
      })
    }
  }

  private async initializeLevel(levelIndex: number): Promise<void> {
    if (levelIndex < 0 || levelIndex >= this.levels.length) return
    if (this.isLoadingData) return

    const level = this.levels[levelIndex]
    console.log(`Initializing with level ${levelIndex} (${level.asset})`)

    this.currentLevelIndex = levelIndex

    try {
      this.zarrArray = await this.zarrStore.getLevelArray(level.asset)
      this.width = this.zarrArray.shape[this.dimIndices.lon.index]
      this.height = this.zarrArray.shape[this.dimIndices.lat.index]

      await this.fetchData()
      this.invalidate()
    } catch (err) {
      console.error(`Failed to initialize level ${level.asset}:`, err)
    }
  }

  private selectLevelForZoom(mapZoom: number): number {
    if (!this.xyLimits || this.levels.length === 0) return 0

    // Calculate map resolution: at zoom Z, full world is 256 * 2^Z pixels
    const mapPixelsPerWorld = 256 * Math.pow(2, mapZoom)

    // Calculate what fraction of the world the data covers, accounting for CRS
    const dataWidth = this.xyLimits.xMax - this.xyLimits.xMin
    let worldFraction: number
    if (this.crs === 'EPSG:3857') {
      // Web Mercator: full world is ~40,075,016 meters (2 * 20037508.342789244)
      const fullWorldMeters = 2 * 20037508.342789244
      worldFraction = dataWidth / fullWorldMeters
    } else {
      // EPSG:4326: full world is 360 degrees
      worldFraction = dataWidth / 360
    }

    // Build list of levels with their effective resolution (pixels per full world)
    const levelResolutions: Array<{ index: number; effectivePixels: number }> =
      []
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i]
      if (!level.shape) continue
      const lonIndex = this.dimIndices.lon?.index ?? level.shape.length - 1
      // Scale up to what resolution would be if data covered full world
      const effectivePixels = level.shape[lonIndex] / worldFraction
      levelResolutions.push({ index: i, effectivePixels })
    }

    if (levelResolutions.length === 0) return 0

    // Sort by resolution ascending (lowest res first)
    levelResolutions.sort((a, b) => a.effectivePixels - b.effectivePixels)

    // Find the lowest resolution level that still provides sufficient detail
    // (at least 50% of map's pixel density to avoid obvious pixelation)
    const minRequired = mapPixelsPerWorld * 0.5
    for (const { index, effectivePixels } of levelResolutions) {
      if (effectivePixels >= minRequired) {
        return index
      }
    }

    // If no level is sufficient, use the highest resolution available
    return levelResolutions[levelResolutions.length - 1].index
  }

  private async switchToLevel(newLevelIndex: number): Promise<void> {
    if (newLevelIndex === this.currentLevelIndex) return
    if (newLevelIndex < 0 || newLevelIndex >= this.levels.length) return
    if (this.isLoadingData) return // Don't interrupt ongoing load

    const level = this.levels[newLevelIndex]
    console.log(`Switching to level ${newLevelIndex} (${level.asset})`)

    this.currentLevelIndex = newLevelIndex
    // Keep this.data intact - previous level stays visible while loading

    try {
      const newArray = await this.zarrStore.getLevelArray(level.asset)
      const newWidth = newArray.shape[this.dimIndices.lon.index]
      const newHeight = newArray.shape[this.dimIndices.lat.index]

      // Fetch new data into temporary storage
      const result = await this.fetchDataForLevel(newArray, newWidth, newHeight)

      if (result && !this.isRemoved) {
        // Atomic swap - only update state when new data is fully ready
        this.zarrArray = newArray
        this.width = newWidth
        this.height = newHeight
        this.data = result.data
        this.channels = result.channels
        this.dataVersion++
        this.invalidate()
      }
    } catch (err) {
      console.error(`Failed to switch to level ${level.asset}:`, err)
    }
  }

  private async fetchDataForLevel(
    array: zarr.Array<zarr.DataType>,
    width: number,
    height: number
  ): Promise<{ data: Float32Array; channels: number } | null> {
    this.isLoadingData = true
    this.emitLoadingState()

    try {
      const baseSliceArgs: (number | zarr.Slice)[] = new Array(
        array.shape.length
      ).fill(0)

      const multiValueDims: Array<{
        dimIndex: number
        dimName: string
        values: number[]
        labels: (number | string)[]
      }> = []

      const dimNames = Object.keys(this.dimIndices)

      for (const dimName of dimNames) {
        const dimInfo = this.dimIndices[dimName]
        const dimKey = dimName.toLowerCase()

        const isLon =
          dimKey === 'lon' ||
          dimKey === 'x' ||
          dimKey === 'lng' ||
          dimKey.includes('lon')
        const isLat =
          dimKey === 'lat' || dimKey === 'y' || dimKey.includes('lat')

        if (isLon) {
          baseSliceArgs[dimInfo.index] = zarr.slice(0, width)
        } else if (isLat) {
          baseSliceArgs[dimInfo.index] = zarr.slice(0, height)
        } else {
          const selectionSpec =
            this.selector[dimName] ||
            (dimKey.includes('time') ? this.selector['time'] : undefined)
          if (selectionSpec !== undefined) {
            const selectionValue = selectionSpec.selected
            const selectionType = selectionSpec.type

            // Handle multi-value selectors (multiple bands/channels)
            if (Array.isArray(selectionValue) && selectionValue.length > 1) {
              const resolvedIndices: number[] = []
              const labelValues: (number | string)[] = []
              for (const val of selectionValue) {
                const idx = await this.resolveSelectionIndex(
                  dimName,
                  dimInfo,
                  val,
                  selectionType
                )
                resolvedIndices.push(idx)
                labelValues.push(val)
              }
              multiValueDims.push({
                dimIndex: dimInfo.index,
                dimName,
                values: resolvedIndices,
                labels: labelValues,
              })
              baseSliceArgs[dimInfo.index] = resolvedIndices[0]
            } else {
              const primaryValue = Array.isArray(selectionValue)
                ? selectionValue[0]
                : selectionValue
              baseSliceArgs[dimInfo.index] = await this.resolveSelectionIndex(
                dimName,
                dimInfo,
                primaryValue,
                selectionType
              )
            }
          } else {
            baseSliceArgs[dimInfo.index] = 0
          }
        }
      }

      // Build channel combinations from multi-value dimensions
      let channelCombinations: number[][] = [[]]
      for (const { values } of multiValueDims) {
        const next: number[][] = []
        for (const val of values) {
          for (const combo of channelCombinations) {
            next.push([...combo, val])
          }
        }
        channelCombinations = next
      }

      const numChannels = channelCombinations.length || 1

      if (numChannels === 1) {
        const result = (await zarr.get(array, baseSliceArgs)) as {
          data: ArrayLike<number>
        }
        return {
          data: new Float32Array((result.data as Float32Array).buffer),
          channels: 1,
        }
      } else {
        // Multi-channel: fetch each band and pack interleaved
        const packedData = new Float32Array(width * height * numChannels)

        for (let c = 0; c < numChannels; c++) {
          const sliceArgs = [...baseSliceArgs]
          const combo = channelCombinations[c]

          for (let i = 0; i < multiValueDims.length; i++) {
            sliceArgs[multiValueDims[i].dimIndex] = combo[i]
          }

          const bandData = (await zarr.get(array, sliceArgs)) as {
            data: ArrayLike<number>
          }

          const bandArray = new Float32Array(
            (bandData.data as Float32Array).buffer
          )
          for (let pixIdx = 0; pixIdx < width * height; pixIdx++) {
            packedData[pixIdx * numChannels + c] = bandArray[pixIdx]
          }
        }

        return { data: packedData, channels: numChannels }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('Error fetching level data:', err)
      }
      return null
    } finally {
      this.isLoadingData = false
      this.emitLoadingState()
    }
  }

  render(renderer: ZarrRenderer, context: RenderContext): void {
    const singleImageState = this.getSingleImageState()
    if (!singleImageState) return

    const useMapboxGlobe = !!context.mapboxGlobe
    const shaderProgram = renderer.getProgram(
      context.shaderData,
      context.customShaderConfig,
      useMapboxGlobe
    )

    renderer.gl.useProgram(shaderProgram.program)

    renderer.applyCommonUniforms(
      shaderProgram,
      context.colormapTexture,
      context.uniforms,
      context.customShaderConfig,
      context.projectionData,
      context.mapboxGlobe,
      context.matrix,
      false
    )

    const bounds = singleImageState.singleImage.bounds
    if (bounds) {
      if (shaderProgram.isEquirectangularLoc) {
        renderer.gl.uniform1i(
          shaderProgram.isEquirectangularLoc,
          bounds.latMin !== undefined ? 1 : 0
        )
      }
      if (shaderProgram.latMinLoc && bounds.latMin !== undefined) {
        renderer.gl.uniform1f(shaderProgram.latMinLoc, bounds.latMin)
      }
      if (shaderProgram.latMaxLoc && bounds.latMax !== undefined) {
        renderer.gl.uniform1f(shaderProgram.latMaxLoc, bounds.latMax)
      }
    }

    renderer.renderSingleImage(
      shaderProgram,
      context.worldOffsets,
      singleImageState.singleImage,
      singleImageState.vertexArr
    )
  }

  renderToTile(
    renderer: ZarrRenderer,
    tileId: TileId,
    context: RenderContext
  ): boolean {
    return renderMapboxTile({
      renderer,
      mode: this,
      tileId,
      context,
    })
  }

  onProjectionChange(isGlobe: boolean): void {
    this.updateGeometryForProjection(isGlobe)
  }

  getTiledState() {
    return null
  }

  getSingleImageState(): SingleImageRenderState | null {
    if (!this.texture || !this.vertexBuffer || !this.pixCoordBuffer) {
      return null
    }
    return {
      singleImage: {
        data: this.data,
        width: this.width,
        height: this.height,
        channels: this.channels,
        bounds: this.mercatorBounds,
        texture: this.texture,
        vertexBuffer: this.vertexBuffer,
        pixCoordBuffer: this.pixCoordBuffer,
        pixCoordArr: this.pixCoordArr,
        geometryVersion: this.geometryVersion,
        dataVersion: this.dataVersion,
        texScale: this.texScale,
        texOffset: this.texOffset,
        clim: this.clim,
      },
      vertexArr: this.vertexArr,
    }
  }

  dispose(gl: WebGL2RenderingContext): void {
    this.isRemoved = true
    if (this.throttleTimeout) {
      clearTimeout(this.throttleTimeout)
      this.throttleTimeout = null
    }
    this.throttledFetchPromise = null
    // Cancel any pending requests
    for (const controller of this.pendingControllers.values()) {
      controller.abort()
    }
    this.pendingControllers.clear()
    if (this.texture) gl.deleteTexture(this.texture)
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer)
    if (this.pixCoordBuffer) gl.deleteBuffer(this.pixCoordBuffer)
    this.texture = null
    this.vertexBuffer = null
    this.pixCoordBuffer = null
    this.data = null
    this.isLoadingData = false
    this.emitLoadingState()
  }

  setLoadingCallback(callback: LoadingStateCallback | undefined): void {
    this.loadingCallback = callback
  }

  getCRS(): CRS {
    return this.crs
  }

  getXYLimits(): XYLimits | null {
    return this.xyLimits
  }

  getMaxLevelIndex(): number {
    return this.levels.length > 0 ? this.levels.length - 1 : 0
  }

  getLevels(): string[] {
    return this.levels.map((l) => l.asset)
  }

  updateClim(clim: [number, number]): void {
    this.clim = clim
  }

  async setSelector(selector: NormalizedSelector): Promise<void> {
    this.selector = selector
    await this.fetchData()
  }

  private updateGeometryForProjection(isGlobe: boolean) {
    const targetSubdivisions = isGlobe ? SINGLE_IMAGE_TILE_SUBDIVISIONS : 1
    if (this.currentSubdivisions === targetSubdivisions) return

    const subdivided = createSubdividedQuad(targetSubdivisions)
    this.vertexArr = subdivided.vertexArr
    this.pixCoordArr = subdivided.texCoordArr
    this.currentSubdivisions = targetSubdivisions
    this.geometryVersion += 1
    this.invalidate()
  }

  private updateTexTransform() {
    if (this.latIsAscending) {
      this.texScale = [1, -1]
      this.texOffset = [0, 1]
    } else {
      this.texScale = [1, 1]
      this.texOffset = [0, 0]
    }
    this.geometryVersion += 1
  }

  private emitLoadingState(): void {
    if (!this.loadingCallback) return
    this.loadingCallback({
      loading: this.metadataLoading || this.isLoadingData,
      metadata: this.metadataLoading,
      chunks: this.isLoadingData,
    })
  }

  private async fetchData(): Promise<void> {
    if (!this.zarrArray || this.isRemoved) return

    // Throttle: if too soon since last fetch, schedule a trailing fetch
    const now = Date.now()
    const timeSinceLastFetch = now - this.lastFetchTime
    if (this.throttleMs > 0 && timeSinceLastFetch < this.throttleMs) {
      this.isLoadingData = true
      this.emitLoadingState()

      if (!this.throttledFetchPromise) {
        this.throttledFetchPromise = new Promise((resolve) => {
          this.throttleTimeout = setTimeout(() => {
            this.throttleTimeout = null
            this.throttledFetchPromise = null
            this.fetchData().then(resolve)
          }, this.throttleMs - timeSinceLastFetch)
        })
      }
      return this.throttledFetchPromise
    }
    this.lastFetchTime = now

    const requestId = ++this.fetchRequestId
    const controller = new AbortController()
    this.pendingControllers.set(requestId, controller)
    const signal = controller.signal

    this.isLoadingData = true
    this.emitLoadingState()

    try {
      const baseSliceArgs: (number | zarr.Slice)[] = new Array(
        this.zarrArray.shape.length
      ).fill(0)

      const multiValueDims: Array<{
        dimIndex: number
        dimName: string
        values: number[]
        labels: (number | string)[]
      }> = []

      const dimNames = Object.keys(this.dimIndices)

      for (const dimName of dimNames) {
        const dimInfo = this.dimIndices[dimName]
        const dimKey = dimName.toLowerCase()

        const isLon =
          dimKey === 'lon' ||
          dimKey === 'x' ||
          dimKey === 'lng' ||
          dimKey.includes('lon')
        const isLat =
          dimKey === 'lat' || dimKey === 'y' || dimKey.includes('lat')

        if (isLon) {
          baseSliceArgs[dimInfo.index] = zarr.slice(0, this.width)
        } else if (isLat) {
          baseSliceArgs[dimInfo.index] = zarr.slice(0, this.height)
        } else {
          const selectionSpec =
            this.selector[dimName] ||
            (dimKey.includes('time') ? this.selector['time'] : undefined) ||
            (dimKey.includes('lat') ? this.selector['lat'] : undefined) ||
            (dimKey.includes('lon') || dimKey.includes('lng')
              ? this.selector['lon']
              : undefined)
          if (selectionSpec !== undefined) {
            const selectionValue = selectionSpec.selected
            const selectionType = selectionSpec.type

            if (Array.isArray(selectionValue) && selectionValue.length > 1) {
              const resolvedIndices: number[] = []
              const labelValues: (number | string)[] = []
              for (const val of selectionValue) {
                const idx = await this.resolveSelectionIndex(
                  dimName,
                  dimInfo,
                  val,
                  selectionType
                )
                resolvedIndices.push(idx)
                labelValues.push(val)
              }
              multiValueDims.push({
                dimIndex: dimInfo.index,
                dimName,
                values: resolvedIndices,
                labels: labelValues,
              })
              baseSliceArgs[dimInfo.index] = resolvedIndices[0]
            } else {
              const primaryValue = Array.isArray(selectionValue)
                ? selectionValue[0]
                : selectionValue

              baseSliceArgs[dimInfo.index] = await this.resolveSelectionIndex(
                dimName,
                dimInfo,
                primaryValue,
                selectionType
              )
            }
          } else {
            baseSliceArgs[dimInfo.index] = 0
          }
        }
      }

      let channelCombinations: number[][] = [[]]
      let channelLabelCombinations: (number | string)[][] = [[]]
      for (const { values, labels } of multiValueDims) {
        const next: number[][] = []
        const nextLabels: (number | string)[][] = []
        for (let idx = 0; idx < values.length; idx++) {
          const val = values[idx]
          const label = labels[idx]
          for (let c = 0; c < channelCombinations.length; c++) {
            next.push([...channelCombinations[c], val])
            nextLabels.push([...channelLabelCombinations[c], label])
          }
        }
        channelCombinations = next
        channelLabelCombinations = nextLabels
      }

      const numChannels = channelCombinations.length || 1
      this.channels = numChannels

      if (numChannels === 1) {
        const data = (await zarr.get(this.zarrArray, baseSliceArgs, {
          opts: { signal },
        })) as {
          data: ArrayLike<number>
        }
        if (this.isRemoved) return
        if (requestId < this.lastRenderedRequestId) return
        this.lastRenderedRequestId = requestId
        this.cancelOlderRequests(requestId)
        this.data = new Float32Array((data.data as Float32Array).buffer)
        this.dataVersion++
      } else {
        const packedData = new Float32Array(
          this.width * this.height * numChannels
        )

        for (let c = 0; c < numChannels; c++) {
          const sliceArgs = [...baseSliceArgs]
          const combo = channelCombinations[c]

          for (let i = 0; i < multiValueDims.length; i++) {
            sliceArgs[multiValueDims[i].dimIndex] = combo[i]
          }

          const bandData = (await zarr.get(this.zarrArray, sliceArgs, {
            opts: { signal },
          })) as {
            data: ArrayLike<number>
          }
          if (this.isRemoved) return

          const bandArray = new Float32Array(
            (bandData.data as Float32Array).buffer
          )
          for (let pixIdx = 0; pixIdx < this.width * this.height; pixIdx++) {
            packedData[pixIdx * numChannels + c] = bandArray[pixIdx]
          }
        }

        if (requestId < this.lastRenderedRequestId) return
        this.lastRenderedRequestId = requestId
        this.cancelOlderRequests(requestId)
        this.data = packedData
        this.dataVersion++
      }

      this.invalidate()
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('Error fetching data:', err)
      }
    } finally {
      this.pendingControllers.delete(requestId)
      if (requestId === this.fetchRequestId) {
        this.isLoadingData = false
        this.emitLoadingState()
      }
    }
  }

  private cancelOlderRequests(completedRequestId: number) {
    for (const [id, controller] of this.pendingControllers) {
      if (id < completedRequestId) {
        controller.abort()
        this.pendingControllers.delete(id)
      }
    }
  }

  private async resolveSelectionIndex(
    dimName: string,
    dimInfo: {
      index: number
      name: string
      array: zarr.Array<zarr.DataType> | null
    },
    value: number | string | [number, number] | undefined,
    type?: 'index' | 'value'
  ): Promise<number> {
    if (type === 'index') {
      return typeof value === 'number' ? value : 0
    }

    if (!this.zarrStore.root) {
      return typeof value === 'number' ? value : 0
    }

    try {
      const coords = await loadDimensionValues(
        this.dimensionValues,
        null,
        dimInfo,
        this.zarrStore.root,
        this.zarrStore.version
      )
      this.dimensionValues[dimName] = coords

      if (typeof value === 'number' || typeof value === 'string') {
        const coordIdx = (coords as (number | string)[]).indexOf(value)
        if (coordIdx >= 0) return coordIdx
        throw new Error(
          `[ZarrLayer] Selector value '${value}' not found in coordinate array for dimension '${dimName}'. ` +
            `Available values: [${(coords as (number | string)[])
              .slice(0, 10)
              .join(', ')}${coords.length > 10 ? ', ...' : ''}]. ` +
            `Use { selected: <index>, type: 'index' } to select by array index instead.`
        )
      }
    } catch (err) {
      console.debug(`Could not resolve coordinate for '${dimName}':`, err)
    }

    return typeof value === 'number' ? value : 0
  }

  /**
   * Fetch data for a specific selector (used for queries with selector overrides).
   */
  private async fetchDataForSelector(selector: NormalizedSelector): Promise<{
    data: Float32Array
    channels: number
    channelLabels: (string | number)[][]
    multiValueDimNames: string[]
  } | null> {
    if (!this.zarrArray) return null

    try {
      const baseSliceArgs: (number | zarr.Slice)[] = new Array(
        this.zarrArray.shape.length
      ).fill(0)

      const multiValueDims: Array<{
        dimIndex: number
        dimName: string
        values: number[]
        labels: (number | string)[]
      }> = []

      const dimNames = Object.keys(this.dimIndices)

      for (const dimName of dimNames) {
        const dimInfo = this.dimIndices[dimName]
        const dimKey = dimName.toLowerCase()

        const isLon =
          dimKey === 'lon' ||
          dimKey === 'x' ||
          dimKey === 'lng' ||
          dimKey.includes('lon')
        const isLat =
          dimKey === 'lat' || dimKey === 'y' || dimKey.includes('lat')

        if (isLon) {
          baseSliceArgs[dimInfo.index] = zarr.slice(0, this.width)
        } else if (isLat) {
          baseSliceArgs[dimInfo.index] = zarr.slice(0, this.height)
        } else {
          const selectionSpec =
            selector[dimName] ||
            (dimKey.includes('time') ? selector['time'] : undefined) ||
            (dimKey.includes('lat') ? selector['lat'] : undefined) ||
            (dimKey.includes('lon') || dimKey.includes('lng')
              ? selector['lon']
              : undefined)

          if (selectionSpec !== undefined) {
            const selectionValue = selectionSpec.selected
            const selectionType = selectionSpec.type

            if (Array.isArray(selectionValue) && selectionValue.length > 1) {
              const resolvedIndices: number[] = []
              const labelValues: (number | string)[] = []
              for (const val of selectionValue) {
                const idx = await this.resolveSelectionIndex(
                  dimName,
                  dimInfo,
                  val,
                  selectionType
                )
                resolvedIndices.push(idx)
                labelValues.push(val)
              }
              multiValueDims.push({
                dimIndex: dimInfo.index,
                dimName,
                values: resolvedIndices,
                labels: labelValues,
              })
              baseSliceArgs[dimInfo.index] = resolvedIndices[0]
            } else {
              const primaryValue = Array.isArray(selectionValue)
                ? selectionValue[0]
                : selectionValue

              baseSliceArgs[dimInfo.index] = await this.resolveSelectionIndex(
                dimName,
                dimInfo,
                primaryValue,
                selectionType
              )
            }
          } else {
            baseSliceArgs[dimInfo.index] = 0
          }
        }
      }

      let channelCombinations: number[][] = [[]]
      let channelLabelCombinations: (number | string)[][] = [[]]
      for (const { values, labels } of multiValueDims) {
        const next: number[][] = []
        const nextLabels: (number | string)[][] = []
        for (let idx = 0; idx < values.length; idx++) {
          const val = values[idx]
          const label = labels[idx]
          for (let c = 0; c < channelCombinations.length; c++) {
            next.push([...channelCombinations[c], val])
            nextLabels.push([...channelLabelCombinations[c], label])
          }
        }
        channelCombinations = next
        channelLabelCombinations = nextLabels
      }

      const numChannels = channelCombinations.length || 1
      const multiValueDimNames = multiValueDims.map((d) => d.dimName)

      if (numChannels === 1) {
        const result = (await zarr.get(this.zarrArray, baseSliceArgs)) as {
          data: ArrayLike<number>
        }
        return {
          data: new Float32Array((result.data as Float32Array).buffer),
          channels: 1,
          channelLabels: channelLabelCombinations,
          multiValueDimNames,
        }
      } else {
        const packedData = new Float32Array(
          this.width * this.height * numChannels
        )

        for (let c = 0; c < numChannels; c++) {
          const sliceArgs = [...baseSliceArgs]
          const combo = channelCombinations[c]

          for (let i = 0; i < multiValueDims.length; i++) {
            sliceArgs[multiValueDims[i].dimIndex] = combo[i]
          }

          const bandData = (await zarr.get(this.zarrArray, sliceArgs)) as {
            data: ArrayLike<number>
          }

          const bandArray = new Float32Array(
            (bandData.data as Float32Array).buffer
          )
          for (let pixIdx = 0; pixIdx < this.width * this.height; pixIdx++) {
            packedData[pixIdx * numChannels + c] = bandArray[pixIdx]
          }
        }

        return {
          data: packedData,
          channels: numChannels,
          channelLabels: channelLabelCombinations,
          multiValueDimNames,
        }
      }
    } catch (err) {
      console.error('Error fetching data for query selector:', err)
      return null
    }
  }

  /**
   * Query data for point or region geometries.
   */
  async queryData(
    geometry: QueryGeometry,
    selector?: Selector
  ): Promise<QueryResult> {
    if (!this.mercatorBounds) {
      return {
        [this.variable]: [],
        dimensions: [],
        coordinates: { lat: [], lon: [] },
      }
    }

    const normalizedSelector = selector
      ? normalizeSelector(selector)
      : this.selector

    // Always fetch data for the query
    const fetched = await this.fetchDataForSelector(normalizedSelector)
    if (!fetched) {
      return {
        [this.variable]: [],
        dimensions: [],
        coordinates: { lat: [], lon: [] },
      }
    }
    const queryData = fetched.data
    const queryChannels = fetched.channels
    const queryChannelLabels = fetched.channelLabels
    const queryMultiValueDimNames = fetched.multiValueDimNames

    // Point geometries: sample single pixel and return region-shaped result
    if (geometry.type === 'Point') {
      const [lon, lat] = geometry.coordinates
      const coords = { lat: [lat], lon: [lon] }

      const pixel = mercatorBoundsToPixel(
        lon,
        lat,
        this.mercatorBounds,
        this.width,
        this.height,
        this.crs ?? 'EPSG:4326',
        this.latIsAscending ?? undefined
      )

      if (!pixel) {
        return {
          [this.variable]: [],
          dimensions: ['lat', 'lon'],
          coordinates: coords,
        }
      }

      const { x, y } = pixel
      const baseIndex = (y * this.width + x) * queryChannels
      const valuesNested = queryMultiValueDimNames.length > 0
      let values: number[] | Record<string | number, any> = valuesNested
        ? {}
        : []

      const desc = this.zarrStore.describe()
      const { scaleFactor, addOffset, fill_value } = desc

      for (let c = 0; c < queryChannels; c++) {
        let value = queryData[baseIndex + c]

        // Filter invalid values
        if (value === undefined || value === null || !Number.isFinite(value)) {
          continue
        }
        if (fill_value !== null && value === fill_value) {
          continue
        }

        // Apply transforms
        if (scaleFactor !== 1) value *= scaleFactor
        if (addOffset !== 0) value += addOffset

        if (valuesNested) {
          const labels = queryChannelLabels?.[c]
          if (
            labels &&
            queryMultiValueDimNames.length > 0 &&
            labels.length === queryMultiValueDimNames.length
          ) {
            values = setObjectValues(values as any, labels, value) as any
          } else if (Array.isArray(values)) {
            values.push(value)
          }
        } else if (Array.isArray(values)) {
          values.push(value)
        }
      }
      const dimensions = desc.dimensions
      const mappedDimensions = dimensions.map((d) => {
        const dimLower = d.toLowerCase()
        if (['x', 'lon', 'longitude'].includes(dimLower)) return 'lon'
        if (['y', 'lat', 'latitude'].includes(dimLower)) return 'lat'
        return d
      })

      const outputDimensions = valuesNested ? mappedDimensions : ['lat', 'lon']
      const resultCoordinates: {
        lat: number[]
        lon: number[]
        [key: string]: (number | string)[]
      } = {
        lat: coords.lat,
        lon: coords.lon,
      }

      if (valuesNested) {
        const querySelector = normalizedSelector
        for (const dim of dimensions) {
          const dimLower = dim.toLowerCase()
          if (
            ['x', 'lon', 'longitude', 'y', 'lat', 'latitude'].includes(dimLower)
          ) {
            continue
          }
          const selSpec = querySelector[dim]
          if (selSpec && 'selected' in selSpec) {
            const selected = selSpec.selected
            const vals = Array.isArray(selected) ? selected : [selected]
            resultCoordinates[dim] = vals as (number | string)[]
          } else if (desc.coordinates[dim]) {
            resultCoordinates[dim] = desc.coordinates[dim]
          }
        }
      }

      return {
        [this.variable]: values as any,
        dimensions: outputDimensions,
        coordinates: resultCoordinates,
      }
    }

    const desc = this.zarrStore.describe()

    return queryRegionSingleImage(
      this.variable,
      geometry,
      normalizedSelector,
      queryData,
      this.width,
      this.height,
      this.mercatorBounds,
      this.crs ?? 'EPSG:4326',
      desc.dimensions,
      desc.coordinates,
      queryChannels,
      queryChannelLabels,
      queryMultiValueDimNames,
      this.latIsAscending ?? undefined,
      {
        scaleFactor: desc.scaleFactor,
        addOffset: desc.addOffset,
        fillValue: desc.fill_value,
      }
    )
  }
}
