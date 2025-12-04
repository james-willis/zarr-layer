/**
 * @module zarr-utils
 *
 * Utility functions for reading, interpreting, and slicing Zarr datasets
 * used by Cesium visualization components (e.g., {@link ZarrCubeProvider},
 * {@link ZarrCubeVelocityProvider}, {@link ZarrLayerProvider}).
 *
 * Provides:
 * - Dimension detection and CF-compliant alias mapping
 * - Slice generation for multidimensional Zarr arrays
 * - Multiscale (pyramidal) dataset handling
 * - CRS detection and coordinate transformation utilities
 * - Calculation of vertical exaggeration and Cesium-compatible XY indices
 */

import * as zarr from 'zarrita'
import {
  type ZarrSelectorsProps,
  type ZarrLevelMetadata,
  type DimensionNamesProps,
  type XYLimitsProps,
  type CRS,
  type DimIndicesProps,
} from './types'

type CoordinateArray = zarr.Array<zarr.DataType> & {
  attrs?: Record<string, unknown>
}
type CoordinatesMap = Record<string, CoordinateArray>
type Multiscale = { datasets?: Array<{ path: string; crs?: CRS }> }

const resolveOpenFunc = (zarrVersion: 2 | 3 | null): typeof zarr.open => {
  if (zarrVersion === 2) return zarr.open.v2 as typeof zarr.open
  if (zarrVersion === 3) return zarr.open.v3 as typeof zarr.open
  return zarr.open
}

const DIMENSION_ALIASES_DEFAULT: {
  [key in keyof DimensionNamesProps]: string[]
} = {
  lat: ['lat', 'latitude', 'y', 'Latitude', 'Y'],
  lon: ['lon', 'longitude', 'x', 'Longitude', 'X', 'lng'],
  time: ['time', 't', 'Time', 'time_counter'],
  elevation: [
    'depth',
    'z',
    'Depth',
    'level',
    'lev',
    'deptht',
    'elevation',
    'depthu',
    'depthv',
    'depthv',
  ],
}

const CF_MAPPINGS: { [key in keyof DimensionNamesProps]: string[] } = {
  lat: ['latitude'],
  lon: ['longitude'],
  time: ['time'],
  elevation: [
    'height',
    'depth',
    'altitude',
    'air_pressure',
    'pressure',
    'geopotential_height',
  ],
} as const

/**
 * Identify the indices of common dimensions (lat, lon, time, elevation)
 * in a Zarr array, optionally using CF-compliant standard names or custom dimension mappings.
 *
 * @param dimNames - Names of the array dimensions.
 * @param dimensionNames - Optional explicit mapping of dimension names (see {@link DimensionNamesProps}).
 * @param coordinates - Optional coordinate variable dictionary.
 * @returns A {@link DimIndicesProps} object describing each dimension’s index and name.
 */
export function identifyDimensionIndices(
  dimNames: string[],
  dimensionNames?: DimensionNamesProps,
  coordinates?: CoordinatesMap
): DimIndicesProps {
  let DIMENSION_ALIASES = { ...DIMENSION_ALIASES_DEFAULT }
  const names = ['lat', 'lon', 'time', 'elevation']

  if (coordinates) {
    Object.keys(coordinates).forEach((coordName) => {
      const coordArr = coordinates[coordName]
      const coordAttrs = (coordArr.attrs ?? {}) as Record<string, unknown>
      const standardName =
        typeof coordAttrs?.standard_name === 'string'
          ? coordAttrs.standard_name
          : undefined
      if (standardName) {
        for (const [dimKey, cfNames] of Object.entries(CF_MAPPINGS)) {
          if (cfNames.includes(standardName)) {
            DIMENSION_ALIASES[dimKey as keyof DimensionNamesProps] = [coordName]
          }
        }
      }
    })
  }

  if (dimensionNames) {
    names.forEach((name) => {
      const dimName = name as keyof DimensionNamesProps
      if (dimensionNames[dimName]) {
        DIMENSION_ALIASES[dimName] = [dimensionNames[dimName]] as string[]
      }
    })
    if (dimensionNames.others) {
      dimensionNames.others.forEach((otherName) => {
        DIMENSION_ALIASES[otherName as keyof DimensionNamesProps] = [otherName]
      })
    }
  }

  const indices: DimIndicesProps = {}
  for (const [key, aliases] of Object.entries(DIMENSION_ALIASES)) {
    for (let i = 0; i < dimNames.length; i++) {
      const name = dimNames[i].toLowerCase()
      if (aliases.map((a) => a.toLowerCase()).includes(name)) {
        indices[key] = {
          name,
          index: i,
          array: coordinates ? coordinates[dimNames[i]] : null,
        }
        break
      }
    }
  }
  return indices
}

/**
 * Finds the index of the value in `values` nearest to `target`.
 * @param values - Array of numeric values.
 * @param target - Target value to find.
 * @returns Index of the nearest value.
 */
export function calculateNearestIndex(
  values: Float64Array | number[],
  target: number
): number {
  const selectedValue = target
  let nearestIdx = 0
  let minDiff = Infinity
  values.forEach((val, i) => {
    const diff = Math.abs(val - selectedValue)
    if (diff < minDiff) {
      minDiff = diff
      nearestIdx = i
    }
  })
  return nearestIdx
}

/**
 * Loads the coordinate values for a specific dimension.
 *
 * Behavior:
 * - Uses cached values if available (does not reload unless the caller resets the cache).
 * - Resolves the correct multiscale level if `levelInfo` is provided.
 * - Converts Zarr buffers into plain JavaScript number arrays.
 * - Converts bigint values to number.
 * - If a slice `[start, end]` is supplied, only a sub-range is returned.
 *
 * @param dimensionValues  Cache of already-loaded coordinate arrays.
 * @param levelInfo        Optional multiscale subpath.
 * @param dimIndices      Dimension index info. See {@link DimIndicesProps}.
 * @param root            Root Zarr group location.
 * @param zarrVersion     Zarr version (2 or 3).
 * @param slice           Optional index range `[start, end]` to slice the loaded values.
 *
 * @returns The loaded coordinate array for the dimension.
 */
export async function loadDimensionValues(
  dimensionValues: Record<string, Float64Array | number[]>,
  levelInfo: string | null,
  dimIndices: DimIndicesProps[string],
  root: zarr.Location<zarr.FetchStore>,
  zarrVersion: 2 | 3 | null,
  slice?: [number, number]
): Promise<Float64Array | number[]> {
  if (dimensionValues[dimIndices.name]) return dimensionValues[dimIndices.name]
  let targetRoot
  if (levelInfo) {
    targetRoot = await root.resolve(levelInfo)
  } else {
    targetRoot = root
  }
  let coordArr
  if (dimIndices.array) {
    coordArr = dimIndices.array
  } else {
    const coordVar = await targetRoot.resolve(dimIndices.name)
    const localFunc = resolveOpenFunc(zarrVersion)
    coordArr = await localFunc(coordVar, { kind: 'array' })
  }
  const coordData = await zarr.get(coordArr)
  const coordArray = Array.from(
    coordData.data as ArrayLike<number | bigint>,
    (v: number | bigint) => (typeof v === 'bigint' ? Number(v) : v)
  )
  if (slice) {
    return coordArray.slice(slice[0], slice[1])
  }
  return coordArray
}

/**
 * Opens a Zarr variable (single-scale or multiscale pyramid) and prepares its metadata.
 *
 * - Detects and loads multiscale dataset levels (if present).
 * - Computes per-level dimension sizes and stores them in `levelMetadata`.
 * - Scans coordinate variables from `_ARRAY_DIMENSIONS` or consolidated metadata.
 * - Detects CF/alias-based dimension names (lat/lon/time/elevation).
 *
 * @param store             Zarr store (e.g., `FetchStore`).
 * @param root              Root Zarr group location.
 * @param variable          Variable name within the Zarr group.
 * @param dimensions        Optional explicit dimension name mapping. See {@link DimensionNamesProps}.
 * @param levelMetadata     Map to populate with per-level metadata (width/height).
 * @param levelCache        Cache for opened multiscale level arrays.
 * @param zarrVersion      Zarr version (2 or 3).
 * @param multiscaleLevel   Optional initial multiscale level to open.
 *
 * @returns
 *   - `zarrArray` — the opened array for the selected multiscale level.
 *   - `levelInfos` — all multiscale level paths.
 *   - `dimIndices` — discovered dimension index mapping. See {@link DimIndicesProps}.
 *   - `attrs` — variable or group attributes.
 *   - `multiscaleLevel` — updated level if adjusted due to missing levels.
 */
export async function initZarrDataset(
  store: zarr.FetchStore,
  root: zarr.Location<zarr.FetchStore>,
  variable: string,
  dimensions: DimensionNamesProps,
  levelMetadata: Map<number, ZarrLevelMetadata>,
  levelCache: Map<number, zarr.Array<zarr.DataType>>,
  zarrVersion: 2 | 3 | null,
  multiscaleLevel?: number
): Promise<{
  zarrArray: zarr.Array<zarr.DataType>
  levelInfos: string[]
  dimIndices: DimIndicesProps
  attrs: Record<string, unknown>
  multiscaleLevel?: number
}> {
  const localFunc = resolveOpenFunc(zarrVersion)
  const zarrGroup = await localFunc(root, { kind: 'group' })
  const attrs = (zarrGroup.attrs ?? {}) as Record<string, unknown>
  let zarrArray: zarr.Array<zarr.DataType> | null = null
  let levelInfos: string[] = []
  let coordinates: CoordinatesMap = {}
  let datasets: Array<{ path: string; crs?: CRS }> = []
  let pyramidMode = false
  const multiscales = Array.isArray(
    (attrs as { multiscales?: unknown }).multiscales
  )
    ? ((attrs as { multiscales?: unknown }).multiscales as Multiscale[])
    : undefined

  if (
    multiscales &&
    multiscales[0] &&
    Array.isArray(multiscales[0].datasets) &&
    multiscales[0].datasets.length
  ) {
    pyramidMode = true
    datasets = multiscales[0].datasets || []
    if (multiscaleLevel) datasets = [datasets[multiscaleLevel]]

    for (let i = 0; i < datasets.length; i++) {
      const levelPath = datasets[i].path
      levelInfos.push(levelPath)
      const levelArr = await openLevelArray(
        root,
        levelPath,
        variable,
        levelCache
      )

      const levelRoot = await root.resolve(levelPath)
      const { existingCoordinates, array_dimensions } =
        await calculateCoordinatesFromAttrs(
          levelArr,
          levelRoot,
          coordinates,
          store,
          variable,
          zarrVersion,
          pyramidMode
        )
      coordinates = existingCoordinates
      const dims = identifyDimensionIndices(
        array_dimensions,
        dimensions,
        coordinates
      )

      const width = levelArr.shape[dims.lon.index]
      const height = levelArr.shape[dims.lat.index]

      levelMetadata.set(i, { width, height })
    }
    if (multiscaleLevel) {
      datasets = multiscales[0].datasets || []
      levelInfos = []
      for (let i = 0; i < datasets.length; i++) {
        levelInfos.push(datasets[i].path)
      }
    }
    let levelInfo = levelInfos[multiscaleLevel || 0]
    if (!levelInfo) {
      console.error(
        'No level info found for multiscale level:',
        multiscaleLevel,
        '. Using 0 instead.'
      )
      multiscaleLevel = 0
      levelInfo = levelInfos[multiscaleLevel]
    }
    zarrArray = await openLevelArray(root, levelInfo, variable, levelCache)
  } else {
    const arrayLocation = await root.resolve(variable)
    const openFunc = resolveOpenFunc(zarrVersion)
    zarrArray = await openFunc(arrayLocation, { kind: 'array' })
  }
  if (!zarrArray) {
    throw new Error('Failed to initialize Zarr array')
  }
  const { existingCoordinates, array_dimensions } =
    await calculateCoordinatesFromAttrs(
      zarrArray,
      root,
      coordinates,
      store,
      variable,
      zarrVersion,
      pyramidMode
    )
  const dimIndices = await identifyDimensionIndices(
    array_dimensions,
    dimensions,
    existingCoordinates
  )
  return {
    zarrArray,
    levelInfos,
    dimIndices,
    attrs,
    multiscaleLevel,
  }
}

/**
 * Retrieves coordinate arrays from `_ARRAY_DIMENSIONS` attributes in the Zarr array metadata.
 * Reuses existing coordinates if already computed.
 *
 * @param arr - Zarr array.
 * @param root - Zarr group root.
 * @param existingCoordinates - Already loaded coordinate arrays.
 * @param store - Zarr store.
 * @param variable - Variable name.
 * @param zarrVersion - Zarr version (2 or 3).
 * @param isPyramid - Whether the dataset is multiscale.
 *
 * @returns An object containing:
 * - `existingCoordinates`: Loaded coordinate arrays.
 * - `array_dimensions`: Names of the array dimensions.
 */
async function calculateCoordinatesFromAttrs(
  arr: zarr.Array<zarr.DataType>,
  root: zarr.Location<zarr.FetchStore>,
  existingCoordinates: CoordinatesMap,
  store: zarr.FetchStore,
  variable: string,
  zarrVersion: 2 | 3 | null,
  isPyramid: boolean = false
): Promise<{
  existingCoordinates: CoordinatesMap
  array_dimensions: string[]
}> {
  let array_dimensions: string[] =
    (arr.attrs['_ARRAY_DIMENSIONS'] as string[]) || []
  if (array_dimensions.length === 0) {
    const location = zarr.root(store)
    const rootMetadata = JSON.parse(
      new TextDecoder().decode(
        await store.get(location.resolve('zarr.json').path)
      )
    )
    if (isPyramid) {
      array_dimensions =
        rootMetadata.consolidated_metadata.metadata[`0/${variable}`][
          'dimension_names'
        ]
    } else {
      array_dimensions =
        rootMetadata.consolidated_metadata.metadata[variable]['dimension_names']
    }
  }
  if (Object.keys(existingCoordinates).length > 0)
    return { existingCoordinates, array_dimensions }

  for (let i = 0; i < array_dimensions.length; i++) {
    const dimName = array_dimensions[i]
    const coordVar = await root.resolve(dimName)
    const localFunc = resolveOpenFunc(zarrVersion)
    existingCoordinates[dimName] = await localFunc(coordVar, { kind: 'array' })
  }
  return { existingCoordinates, array_dimensions }
}

/**
 * Retrieve the geographic coordinate limits (min/max latitude/longitude) for a Zarr array.
 *
 * @param root - Zarr group root.
 * @param dimIndices - Dimension mapping. See {@link DimIndicesProps}.
 * @param levelInfos - Multiscale level paths.
 * @param multiscale - Whether the dataset is multiscale.
 * @param zarrVersion - Zarr version (2 or 3).
 *
 * @returns A {@link XYLimitsProps} object describing the coordinate bounds.
 */
export async function getXYLimits(
  root: zarr.Location<zarr.FetchStore>,
  dimIndices: DimIndicesProps,
  levelInfos: string[],
  multiscale: boolean,
  zarrVersion: 2 | 3 | null
): Promise<XYLimitsProps> {
  const levelRoot = multiscale ? await root.resolve(levelInfos[0]) : root
  const localFunc = resolveOpenFunc(zarrVersion)
  const xarr =
    dimIndices.lon.array ||
    (await localFunc(await levelRoot.resolve(dimIndices.lon.name), {
      kind: 'array',
    }))
  const yarr =
    dimIndices.lat.array ||
    (await localFunc(await levelRoot.resolve(dimIndices.lat.name), {
      kind: 'array',
    }))

  const xdata = await zarr.get(xarr)
  const ydata = await zarr.get(yarr)

  const xValues = Array.from(xdata.data as ArrayLike<number>)
  const yValues = Array.from(ydata.data as ArrayLike<number>)

  const xyLimits = {
    xMin: Math.min(...xValues),
    xMax: Math.max(...xValues),
    yMin: Math.min(...yValues),
    yMax: Math.max(...yValues),
  }
  return xyLimits
}

/**
 * Opens and caches a specific multiscale level array.
 * Keeps a small LRU-style cache of up to three levels.
 *
 * @param root        Zarr group root.
 * @param levelPath   Path to the multiscale level.
 * @param variable    Variable name within the level (if any).
 * @param levelCache Cache of opened level arrays.
 * @param zarrVersion Zarr version (2 or 3).
 *
 * @returns The opened Zarr array for the specified level.
 */
export async function openLevelArray(
  root: zarr.Location<zarr.FetchStore>,
  levelPath: string,
  variable: string,
  levelCache: Map<number, zarr.Array<zarr.DataType>>,
  zarrVersion: 2 | 3 | null = null
): Promise<zarr.Array<zarr.DataType>> {
  const existing = Array.from(levelCache.entries()).find(
    ([_, val]) => val.path === levelPath
  )
  if (existing) return existing[1]

  const levelRoot = await root.resolve(levelPath)
  const arrayLoc = variable ? await levelRoot.resolve(variable) : levelRoot
  const localFunc = resolveOpenFunc(zarrVersion)
  const arr = await localFunc(arrayLoc, { kind: 'array' })

  const levelIndex = levelCache.size
  levelCache.set(levelIndex, arr)
  if (levelCache.size > 3) {
    const firstKey = levelCache.keys().next().value as number
    levelCache.delete(firstKey)
  }

  return arr
}

/**
 * Extracts no-data related metadata from a Zarr array's attributes.
 *
 * Looks for standard NetCDF attributes (`valid_min`, `valid_max`, `_FillValue`, `missing_value`).
 *
 * @param zarrArray - Zarr array to extract metadata from.
 *
 * @returns An object containing:
 *   - `metadataMin`: Valid minimum value (if any).
 *   - `metadataMax`: Valid maximum value (if any).
 *   - `fillValue`: Exact fill/missing value (if any).
 *   - `useFillValue`: Whether to apply exact masking based on fill value.
 */
export function extractNoDataMetadata(
  zarrArray: zarr.Array<zarr.DataType>
): {
  metadataMin: number | undefined
  metadataMax: number | undefined
  fillValue: number | undefined
  useFillValue: boolean
} {
  const attrs = (zarrArray.attrs ?? {}) as Record<string, unknown>

  let metadataMin: number | undefined = undefined
  let metadataMax: number | undefined = undefined
  let fillValue: number | undefined = undefined
  let useFillValue = false

  if (attrs.valid_min !== undefined) metadataMin = attrs.valid_min as number
  if (attrs.valid_max !== undefined) metadataMax = attrs.valid_max as number

  if (attrs._FillValue !== undefined) {
    fillValue = attrs._FillValue as number
    useFillValue = true
  } else if (attrs.missing_value !== undefined) {
    fillValue = attrs.missing_value as number
    useFillValue = true
  }

  return { metadataMin, metadataMax, fillValue, useFillValue }
}

/**
 * Detects the coordinate reference system (CRS) of a Zarr dataset based on metadata or coordinate range.
 * Defaults to EPSG:4326 (WGS84) if uncertain.
 *
 * @param attrs - Zarr array or group attributes.
 * @param arr - Zarr array (may be null).
 * @param xyLimits - Optional geographic coordinate limits. See {@link XYLimitsProps}.
 * @returns Detected  CRS as a string (e.g., 'EPSG:4326' or 'EPSG:3857'. See {@link CRS}).
 */
export async function detectCRS(
  attrs: Record<string, unknown>,
  arr: zarr.Array<zarr.DataType> | null,
  xyLimits?: XYLimitsProps
): Promise<CRS> {
  const attrCRS =
    (Array.isArray((attrs as { multiscales?: unknown }).multiscales) &&
      (attrs as { multiscales: Multiscale[] }).multiscales[0]?.datasets?.[0]
        ?.crs) ??
    (arr?.attrs as Record<string, unknown> | undefined)?.crs
  if (attrCRS === 'EPSG:4326' || attrCRS === 'EPSG:3857') {
    return attrCRS
  }
  if (!xyLimits) {
    return 'EPSG:4326'
  }
  const xMax = xyLimits.xMax
  return xMax && Math.abs(xMax) > 360 ? 'EPSG:3857' : 'EPSG:4326'
}

export interface BandInfo {
  band: number | string
  index: number
}

export function getBandInformation(
  selector: Record<
    string,
    number | number[] | string | string[] | ZarrSelectorsProps
  >
): Record<string, BandInfo> {
  const result: Record<string, BandInfo> = {}

  for (const [key, value] of Object.entries(selector)) {
    if (Array.isArray(value)) {
      value.forEach((v, idx) => {
        const bandValue =
          typeof v === 'object' &&
          v !== null &&
          'selected' in v &&
          (v as { selected?: string | number }).selected !== undefined
            ? (v as { selected?: string | number }).selected!
            : v
        const bandName =
          typeof bandValue === 'string' ? bandValue : `${key}_${bandValue}`
        result[bandName] = { band: bandValue, index: idx }
      })
    }
  }

  return result
}

export function getBands(
  variable: string,
  selector: Record<
    string,
    number | number[] | string | string[] | ZarrSelectorsProps
  >
): string[] {
  const bandInfo = getBandInformation(selector)
  const bandNames = Object.keys(bandInfo)

  if (bandNames.length === 0) {
    return [variable]
  }

  return bandNames
}
