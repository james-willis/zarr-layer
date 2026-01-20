/**
 * Mesh generation for client-side raster reprojection.
 *
 * Uses Delaunay triangulation on a uniform grid for reliable mesh generation.
 * Outputs EPSG:4326 coordinates for two-stage GPU reprojection
 * (source CRS → WGS84 on CPU, WGS84 → Mercator in shader).
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
 * For antimeridian-crossing data, minLon > maxLon (e.g., 170° to -170°).
 *
 * Note: For Mercator rendering, latitudes beyond ±85.05° will be clamped
 * in the shader. This may cause visual artifacts for polar data.
 * Globe mode can display full polar data without issues.
 */
function computeWgs84Bounds(
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  crossesAntimeridian: boolean = false
): Wgs84Bounds {
  return {
    lon0: lonToMercatorNorm(minLon),
    lat0: (minLat + 90) / 180,
    lon1: lonToMercatorNorm(maxLon),
    lat1: (maxLat + 90) / 180,
    crossesAntimeridian,
  }
}

/**
 * Normalize lon/lat positions to local [-1, 1] coordinates.
 * This matches the standard mercator path where createSubdividedQuad outputs [-1, 1].
 *
 * For antimeridian-crossing bounds (minLon > maxLon in degrees, e.g., 170° to -170°):
 * - Actual range is (360 - minLon + maxLon), e.g., (360 - 170 + (-170)) = 20°
 * - Longitudes < minLon get +360 to create a continuous range
 */
function normalizeToLocalCoords(
  positions: ArrayLike<number>,
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  crossesAntimeridian: boolean = false
): Float32Array {
  const numVerts = positions.length / 2
  const normalized = new Float32Array(numVerts * 2)

  // For antimeridian crossing: actual range wraps through 180°
  // e.g., minLon=170, maxLon=-170 means range of 20° (not -340°)
  const lonRange = crossesAntimeridian
    ? 360 - minLon + maxLon || 1
    : maxLon - minLon || 1
  const latRange = maxLat - minLat || 1

  for (let i = 0; i < numVerts; i++) {
    let lon = positions[i * 2]
    const lat = positions[i * 2 + 1]

    // Normalize longitude to [-180, 180) range first
    // This handles the case where proj4 outputs 180° which equals -180°
    if (lon >= 180) lon -= 360
    if (lon < -180) lon += 360

    // For antimeridian crossing, shift negative longitudes up by 360
    // so they're in a continuous range with positive longitudes
    if (crossesAntimeridian && lon < minLon) {
      lon += 360
    }

    // Map [minLon, maxLon] → [-1, 1] and [minLat, maxLat] → [-1, 1]
    normalized[i * 2] = ((lon - minLon) / lonRange) * 2 - 1
    normalized[i * 2 + 1] = ((lat - minLat) / latRange) * 2 - 1
  }

  return normalized
}

/**
 * Check if an edge crosses the antimeridian (spans > 180° longitude).
 */
function edgeCrossesAntimeridian(lon1: number, lon2: number): boolean {
  return Math.abs(lon1 - lon2) > 180
}

/**
 * Compute the intersection point of an edge with the antimeridian.
 * Returns the latitude at which the edge crosses lon = ±180°.
 */
function computeAntimeridianIntersection(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): { lat: number; t: number } {
  // Shift longitudes so they're continuous across the antimeridian
  // If lon1 is positive and lon2 is negative (or vice versa) with large span,
  // shift the negative one up by 360
  let l1 = lon1
  let l2 = lon2
  if (lon1 > 0 && lon2 < 0 && lon1 - lon2 > 180) {
    l2 += 360 // e.g., -170 becomes 190
  } else if (lon2 > 0 && lon1 < 0 && lon2 - lon1 > 180) {
    l1 += 360
  }

  // Now interpolate to find where lon = 180 (the antimeridian)
  const t = (180 - l1) / (l2 - l1)
  const lat = lat1 + t * (lat2 - lat1)
  return { lat, t }
}

/**
 * Result of processing triangles at the antimeridian.
 */
interface SplitResult {
  positions: Float64Array
  texCoords: Float64Array
  indices: Uint32Array
}

/**
 * Process triangles that span the antimeridian by splitting them.
 * Instead of filtering out these triangles, we split them at the antimeridian
 * to create triangles that render correctly.
 *
 * For triangles that don't cross the antimeridian, they're kept as-is.
 * For triangles that do cross, they're split into smaller triangles.
 */
function splitAntimeridianTriangles(
  wgs84Positions: Float64Array,
  texCoords: Float64Array,
  triangles: ArrayLike<number>
): SplitResult {
  const newPositions: number[] = Array.from(wgs84Positions)
  const newTexCoords: number[] = Array.from(texCoords)
  const newIndices: number[] = []

  // Helper to add a new vertex and return its index
  function addVertex(lon: number, lat: number, u: number, v: number): number {
    const idx = newPositions.length / 2
    newPositions.push(lon, lat)
    newTexCoords.push(u, v)
    return idx
  }

  // Helper to get vertex data
  function getVertex(i: number): {
    lon: number
    lat: number
    u: number
    v: number
  } {
    return {
      lon: wgs84Positions[i * 2],
      lat: wgs84Positions[i * 2 + 1],
      u: texCoords[i * 2],
      v: texCoords[i * 2 + 1],
    }
  }

  // Normalize longitude to [-180, 180)
  function normLon(lon: number): number {
    if (lon >= 180) return lon - 360
    if (lon < -180) return lon + 360
    return lon
  }

  for (let i = 0; i < triangles.length; i += 3) {
    const i0 = triangles[i]
    const i1 = triangles[i + 1]
    const i2 = triangles[i + 2]

    const v0 = getVertex(i0)
    const v1 = getVertex(i1)
    const v2 = getVertex(i2)

    // Skip triangles with non-finite coordinates
    if (
      !isFinite(v0.lon) ||
      !isFinite(v0.lat) ||
      !isFinite(v1.lon) ||
      !isFinite(v1.lat) ||
      !isFinite(v2.lon) ||
      !isFinite(v2.lat)
    ) {
      continue
    }

    // Normalize longitudes
    const lon0 = normLon(v0.lon)
    const lon1 = normLon(v1.lon)
    const lon2 = normLon(v2.lon)

    // Check which edges cross the antimeridian
    const cross01 = edgeCrossesAntimeridian(lon0, lon1)
    const cross12 = edgeCrossesAntimeridian(lon1, lon2)
    const cross20 = edgeCrossesAntimeridian(lon2, lon0)
    const crossCount = (cross01 ? 1 : 0) + (cross12 ? 1 : 0) + (cross20 ? 1 : 0)

    if (crossCount === 0) {
      // Triangle doesn't cross antimeridian - keep as-is
      newIndices.push(i0, i1, i2)
    } else if (crossCount === 2) {
      // Two edges cross - one vertex is on the opposite side
      // Find which vertex is alone on its side
      let alone: number, other1: number, other2: number
      let vAlone: typeof v0, vOther1: typeof v0, vOther2: typeof v0
      let lonAlone: number, lonOther1: number, lonOther2: number

      if (!cross01) {
        // Edge 0-1 doesn't cross, so vertex 2 is alone
        alone = i2
        other1 = i0
        other2 = i1
        vAlone = v2
        vOther1 = v0
        vOther2 = v1
        lonAlone = lon2
        lonOther1 = lon0
        lonOther2 = lon1
      } else if (!cross12) {
        // Edge 1-2 doesn't cross, so vertex 0 is alone
        alone = i0
        other1 = i1
        other2 = i2
        vAlone = v0
        vOther1 = v1
        vOther2 = v2
        lonAlone = lon0
        lonOther1 = lon1
        lonOther2 = lon2
      } else {
        // Edge 2-0 doesn't cross, so vertex 1 is alone
        alone = i1
        other1 = i2
        other2 = i0
        vAlone = v1
        vOther1 = v2
        vOther2 = v0
        lonAlone = lon1
        lonOther1 = lon2
        lonOther2 = lon0
      }

      // Compute intersection points on the two crossing edges
      const int1 = computeAntimeridianIntersection(
        lonAlone,
        vAlone.lat,
        lonOther1,
        vOther1.lat
      )
      const int2 = computeAntimeridianIntersection(
        lonAlone,
        vAlone.lat,
        lonOther2,
        vOther2.lat
      )

      // Interpolate texture coordinates
      const u1 = vAlone.u + int1.t * (vOther1.u - vAlone.u)
      const v1Tex = vAlone.v + int1.t * (vOther1.v - vAlone.v)
      const u2 = vAlone.u + int2.t * (vOther2.u - vAlone.u)
      const v2Tex = vAlone.v + int2.t * (vOther2.v - vAlone.v)

      // Determine which side the alone vertex is on
      const aloneOnEast = lonAlone > 0

      // Create new vertices at the intersection points
      // Use 179.9999 and -179.9999 instead of exactly ±180 to avoid normalization
      // issues where 180° gets converted to -180° (same geographic point but wrong
      // normalized position). This ensures east-side triangles have their boundary
      // at the far right (x≈1) and west-side triangles at the far left (x≈-1).
      const lonAloneSide = aloneOnEast ? 179.9999 : -179.9999
      const lonOtherSide = aloneOnEast ? -179.9999 : 179.9999

      const intAlone1 = addVertex(lonAloneSide, int1.lat, u1, v1Tex)
      const intAlone2 = addVertex(lonAloneSide, int2.lat, u2, v2Tex)
      const intOther1 = addVertex(lonOtherSide, int1.lat, u1, v1Tex)
      const intOther2 = addVertex(lonOtherSide, int2.lat, u2, v2Tex)

      // Create triangle on the "alone" side
      newIndices.push(alone, intAlone1, intAlone2)

      // Create triangles on the "other" side (quadrilateral split into 2 triangles)
      newIndices.push(intOther1, other1, other2)
      newIndices.push(intOther1, other2, intOther2)
    }
    // crossCount === 1 or 3 are degenerate cases (shouldn't happen with well-formed triangles)
    // We skip them
  }

  return {
    positions: new Float64Array(newPositions),
    texCoords: new Float64Array(newTexCoords),
    indices: new Uint32Array(newIndices),
  }
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

  // Run adaptive refinement with vertex limit to prevent hanging on polar data.
  const MAX_ADAPTIVE_VERTICES = 10000
  const MAX_ITERATIONS = 1000

  for (
    let i = 0;
    i < MAX_ITERATIONS && reprojector.getMaxError() > maxError;
    i++
  ) {
    const prevVertCount = reprojector.uvs.length / 2
    reprojector.refine()

    const newVertCount = reprojector.uvs.length / 2
    if (
      newVertCount >= MAX_ADAPTIVE_VERTICES ||
      newVertCount === prevVertCount
    ) {
      break
    }
  }

  // Collect adaptive mesh UVs
  const adaptiveUVs = reprojector.uvs // [u0, v0, u1, v1, ...]

  // Merge adaptive + uniform grid UVs directly into pre-sized array
  // (duplicates are harmless for Delaunator)
  const uniformVertices = (subdivisions + 1) ** 2
  const mergedUVs = new Float64Array(adaptiveUVs.length + uniformVertices * 2)
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

  // Fallback if no valid coords found
  if (!isFinite(minLon)) minLon = -180
  if (!isFinite(maxLon)) maxLon = 180
  if (!isFinite(minLat)) minLat = -90
  if (!isFinite(maxLat)) maxLat = 90

  // Detect antimeridian crossing using gap analysis
  const lons: number[] = []
  for (let i = 0; i < numVerts; i++) {
    const lon = wgs84Positions[i * 2]
    if (isFinite(lon)) lons.push(lon)
  }

  let crossesAntimeridian = false
  if (lons.length > 0) {
    lons.sort((a, b) => a - b)

    // Find the largest gap between consecutive longitudes
    let maxGap = 0
    let gapEndIndex = 0
    for (let i = 0; i < lons.length - 1; i++) {
      const gap = lons[i + 1] - lons[i]
      if (gap > maxGap) {
        maxGap = gap
        gapEndIndex = i + 1
      }
    }

    // Check the wrap-around gap (from max lon back to min lon)
    const wrapGap = lons[0] + 360 - lons[lons.length - 1]

    // Total longitude coverage from simple min/max
    const lonCoverage = lons[lons.length - 1] - lons[0]

    // If wrap gap is smaller than the largest internal gap,
    // data crosses the antimeridian (the "gap" is in the data, not at ±180°)
    // EXCEPTION: If coverage is wide (>270°), this is likely polar data
    // spanning most longitudes, not antimeridian crossing. The gaps are from
    // projection singularities, not actual data boundaries.
    if (wrapGap < maxGap && lonCoverage < 270) {
      crossesAntimeridian = true
      // Recompute bounds: minLon is after the gap, maxLon is before it
      minLon = lons[gapEndIndex]
      maxLon = lons[gapEndIndex - 1]
    }
  }

  // Normalize edge case: if minLon is exactly 180°, it's the same as -180°
  if (crossesAntimeridian && minLon >= 180) {
    minLon = minLon - 360
    if (minLon <= maxLon) {
      crossesAntimeridian = false
    }
  }

  // Split triangles at antimeridian (also filters polar triangles)
  const texCoords = new Float64Array(mergedUVs)
  const splitResult = splitAntimeridianTriangles(
    wgs84Positions,
    texCoords,
    triangles
  )

  // Normalize with antimeridian awareness
  const positions = normalizeToLocalCoords(
    splitResult.positions,
    minLon,
    maxLon,
    minLat,
    maxLat,
    crossesAntimeridian
  )

  const wgs84Bounds = computeWgs84Bounds(
    minLon,
    maxLon,
    minLat,
    maxLat,
    crossesAntimeridian
  )

  return {
    positions,
    texCoords: new Float32Array(splitResult.texCoords),
    indices: splitResult.indices,
    wgs84Bounds,
  }
}
