type ColormapArray = number[][] | string[];
interface DimensionNamesProps {
    time?: string;
    elevation?: string;
    lat?: string;
    lon?: string;
    others?: string[];
}
interface ZarrLayerOptions {
    id: string;
    source: string;
    variable: string;
    selector?: Record<string, number | number[] | string | string[]>;
    colormap: ColormapArray;
    clim: [number, number];
    opacity?: number;
    minRenderZoom?: number;
    zarrVersion?: 2 | 3;
    dimensionNames?: DimensionNamesProps;
    fillValue?: number;
    customFragmentSource?: string;
    customFrag?: string;
    uniforms?: Record<string, number>;
    renderingMode?: '2d' | '3d';
}

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
    private maxZoom;
    private tileSize;
    private isMultiscale;
    private fillValue;
    private scaleFactor;
    private offset;
    private gl;
    private map;
    private renderer;
    private dataManager;
    private applyWorldCopiesSetting;
    private initialRenderWorldCopies;
    private projectionChangeHandler;
    private resolveGl;
    private zarrStore;
    private levelInfos;
    private levelMetadata;
    private dimIndices;
    private xyLimits;
    private crs;
    private dimensionValues;
    private selectors;
    private isRemoved;
    private fragmentShaderSource;
    private customFrag;
    private customUniforms;
    private bandNames;
    private customShaderConfig;
    private isGlobeProjection;
    constructor({ id, source, variable, selector, colormap, clim, opacity, minRenderZoom, zarrVersion, dimensionNames, fillValue, customFragmentSource, customFrag, uniforms, renderingMode, }: ZarrLayerOptions);
    setOpacity(opacity: number): void;
    setClim(clim: [number, number]): void;
    setColormap(colormap: ColormapArray): void;
    setUniforms(uniforms: Record<string, number>): void;
    setVariable(variable: string): Promise<void>;
    setSelector(selector: Record<string, number | number[] | string | string[]>): Promise<void>;
    onAdd(map: any, gl: WebGL2RenderingContext): Promise<void>;
    private initializeManager;
    private initialize;
    private loadInitialDimensionValues;
    private getWorldOffsets;
    private getSelectorHash;
    prerender(_gl: WebGL2RenderingContext | WebGLRenderingContext, _params: any): void;
    render(_gl: WebGL2RenderingContext | WebGLRenderingContext, params: any, projection?: {
        name: string;
    }, globeToMercatorMatrix?: number[] | Float32Array | Float64Array, transition?: number): void;
    onRemove(_map: any, gl: WebGL2RenderingContext): void;
}

export { type ColormapArray, type DimensionNamesProps, ZarrLayer, type ZarrLayerOptions };
