/**
 * @module mapbox-globe-tile-renderer
 *
 * Specialized rendering for Mapbox GL JS globe tile API (renderToTile).
 * This is fundamentally different from MapLibre's globe which uses projectTile().
 *
 * Mapbox's renderToTile() asks the custom layer to render individual tiles
 * to offscreen textures, requiring:
 * - Tile-specific transformation matrix (not camera matrix)
 * - For EPSG:4326 data: fragment shader reprojection (Mercator → latitude for texture lookup)
 */

import {
  findBestParentTile,
  findBestChildTiles,
  get4326TileGeoBounds,
  tileToKey,
  latToMercatorNorm,
  lonToMercatorNorm,
  mercatorNormToLon,
  mercatorNormToLat,
  parseLevelZoom,
  type TileTuple,
  type XYLimits,
} from './map-utils'
import type { ZarrRenderer, ShaderProgram } from './zarr-renderer'
import type {
  ZarrMode,
  RenderContext,
  TileId,
  RegionRenderState,
} from './zarr-mode'
import { setupBandTextureUniforms } from './render-helpers'
import { renderRegion, type RenderableRegion } from './renderable-region'
import {
  MAPBOX_GLOBE_IDENTITY_MATRIX,
  createMapboxTileMatrix,
  getMapboxTileBounds,
  boundsIntersect,
} from './mapbox-globe-utils'

// ============================================================================
// Main Rendering Functions
// ============================================================================

interface MapboxTileRenderParams {
  renderer: ZarrRenderer
  mode: ZarrMode
  tileId: TileId
  context: RenderContext
  /** Regions to render (for untiled/region-based modes) */
  regions?: RegionRenderState[]
}

/**
 * Renders Zarr data to a Mapbox globe tile.
 *
 * This is the main entry point for globe tile rendering. It handles:
 * - Single image (non-tiled) data: Renders the portion of the image that
 *   intersects the requested tile
 * - Tiled pyramid data: Finds and renders the appropriate Zarr tiles that
 *   overlap the Mapbox tile
 *
 * @param params - Render parameters including renderer, mode, tile ID, and context
 * @returns true if more data is needed (tile data not yet loaded), false otherwise
 */
export function renderMapboxTile({
  renderer,
  mode,
  tileId,
  context,
  regions,
}: MapboxTileRenderParams): boolean {
  // Handle region-based loading (UntiledMode - both single-level and multi-level)
  if (regions) {
    return renderRegionsToTile(renderer, tileId, context, regions)
  }

  // Handle tiled (pyramid) data
  return renderTiledToTile(renderer, mode, tileId, context)
}

/**
 * Render untiled regions to a globe tile.
 */
function renderRegionsToTile(
  renderer: ZarrRenderer,
  tileId: TileId,
  context: RenderContext,
  regions: RegionRenderState[]
): boolean {
  if (regions.length === 0) return true // Still loading

  const tileBounds = getMapboxTileBounds(tileId)

  // Convert tile bounds to WGS84 for intersection with wgs84Bounds regions
  // Tile bounds are in normalized Mercator [0,1], convert to normalized WGS84 [0,1]
  const tileWgs84Bounds = {
    lon0: tileBounds.x0, // lon is same in both spaces (just x)
    lon1: tileBounds.x1,
    // Mercator Y needs conversion: y0 is north (smaller lat), y1 is south (larger lat)
    // In normalized WGS84: lat0 is south, lat1 is north
    lat0: (mercatorNormToLat(tileBounds.y1) + 90) / 180, // south edge
    lat1: (mercatorNormToLat(tileBounds.y0) + 90) / 180, // north edge
  }

  const tileMatrix = createMapboxTileMatrix(
    tileBounds.x0,
    tileBounds.y0,
    tileBounds.x1,
    tileBounds.y1
  )

  const { colormapTexture, uniforms, customShaderConfig } = context

  // Check if any region uses WGS84 (proj4 datasets or EPSG:4326)
  const useWgs84 = regions.some((r) => !!r.wgs84Bounds)

  const shaderProgram = renderer.getProgram(
    context.shaderData,
    customShaderConfig,
    true, // useMapboxGlobe
    useWgs84
  )
  renderer.gl.useProgram(shaderProgram.program)
  renderer.applyCommonUniforms(
    shaderProgram,
    colormapTexture,
    uniforms,
    customShaderConfig,
    context.projectionData,
    {
      projection: { name: 'globe' },
      globeToMercatorMatrix: MAPBOX_GLOBE_IDENTITY_MATRIX,
      transition: 0,
    },
    tileMatrix,
    true
  )

  setupBandTextureUniforms(renderer.gl, shaderProgram, customShaderConfig)

  let needsMoreData = false
  for (const region of regions) {
    // For regions with wgs84Bounds, do intersection in WGS84 space
    // This avoids the Mercator/WGS84 coordinate mismatch at low zoom
    let intersects: boolean
    if (region.wgs84Bounds) {
      const w = region.wgs84Bounds
      intersects =
        w.lon0 < tileWgs84Bounds.lon1 &&
        w.lon1 > tileWgs84Bounds.lon0 &&
        w.lat0 < tileWgs84Bounds.lat1 &&
        w.lat1 > tileWgs84Bounds.lat0
    } else {
      intersects = boundsIntersect(region.mercatorBounds, tileBounds)
    }
    if (!intersects) continue

    // For proj4 datasets: use indexed mesh with wgs84Bounds
    // For EPSG:4326: use subdivided quad (not indexed) with wgs84Bounds
    // Both use the mapbox-globe-wgs84 shader to convert WGS84 → Mercator
    const useIndexedMesh = !!region.useIndexedMesh && !!region.indexBuffer

    const renderable: RenderableRegion = {
      mercatorBounds: region.mercatorBounds,
      vertexBuffer: region.vertexBuffer,
      pixCoordBuffer: region.pixCoordBuffer,
      vertexCount: useIndexedMesh
        ? region.vertexCount ?? region.vertexArr.length / 2
        : region.vertexArr.length / 2,
      texture: region.texture,
      bandData: region.bandData ?? new Map(),
      bandTextures: region.bandTextures ?? new Map(),
      bandTexturesUploaded: region.bandTexturesUploaded ?? new Set(),
      bandTexturesConfigured: region.bandTexturesConfigured ?? new Set(),
      width: region.width,
      height: region.height,
      // Include indexed mesh fields for proj4 datasets
      indexBuffer: useIndexedMesh ? region.indexBuffer : undefined,
      useIndexedMesh: useIndexedMesh,
      // Include wgs84Bounds for both proj4 and EPSG:4326 datasets
      wgs84Bounds: region.wgs84Bounds,
      // Include latIsAscending for fragment shader reprojection (EPSG:4326)
      latIsAscending: region.latIsAscending,
    }

    const rendered = renderRegion(
      renderer.gl,
      shaderProgram,
      renderable,
      [0], // Globe tiles don't need world wrapping
      customShaderConfig
    )
    if (!rendered) {
      // renderRegion returns false when band data is missing
      needsMoreData = true
    }
  }

  // Return true if any region still needs data (triggers re-render when loaded)
  return needsMoreData
}

/**
 * Render tiled pyramid data to a globe tile.
 */
function renderTiledToTile(
  renderer: ZarrRenderer,
  mode: ZarrMode,
  tileId: TileId,
  context: RenderContext
): boolean {
  const tiledState = mode.getTiledState?.()
  if (!tiledState?.tileCache) {
    return true
  }

  const crs = mode.getCRS()
  if (crs === 'EPSG:4326') {
    return render4326TiledToTile(renderer, mode, tileId, context, tiledState)
  }

  return render3857TiledToTile(renderer, mode, tileId, context, tiledState)
}

/**
 * Render EPSG:4326 tiled data to a globe tile.
 * Handles the complex case of mapping 4326 tiles to Mapbox Mercator tiles.
 *
 * IMPORTANT: We use tiledState.visibleTiles (computed by TiledMode from map.getZoom())
 * rather than computing tiles from tileId.z. Mapbox's tileId.z may be overscaled
 * and doesn't match the dataset level that TiledMode fetched.
 */
function render4326TiledToTile(
  renderer: ZarrRenderer,
  mode: ZarrMode,
  tileId: TileId,
  context: RenderContext,
  tiledState: NonNullable<ReturnType<NonNullable<ZarrMode['getTiledState']>>>
): boolean {
  const { customShaderConfig } = context
  const { visibleTiles, tileBounds: zarrTileBounds } = tiledState
  const xyLimits = mode.getXYLimits()
  const maxLevelIndex = mode.getMaxLevelIndex()
  const levels = mode.getLevels()

  if (!xyLimits || visibleTiles.length === 0) return true

  // Get the Mapbox tile bounds we need to render into
  const mapboxTileBounds = getMapboxTileBounds(tileId)
  const tileMatrix = createMapboxTileMatrix(
    mapboxTileBounds.x0,
    mapboxTileBounds.y0,
    mapboxTileBounds.x1,
    mapboxTileBounds.y1
  )

  // Filter visibleTiles to those that overlap with the Mapbox tile
  // Use the pre-computed tileBounds from TiledMode (in Mercator space)
  const overlappingZarrTiles: TileTuple[] = []
  for (const zarrTile of visibleTiles) {
    const zarrKey = tileToKey(zarrTile)
    const zarrBounds = zarrTileBounds?.[zarrKey]
    if (!zarrBounds) continue

    // Check overlap in Mercator space
    if (
      zarrBounds.x0 < mapboxTileBounds.x1 &&
      zarrBounds.x1 > mapboxTileBounds.x0 &&
      zarrBounds.y0 < mapboxTileBounds.y1 &&
      zarrBounds.y1 > mapboxTileBounds.y0
    ) {
      overlappingZarrTiles.push(zarrTile)
    }
  }

  if (overlappingZarrTiles.length === 0) {
    return false
  }

  // EPSG:4326 tiles use fragment shader reprojection (not wgs84 vertex shader)
  // The fragment shader inverts Mercator Y to get latitude for texture lookup
  const shaderProgram = renderer.getProgram(
    context.shaderData,
    customShaderConfig,
    true, // useMapboxGlobe
    false // useWgs84 - fragment shader reprojection for EPSG:4326
  )
  renderer.gl.useProgram(shaderProgram.program)

  const maxZoomLevelPath = levels[maxLevelIndex] ?? ''
  const datasetMaxZoom = parseLevelZoom(maxZoomLevelPath, maxLevelIndex)

  let anyTileRendered = false
  let anyMissing = false

  for (const zarrTile of overlappingZarrTiles) {
    const result = renderSingle4326Tile(
      renderer,
      shaderProgram,
      zarrTile,
      mapboxTileBounds,
      tileMatrix,
      tiledState,
      context,
      xyLimits,
      datasetMaxZoom
    )

    if (result.rendered) anyTileRendered = true
    if (result.missing) anyMissing = true
  }

  return anyMissing || !anyTileRendered
}

/**
 * Render a single EPSG:4326 Zarr tile to a globe tile.
 * Handles parent/child tile fallback.
 */
function renderSingle4326Tile(
  renderer: ZarrRenderer,
  shaderProgram: ShaderProgram,
  zarrTile: TileTuple,
  mapboxTileBounds: { x0: number; y0: number; x1: number; y1: number },
  tileMatrix: Float32Array,
  tiledState: NonNullable<ReturnType<NonNullable<ZarrMode['getTiledState']>>>,
  context: RenderContext,
  xyLimits: XYLimits,
  datasetMaxZoom: number
): { rendered: boolean; missing: boolean } {
  const {
    tileCache,
    vertexArr,
    pixCoordArr,
    tileSize,
    tileBounds: zarrTileBoundsMap,
  } = tiledState
  const { colormapTexture, uniforms, customShaderConfig } = context

  const zarrTileKey = tileToKey(zarrTile)
  let tileData = tileCache.get(zarrTileKey)
  let renderTileTuple: TileTuple = zarrTile
  let missing = false

  if (!tileData?.data) {
    missing = true

    // Try parent first (zoom-in case)
    const parent = findBestParentTile(
      tileCache,
      zarrTile[0],
      zarrTile[1],
      zarrTile[2]
    )
    if (parent) {
      tileData = parent.tile
      renderTileTuple = [parent.ancestorZ, parent.ancestorX, parent.ancestorY]
    } else {
      // Try children (zoom-out case)
      const children = findBestChildTiles(
        tileCache,
        zarrTile[0],
        zarrTile[1],
        zarrTile[2],
        datasetMaxZoom
      )
      if (children && children.length > 0) {
        let anyChildRendered = false
        for (const child of children) {
          if (!child.tile.data) continue

          const rendered = renderChild4326Tile(
            renderer,
            shaderProgram,
            child,
            mapboxTileBounds,
            tileMatrix,
            tiledState,
            context,
            xyLimits
          )
          if (rendered) anyChildRendered = true
        }
        return { rendered: anyChildRendered, missing: true }
      }
      return { rendered: false, missing: true }
    }
  }

  // Render the tile (either original or parent fallback)
  const renderTileKey = tileToKey(renderTileTuple)

  // Use pre-computed bounds from TiledMode if available, otherwise compute
  let zarrBounds = zarrTileBoundsMap?.[renderTileKey]
  if (!zarrBounds) {
    // Fallback: compute bounds (needed for parent tile fallback)
    const [z, tx, ty] = renderTileTuple
    const zarrGeoBounds = get4326TileGeoBounds(z, tx, ty, xyLimits)
    zarrBounds = {
      x0: lonToMercatorNorm(zarrGeoBounds.west),
      x1: lonToMercatorNorm(zarrGeoBounds.east),
      y0: latToMercatorNorm(zarrGeoBounds.north),
      y1: latToMercatorNorm(zarrGeoBounds.south),
      latMin: zarrGeoBounds.south,
      latMax: zarrGeoBounds.north,
      lonMin: zarrGeoBounds.west,
      lonMax: zarrGeoBounds.east,
    }
  }

  // Use pre-computed Mercator bounds from zarrBounds
  const overlapX0 = Math.max(zarrBounds.x0, mapboxTileBounds.x0)
  const overlapX1 = Math.min(zarrBounds.x1, mapboxTileBounds.x1)
  const overlapY0 = Math.max(zarrBounds.y0, mapboxTileBounds.y0)
  const overlapY1 = Math.min(zarrBounds.y1, mapboxTileBounds.y1)

  if (overlapX1 <= overlapX0 || overlapY1 <= overlapY0) {
    return { rendered: false, missing }
  }

  // Get lat/lon bounds (required for fragment shader reprojection)
  const zarrLonMin = zarrBounds.lonMin ?? mercatorNormToLon(zarrBounds.x0)
  const zarrLonMax = zarrBounds.lonMax ?? mercatorNormToLon(zarrBounds.x1)
  const zarrLatMin = zarrBounds.latMin ?? mercatorNormToLat(zarrBounds.y1)
  const zarrLatMax = zarrBounds.latMax ?? mercatorNormToLat(zarrBounds.y0)

  const zarrLonWidth = zarrLonMax - zarrLonMin
  const overlapWest = mercatorNormToLon(overlapX0)
  const overlapEast = mercatorNormToLon(overlapX1)
  const texScaleX =
    zarrLonWidth > 0 ? (overlapEast - overlapWest) / zarrLonWidth : 1
  const texOffsetX =
    zarrLonWidth > 0 ? (overlapWest - zarrLonMin) / zarrLonWidth : 0

  // For Y texture coordinates with fragment shader reprojection:
  // The shader already maps latitude to texV using u_latBounds.
  // pix_coord.x needs texScale/texOffset (X uses pix_coord directly),
  // but texV is computed from screen position → latitude → texture coord.
  // So texScaleY=1, texOffsetY=0 - the shader handles the mapping.
  const texScaleY = 1
  const texOffsetY = 0

  const tileBoundsForRender = {
    [renderTileKey]: {
      x0: overlapX0,
      y0: overlapY0,
      x1: overlapX1,
      y1: overlapY1,
      latMin: zarrLatMin,
      latMax: zarrLatMax,
    },
  }

  renderer.applyCommonUniforms(
    shaderProgram,
    colormapTexture,
    uniforms,
    customShaderConfig,
    context.projectionData,
    {
      projection: { name: 'globe' },
      globeToMercatorMatrix: MAPBOX_GLOBE_IDENTITY_MATRIX,
      transition: 0,
    },
    tileMatrix,
    true
  )

  renderer.renderTiles(
    shaderProgram,
    [renderTileTuple],
    [0],
    tileCache,
    tileSize,
    vertexArr,
    pixCoordArr,
    tileBoundsForRender,
    customShaderConfig,
    true,
    undefined,
    {
      [renderTileKey]: {
        texScale: [texScaleX, texScaleY],
        texOffset: [texOffsetX, texOffsetY],
      },
    },
    tiledState.latIsAscending
  )

  return { rendered: true, missing }
}

/**
 * Render a child tile for zoom-out fallback in EPSG:4326 mode.
 */
function renderChild4326Tile(
  renderer: ZarrRenderer,
  shaderProgram: ShaderProgram,
  child: {
    childZ: number
    childX: number
    childY: number
    tile: ReturnType<
      NonNullable<
        ReturnType<NonNullable<ZarrMode['getTiledState']>>
      >['tileCache']['get']
    >
  },
  mapboxTileBounds: { x0: number; y0: number; x1: number; y1: number },
  tileMatrix: Float32Array,
  tiledState: NonNullable<ReturnType<NonNullable<ZarrMode['getTiledState']>>>,
  context: RenderContext,
  xyLimits: XYLimits
): boolean {
  const {
    tileCache,
    vertexArr,
    pixCoordArr,
    tileSize,
    tileBounds: zarrTileBoundsMap,
  } = tiledState
  const { colormapTexture, uniforms, customShaderConfig } = context

  const childTileTuple: TileTuple = [child.childZ, child.childX, child.childY]
  const childTileKey = tileToKey(childTileTuple)

  // Use pre-computed bounds from TiledMode if available, otherwise compute
  let childBounds = zarrTileBoundsMap?.[childTileKey]
  if (!childBounds) {
    const childGeoBounds = get4326TileGeoBounds(
      child.childZ,
      child.childX,
      child.childY,
      xyLimits
    )
    childBounds = {
      x0: lonToMercatorNorm(childGeoBounds.west),
      x1: lonToMercatorNorm(childGeoBounds.east),
      y0: latToMercatorNorm(childGeoBounds.north),
      y1: latToMercatorNorm(childGeoBounds.south),
      latMin: childGeoBounds.south,
      latMax: childGeoBounds.north,
      lonMin: childGeoBounds.west,
      lonMax: childGeoBounds.east,
    }
  }

  const childOverlapX0 = Math.max(childBounds.x0, mapboxTileBounds.x0)
  const childOverlapX1 = Math.min(childBounds.x1, mapboxTileBounds.x1)
  const childOverlapY0 = Math.max(childBounds.y0, mapboxTileBounds.y0)
  const childOverlapY1 = Math.min(childBounds.y1, mapboxTileBounds.y1)

  if (childOverlapX1 <= childOverlapX0 || childOverlapY1 <= childOverlapY0) {
    return false
  }

  // Get lat/lon bounds (required for fragment shader reprojection)
  const childLonMin = childBounds.lonMin ?? mercatorNormToLon(childBounds.x0)
  const childLonMax = childBounds.lonMax ?? mercatorNormToLon(childBounds.x1)
  const childLatMin = childBounds.latMin ?? mercatorNormToLat(childBounds.y1)
  const childLatMax = childBounds.latMax ?? mercatorNormToLat(childBounds.y0)

  const childLonWidth = childLonMax - childLonMin
  const childOverlapWest = mercatorNormToLon(childOverlapX0)
  const childOverlapEast = mercatorNormToLon(childOverlapX1)
  const childTexScaleX =
    childLonWidth > 0
      ? (childOverlapEast - childOverlapWest) / childLonWidth
      : 1
  const childTexOffsetX =
    childLonWidth > 0 ? (childOverlapWest - childLonMin) / childLonWidth : 0

  // For Y texture coordinates with fragment shader reprojection:
  // The shader already maps latitude to texV using u_latBounds.
  // So texScaleY=1, texOffsetY=0 - the shader handles the mapping.
  const childTexScaleY = 1
  const childTexOffsetY = 0

  const childTileBoundsForRender = {
    [childTileKey]: {
      x0: childOverlapX0,
      y0: childOverlapY0,
      x1: childOverlapX1,
      y1: childOverlapY1,
      latMin: childLatMin,
      latMax: childLatMax,
    },
  }

  renderer.applyCommonUniforms(
    shaderProgram,
    colormapTexture,
    uniforms,
    customShaderConfig,
    context.projectionData,
    {
      projection: { name: 'globe' },
      globeToMercatorMatrix: MAPBOX_GLOBE_IDENTITY_MATRIX,
      transition: 0,
    },
    tileMatrix,
    true
  )

  renderer.renderTiles(
    shaderProgram,
    [childTileTuple],
    [0],
    tileCache,
    tileSize,
    vertexArr,
    pixCoordArr,
    childTileBoundsForRender,
    customShaderConfig,
    true,
    undefined,
    {
      [childTileKey]: {
        texScale: [childTexScaleX, childTexScaleY],
        texOffset: [childTexOffsetX, childTexOffsetY],
      },
    },
    tiledState.latIsAscending
  )

  return true
}

/**
 * Render EPSG:3857 tiled data to a globe tile.
 * This is simpler since Mapbox tiles are already in Mercator.
 */
function render3857TiledToTile(
  renderer: ZarrRenderer,
  mode: ZarrMode,
  tileId: TileId,
  context: RenderContext,
  tiledState: NonNullable<ReturnType<NonNullable<ZarrMode['getTiledState']>>>
): boolean {
  const { tileCache, vertexArr, pixCoordArr, tileSize, tileBounds } = tiledState
  const { colormapTexture, uniforms, customShaderConfig } = context
  const levels = mode.getLevels()
  const maxLevelIndex = mode.getMaxLevelIndex()

  const mapboxTileBounds = getMapboxTileBounds(tileId)
  const tileMatrix = createMapboxTileMatrix(
    mapboxTileBounds.x0,
    mapboxTileBounds.y0,
    mapboxTileBounds.x1,
    mapboxTileBounds.y1
  )

  const tileTuple: TileTuple = [tileId.z, tileId.x, tileId.y]
  const tileKey = tileTuple.join(',')

  const boundsForTile = tileBounds?.[tileKey]
  const tileBoundsOverride = {
    [tileKey]: {
      x0: mapboxTileBounds.x0,
      y0: mapboxTileBounds.y0,
      x1: mapboxTileBounds.x1,
      y1: mapboxTileBounds.y1,
      latMin: boundsForTile?.latMin,
      latMax: boundsForTile?.latMax,
    },
  }

  const maxZoomLevelPath = levels[maxLevelIndex] ?? ''
  const datasetMaxZoom = parseLevelZoom(maxZoomLevelPath, maxLevelIndex)

  const shaderProgram = renderer.getProgram(
    context.shaderData,
    customShaderConfig,
    true
  )
  renderer.gl.useProgram(shaderProgram.program)

  renderer.applyCommonUniforms(
    shaderProgram,
    colormapTexture,
    uniforms,
    customShaderConfig,
    context.projectionData,
    {
      projection: { name: 'globe' },
      globeToMercatorMatrix: MAPBOX_GLOBE_IDENTITY_MATRIX,
      transition: 0,
    },
    tileMatrix,
    true
  )

  renderer.renderTiles(
    shaderProgram,
    [tileTuple],
    [0],
    tileCache,
    tileSize,
    vertexArr,
    pixCoordArr,
    tileBoundsOverride,
    customShaderConfig,
    true,
    datasetMaxZoom
  )

  const tileHasData = tileCache.get(tileKey)?.data
  return !tileHasData
}
