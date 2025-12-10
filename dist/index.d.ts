type ColormapArray = number[][] | string[];
type SelectorValue = number | number[] | string | string[] | [number, number];
interface ZarrSelectorsProps {
    selected: SelectorValue;
    type?: 'index' | 'value';
}
interface DimensionNamesProps {
    time?: string;
    elevation?: string;
    lat?: string;
    lon?: string;
    others?: string[];
}
interface LoadingState {
    loading: boolean;
    metadata: boolean;
    chunks: boolean;
}
type LoadingStateCallback = (state: LoadingState) => void;
interface ZarrLayerOptions {
    id: string;
    source: string;
    variable: string;
    selector?: Record<string, number | number[] | string | string[] | ZarrSelectorsProps>;
    colormap: ColormapArray;
    clim: [number, number];
    opacity?: number;
    minRenderZoom?: number;
    zarrVersion?: 2 | 3;
    dimensionNames?: DimensionNamesProps;
    fillValue?: number;
    customFrag?: string;
    uniforms?: Record<string, number>;
    renderingMode?: '2d' | '3d';
    onLoadingStateChange?: LoadingStateCallback;
}
interface BoundsLike {
    getWest(): number;
    getEast(): number;
    toArray(): [[number, number], [number, number]];
}
interface MapLike {
    getProjection?(): {
        type?: string;
        name?: string;
    } | null;
    getRenderWorldCopies?(): boolean;
    on?(event: string, handler: (...args: unknown[]) => void): void;
    off?(event: string, handler: (...args: unknown[]) => void): void;
    triggerRepaint?(): void;
    getBounds?(): BoundsLike | null;
    getZoom?(): number;
    painter?: {
        context?: {
            gl?: unknown;
        };
    };
    renderer?: {
        getContext?: () => unknown;
    };
}

/**
 * Result from a point query at a specific geographic location.
 */
interface PointQueryResult {
    /** The queried longitude */
    lng: number;
    /** The queried latitude */
    lat: number;
    /** Primary value at the point (or null if no data) */
    value: number | null;
    /** Values per band if multi-band data */
    bandValues?: Record<string, number | null>;
    /** Tile coordinates where the data was found */
    tile?: {
        z: number;
        x: number;
        y: number;
    };
    /** Pixel coordinates within the tile */
    pixel?: {
        x: number;
        y: number;
    };
}
/**
 * Nested values structure for multi-dimensional region queries.
 */
interface NestedValues {
    [key: string]: number[] | NestedValues;
    [key: number]: number[] | NestedValues;
}
/**
 * Values from a region query. Can be flat array or nested when selector has array values.
 *
 * Flat: `number[]` when selector = `{ month: 1 }`
 * Nested: `{ 1: number[], 2: number[] }` when selector = `{ month: [1, 2] }`
 */
type RegionValues = number[] | NestedValues;
/**
 * Result from a region query within a geographic polygon.
 * Matches carbonplan/maps structure: { [variable]: values, dimensions, coordinates }
 */
interface RegionQueryResult {
    /** Variable name mapped to its values (flat array or nested based on selector) */
    [variable: string]: RegionValues | string[] | {
        [key: string]: (number | string)[];
    };
    /** Dimension names in order (e.g., ['month', 'lat', 'lon']) */
    dimensions: string[];
    /** Coordinate arrays for each dimension */
    coordinates: {
        lat: number[];
        lon: number[];
        [key: string]: (number | string)[];
    };
}
/**
 * Selector for region queries - controls which tiles/slices to load.
 * Can override the layer's render selector.
 */
type QuerySelector = Record<string, number | number[] | string | string[] | ZarrSelectorsProps>;
/**
 * Bounding box for a geographic region.
 */
interface BoundingBox {
    west: number;
    east: number;
    south: number;
    north: number;
}
/**
 * GeoJSON Polygon geometry.
 */
interface GeoJSONPolygon {
    type: 'Polygon';
    coordinates: number[][][];
}
/**
 * GeoJSON MultiPolygon geometry.
 */
interface GeoJSONMultiPolygon {
    type: 'MultiPolygon';
    coordinates: number[][][][];
}
/**
 * Supported GeoJSON geometry types for region queries.
 */
type QueryGeometry = GeoJSONPolygon | GeoJSONMultiPolygon;

/**
 * @module zarr-layer
 *
 * MapLibre/MapBox custom layer implementation for rendering Zarr datasets.
 * Implements CustomLayerInterface for direct WebGL rendering.
 */

declare class ZarrLayer {
    readonly type: 'custom';
    readonly renderingMode: '2d' | '3d';
    id: string;
    private url;
    private variable;
    private zarrVersion;
    private dimensionNames;
    private selector;
    private invalidate;
    private colormap;
    private clim;
    private opacity;
    private minRenderZoom;
    private selectorHash;
    private isMultiscale;
    private _fillValue;
    private scaleFactor;
    private offset;
    private gl;
    private map;
    private renderer;
    private mode;
    private tileNeedsRender;
    private projectionChangeHandler;
    private resolveGl;
    private zarrStore;
    private levelInfos;
    private dimIndices;
    private dimensionValues;
    private selectors;
    private isRemoved;
    private fragmentShaderSource;
    private customFrag;
    private customUniforms;
    private bandNames;
    private customShaderConfig;
    private onLoadingStateChange;
    private metadataLoading;
    private chunksLoading;
    get fillValue(): number | null;
    private isGlobeProjection;
    constructor({ id, source, variable, selector, colormap, clim, opacity, minRenderZoom, zarrVersion, dimensionNames, fillValue, customFrag, uniforms, renderingMode, onLoadingStateChange, }: ZarrLayerOptions);
    private emitLoadingState;
    private handleChunkLoadingChange;
    setOpacity(opacity: number): void;
    setClim(clim: [number, number]): void;
    setColormap(colormap: ColormapArray): void;
    setUniforms(uniforms: Record<string, number>): void;
    setVariable(variable: string): Promise<void>;
    setSelector(selector: Record<string, number | number[] | string | string[] | ZarrSelectorsProps>): Promise<void>;
    onAdd(map: MapLike, gl: WebGL2RenderingContext | null): Promise<void>;
    private computeSelectorHash;
    private initializeMode;
    private initialize;
    private loadInitialDimensionValues;
    prerender(_gl: WebGL2RenderingContext, _params: unknown): void;
    render(_gl: WebGL2RenderingContext, params: unknown, projection?: {
        name: string;
    }, projectionToMercatorMatrix?: number[] | Float32Array | Float64Array, projectionToMercatorTransition?: number, _centerInMercator?: number[], _pixelsPerMeterRatio?: number): void;
    renderToTile(_gl: WebGL2RenderingContext, tileId: {
        z: number;
        x: number;
        y: number;
    }): void;
    shouldRerenderTiles(): boolean;
    onRemove(_map: MapLike, gl: WebGL2RenderingContext): void;
    /**
     * Query the data value at a geographic point.
     * @param lng - Longitude in degrees.
     * @param lat - Latitude in degrees.
     * @returns Promise resolving to the query result.
     */
    queryPoint(lng: number, lat: number): Promise<PointQueryResult>;
    /**
     * Query all data values within a geographic region.
     * @param geometry - GeoJSON Polygon or MultiPolygon geometry.
     * @param selector - Optional selector to override the layer's selector.
     * @returns Promise resolving to the query result matching carbonplan/maps structure.
     */
    queryRegion(geometry: QueryGeometry, selector?: QuerySelector): Promise<RegionQueryResult>;
}

/**
 * @module query-utils
 *
 * Utility functions for query coordinate transformations,
 * mercator corrections, and point-in-polygon tests.
 */

/**
 * Converts latitude to normalized mercator Y coordinate [0, 1].
 * This is the carbonplan/maps formula for latitude correction.
 *
 * From carbonplan/maps src/utils.js:81-88
 */
declare function mercatorYFromLat(lat: number): number;

export { type BoundingBox, type ColormapArray, type DimensionNamesProps, type GeoJSONMultiPolygon, type GeoJSONPolygon, type LoadingState, type LoadingStateCallback, type PointQueryResult, type QueryGeometry, type QuerySelector, type RegionQueryResult, type RegionValues, ZarrLayer, type ZarrLayerOptions, mercatorYFromLat };
