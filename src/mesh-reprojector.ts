/**
 * Adaptive mesh generation for client-side raster reprojection.
 *
 * Uses @developmentseed/raster-reproject for error-driven Delaunay triangulation.
 * Modified to output EPSG:4326 coordinates instead of Mercator,
 * enabling two-stage GPU reprojection for polar projection support.
 */

import Delaunator from 'delaunator'
import { RasterReprojector } from '@developmentseed/raster-reproject'
import { lonToMercatorNorm, type Wgs84Bounds } from './map-utils'
import {
  pixelToSourceCRS,
  sourceCRSToPixel,
  type ProjectionTransformer,
} from './projection-utils'
import { DEFAULT_MESH_MAX_ERROR } from './constants'

// ============================================================================
// Shared helpers
// ============================================================================

interface ReprojectorConfig {
  bounds: [number, number, number, number]
  width: number
  height: number
  latIsAscending: boolean
  transformer: ProjectionTransformer
}

/**
 * Create a configured RasterReprojector with proper pixel-to-CRS transforms.
 */
function createReprojector(config: ReprojectorConfig): RasterReprojector {
  const { bounds, width, height, latIsAscending, transformer } = config

  // The reprojector converts UV [0,1] → pixel [0, width-1] internally.
  // Our edge-based pixelToSourceCRS expects [0, width] → [xMin, xMax].
  // We scale the pixel values to bridge this: scaledPx = px * width / (width - 1)
  const scaleX = width > 1 ? width / (width - 1) : 1
  const scaleY = height > 1 ? height / (height - 1) : 1

  return new RasterReprojector(
    {
      // Pixel coords [0, width-1] → source CRS coords (scaled to edge-based model)
      forwardTransform: (px: number, py: number) =>
        pixelToSourceCRS(
          px * scaleX,
          py * scaleY,
          bounds,
          width,
          height,
          latIsAscending
        ),
      // Source CRS coords → pixel coords [0, width-1] (unscale from edge-based model)
      inverseTransform: (x: number, y: number) => {
        const [scaledPx, scaledPy] = sourceCRSToPixel(
          x,
          y,
          bounds,
          width,
          height,
          latIsAscending
        )
        return [scaledPx / scaleX, scaledPy / scaleY]
      },
      // Source CRS → EPSG:4326 (lon, lat)
      forwardReproject: (x: number, y: number) => transformer.forward(x, y),
      // EPSG:4326 → source CRS
      inverseReproject: (lon: number, lat: number) =>
        transformer.inverse(lon, lat),
    },
    width,
    height
  )
}

/**
 * Compute normalized WGS84 bounds from min/max lon/lat values.
 */
function computeWgs84Bounds(
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number
): Wgs84Bounds {
  return {
    lon0: lonToMercatorNorm(minLon),
    lat0: (minLat + 90) / 180,
    lon1: lonToMercatorNorm(maxLon),
    lat1: (maxLat + 90) / 180,
  }
}

/**
 * Normalize lon/lat positions to local [-1, 1] coordinates.
 * This matches the standard mercator path where createSubdividedQuad outputs [-1, 1].
 */
function normalizeToLocalCoords(
  positions: ArrayLike<number>,
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number
): Float32Array {
  const numVerts = positions.length / 2
  const normalized = new Float32Array(numVerts * 2)
  const lonRange = maxLon - minLon || 1
  const latRange = maxLat - minLat || 1

  for (let i = 0; i < numVerts; i++) {
    const lon = positions[i * 2]
    const lat = positions[i * 2 + 1]
    // Map [minLon, maxLon] → [-1, 1] and [minLat, maxLat] → [-1, 1]
    normalized[i * 2] = ((lon - minLon) / lonRange) * 2 - 1
    normalized[i * 2 + 1] = ((lat - minLat) / latRange) * 2 - 1
  }

  return normalized
}

// ============================================================================
// Public API
// ============================================================================

export interface AdaptiveMeshResult {
  positions: Float32Array // Normalized 4326 coords [-1,1] for shader
  texCoords: Float32Array // UVs for texture sampling
  indices: Uint32Array // Triangle indices
  wgs84Bounds: Wgs84Bounds
}

export interface AdaptiveMeshOptions {
  geoBounds: { xMin: number; xMax: number; yMin: number; yMax: number }
  width: number
  height: number
  transformer: ProjectionTransformer
  latIsAscending: boolean
  maxError?: number
}

/**
 * Create adaptive mesh geometry for proj4 regions using error-driven Delaunay triangulation.
 * Outputs normalized EPSG:4326 coordinates for two-stage GPU reprojection.
 *
 * This is more efficient than uniform grid subdivision - it only adds vertices
 * where reprojection error exceeds the threshold.
 */
export function createAdaptiveMesh(
  options: AdaptiveMeshOptions
): AdaptiveMeshResult {
  const {
    geoBounds,
    width,
    height,
    transformer,
    latIsAscending,
    maxError = DEFAULT_MESH_MAX_ERROR,
  } = options
  const { xMin, xMax, yMin, yMax } = geoBounds
  const bounds: [number, number, number, number] = [xMin, yMin, xMax, yMax]

  const reprojector = createReprojector({
    bounds,
    width,
    height,
    latIsAscending,
    transformer,
  })

  // Run adaptive refinement until error < threshold
  reprojector.run(maxError)

  // First pass: compute bounds in degrees
  const numVerts = reprojector.exactOutputPositions.length / 2
  let minLon = Infinity,
    maxLon = -Infinity
  let minLat = Infinity,
    maxLat = -Infinity

  for (let i = 0; i < numVerts; i++) {
    const lon = reprojector.exactOutputPositions[i * 2]
    const lat = reprojector.exactOutputPositions[i * 2 + 1]
    minLon = Math.min(minLon, lon)
    maxLon = Math.max(maxLon, lon)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  }

  // Expand bounds to include pixel edges (not just centers) to avoid seams.
  // With edge-to-edge bounds, geoBounds already represents pixel edges:
  // xMin = left edge of first pixel, xMax = right edge of last pixel
  // So we sample directly at these geographic coordinates.
  const midX = (xMin + xMax) / 2
  const midY = (yMin + yMax) / 2
  const edgeSamples: Array<[number, number]> = [
    [xMin, yMin], // corner
    [xMax, yMin], // corner
    [xMax, yMax], // corner
    [xMin, yMax], // corner
    [midX, yMin], // edge midpoint
    [midX, yMax], // edge midpoint
    [xMin, midY], // edge midpoint
    [xMax, midY], // edge midpoint
  ]

  for (const [srcX, srcY] of edgeSamples) {
    const [lon, lat] = transformer.forward(srcX, srcY)
    if (!isFinite(lon) || !isFinite(lat)) continue
    minLon = Math.min(minLon, lon)
    maxLon = Math.max(maxLon, lon)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  }

  const wgs84Bounds = computeWgs84Bounds(minLon, maxLon, minLat, maxLat)
  const positions = normalizeToLocalCoords(
    reprojector.exactOutputPositions,
    minLon,
    maxLon,
    minLat,
    maxLat
  )

  // UVs remain unchanged (for texture sampling)
  const texCoords = new Float32Array(reprojector.uvs)

  // Triangle indices
  const indices = new Uint32Array(reprojector.triangles)

  return { positions, texCoords, indices, wgs84Bounds }
}

export interface HybridMeshOptions {
  geoBounds: { xMin: number; xMax: number; yMin: number; yMax: number }
  width: number
  height: number
  subdivisions: number
  transformer: ProjectionTransformer
  latIsAscending: boolean
  maxError?: number
}

/**
 * Create a hybrid mesh that combines adaptive refinement with uniform grid vertices.
 * This gives both: accurate reprojection (adaptive) + even coverage for globe curvature (uniform).
 *
 * Algorithm:
 * 1. Run adaptive mesh to get error-driven vertices in UV space
 * 2. Generate uniform grid vertices in UV space
 * 3. Merge and re-triangulate with Delaunator
 * 4. Transform all vertices to WGS84
 */
export function createHybridMesh(
  options: HybridMeshOptions
): AdaptiveMeshResult {
  const {
    geoBounds,
    width,
    height,
    subdivisions,
    transformer,
    latIsAscending,
    maxError = DEFAULT_MESH_MAX_ERROR,
  } = options
  const { xMin, xMax, yMin, yMax } = geoBounds
  const bounds: [number, number, number, number] = [xMin, yMin, xMax, yMax]

  const reprojector = createReprojector({
    bounds,
    width,
    height,
    latIsAscending,
    transformer,
  })

  // Run adaptive refinement
  reprojector.run(maxError)

  // Collect adaptive mesh UVs
  const adaptiveUVs = reprojector.uvs // [u0, v0, u1, v1, ...]

  // Merge adaptive + uniform grid UVs directly into pre-sized array
  // (duplicates are harmless for Delaunator)
  const uniformCount = (subdivisions + 1) ** 2 * 2
  const mergedUVs = new Float64Array(adaptiveUVs.length + uniformCount)
  mergedUVs.set(adaptiveUVs)

  let offset = adaptiveUVs.length
  for (let row = 0; row <= subdivisions; row++) {
    for (let col = 0; col <= subdivisions; col++) {
      mergedUVs[offset++] = col / subdivisions
      mergedUVs[offset++] = row / subdivisions
    }
  }

  // Triangulate merged UVs with Delaunator
  const delaunay = new Delaunator(mergedUVs)
  const triangles = delaunay.triangles

  // Transform all UVs to WGS84 and compute bounds
  const numVerts = mergedUVs.length / 2
  const wgs84Positions = new Float64Array(numVerts * 2)
  let minLon = Infinity,
    maxLon = -Infinity
  let minLat = Infinity,
    maxLat = -Infinity

  for (let i = 0; i < numVerts; i++) {
    const u = mergedUVs[i * 2]
    const v = mergedUVs[i * 2 + 1]

    // UV → source CRS
    const srcX = xMin + u * (xMax - xMin)
    const srcY = latIsAscending
      ? yMin + v * (yMax - yMin)
      : yMax - v * (yMax - yMin)

    // Source CRS → WGS84
    const [lon, lat] = transformer.forward(srcX, srcY)
    wgs84Positions[i * 2] = lon
    wgs84Positions[i * 2 + 1] = lat

    if (isFinite(lon) && isFinite(lat)) {
      minLon = Math.min(minLon, lon)
      maxLon = Math.max(maxLon, lon)
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
    }
  }

  const wgs84Bounds = computeWgs84Bounds(minLon, maxLon, minLat, maxLat)
  const positions = normalizeToLocalCoords(
    wgs84Positions,
    minLon,
    maxLon,
    minLat,
    maxLat
  )

  // Create texCoords from merged UVs
  const texCoords = new Float32Array(mergedUVs)

  return {
    positions,
    texCoords,
    indices: new Uint32Array(triangles),
    wgs84Bounds,
  }
}
