import type { Selector } from '../types'

/**
 * Nested values structure for multi-dimensional data queries.
 */
export interface NestedValues {
  [key: string]: number[] | NestedValues
  [key: number]: number[] | NestedValues
}

/**
 * Values from a data query. Can be flat array or nested when selector has array values.
 *
 * Flat: `number[]` when selector = `{ month: 1 }`
 * Nested: `{ 1: number[], 2: number[] }` when selector = `{ month: [1, 2] }`
 */
export type QueryDataValues = number[] | NestedValues

/**
 * Result from a data query (point or region).
 * Matches carbonplan/maps structure: { [variable]: values, dimensions, coordinates }
 */
export interface QueryDataResult {
  /** Variable name mapped to its values (flat array or nested based on selector) */
  [variable: string]:
    | QueryDataValues
    | string[]
    | { [key: string]: (number | string)[] }
  /** Dimension names in order (e.g., ['month', 'lat', 'lon']) */
  dimensions: string[]
  /** Coordinate arrays for each dimension */
  coordinates: {
    lat: number[]
    lon: number[]
    [key: string]: (number | string)[]
  }
}

/**
 * Selector for region queries - can override the layer's render selector.
 * Mirrors the public Selector type to keep query inputs consistent.
 */
export type QuerySelector = Selector

/**
 * Internal structure for point values during region iteration.
 * Used to build nested result structures.
 */
export interface PointValueEntry {
  /** Dimension keys for nested placement (empty for flat results) */
  keys: (string | number)[]
  /** The data value */
  value: number
}

/**
 * Bounding box for a geographic region.
 */
export interface BoundingBox {
  west: number
  east: number
  south: number
  north: number
}

/**
 * GeoJSON Point geometry.
 */
export interface GeoJSONPoint {
  type: 'Point'
  coordinates: [number, number]
}

/**
 * GeoJSON Polygon geometry.
 */
export interface GeoJSONPolygon {
  type: 'Polygon'
  coordinates: number[][][]
}

/**
 * GeoJSON MultiPolygon geometry.
 */
export interface GeoJSONMultiPolygon {
  type: 'MultiPolygon'
  coordinates: number[][][][]
}

/**
 * Supported GeoJSON geometry types for polygon-based queries.
 */
export type QueryGeometry = GeoJSONPolygon | GeoJSONMultiPolygon

/**
 * Supported GeoJSON geometry types for data queries.
 */
export type QueryDataGeometry =
  | GeoJSONPoint
  | GeoJSONPolygon
  | GeoJSONMultiPolygon
