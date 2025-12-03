import * as zarr from "zarrita";
import { tileToKey, type TileTuple } from "./maplibre-utils";
import type { DimIndicesProps } from "./types";
import { ZarrStore } from "./zarr-store";

export interface TileDataCache {
  chunkData: Float32Array | null;
  chunkShape: number[] | null;
  chunkIndices?: number[];
  data: Float32Array | null;
  selectorHash: string | null;
  loading: boolean;
  lastUsed: number;
}

interface TilesOptions {
  store: ZarrStore;
  selectors: Record<string, any>;
  fillValue: number;
  dimIndices: DimIndicesProps;
  maxCachedTiles?: number;
}

export class Tiles {
  private store: ZarrStore;
  private selectors: Record<string, any>;
  private fillValue: number;
  private dimIndices: DimIndicesProps;
  private maxCachedTiles: number;
  private tiles: Map<string, TileDataCache> = new Map();
  private accessOrder: string[] = [];

  constructor({
    store,
    selectors,
    fillValue,
    dimIndices,
    maxCachedTiles = 64,
  }: TilesOptions) {
    this.store = store;
    this.selectors = selectors;
    this.fillValue = fillValue;
    this.dimIndices = dimIndices;
    this.maxCachedTiles = maxCachedTiles;
  }

  updateSelector(selectors: Record<string, any>) {
    this.selectors = selectors;
  }

  private getDimKeyForName(dimName: string): string {
    const lower = dimName.toLowerCase();
    if (["lat", "latitude", "y"].includes(lower)) return "lat";
    if (["lon", "longitude", "x", "lng"].includes(lower)) return "lon";
    if (["time", "t", "time_counter"].includes(lower)) return "time";
    if (["depth", "z", "level", "lev", "elevation"].includes(lower))
      return "elevation";
    return dimName;
  }

  private arraysEqual(a: number[] | undefined, b: number[] | undefined) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  private computeChunkIndices(
    levelArray: zarr.Array<any>,
    tileTuple: TileTuple
  ): number[] {
    const [_, x, y] = tileTuple;
    const dimensions = this.store.dimensions || [];
    const chunks = levelArray.chunks;
    const chunkIndices: number[] = new Array(dimensions.length).fill(0);

    for (let i = 0; i < dimensions.length; i++) {
      const dimName = dimensions[i];
      const dimKey = this.getDimKeyForName(dimName);

      if (dimKey === "lon") {
        chunkIndices[i] = x;
      } else if (dimKey === "lat") {
        chunkIndices[i] = y;
      } else {
        const dimSelection =
          this.selectors[dimKey] ??
          this.selectors[dimName] ??
          this.selectors[this.dimIndices[dimKey]?.name];
        let idx = 0;
        if (dimSelection !== undefined) {
          idx =
            typeof dimSelection === "object"
              ? (dimSelection.selected as number)
              : dimSelection;
        }
        idx = Math.max(0, Math.min(idx, levelArray.shape[i] - 1));
        const chunkIdx = Math.floor(idx / chunks[i]);
        const maxChunkIdx = Math.max(
          0,
          Math.ceil(levelArray.shape[i] / chunks[i]) - 1
        );
        chunkIndices[i] = Math.min(chunkIdx, maxChunkIdx);
      }
    }

    return chunkIndices;
  }

  private extractSliceFromChunk(
    chunkData: Float32Array,
    chunkShape: number[],
    levelArray: zarr.Array<any>,
    chunkIndices: number[]
  ): Float32Array {
    const tileWidth = this.store.tileSize;
    const tileHeight = this.store.tileSize;
    const paddedData = new Float32Array(tileWidth * tileHeight);
    paddedData.fill(this.fillValue);

    const dimensions = this.store.dimensions || [];
    const chunkSizes = levelArray.chunks;

    const selectorIndices: number[] = [];
    let latDimIdx = -1;
    let lonDimIdx = -1;
    let latSize = tileHeight;
    let lonSize = tileWidth;

    for (let i = 0; i < dimensions.length; i++) {
      const dimName = dimensions[i];
      const dimKey = this.getDimKeyForName(dimName);

      if (dimKey === "lat") {
        latDimIdx = i;
        latSize = Math.min(chunkShape[i], tileHeight);
        selectorIndices.push(-1);
      } else if (dimKey === "lon") {
        lonDimIdx = i;
        lonSize = Math.min(chunkShape[i], tileWidth);
        selectorIndices.push(-1);
      } else {
        let idx = 0;
        const dimSelection =
          this.selectors[dimKey] ??
          this.selectors[dimName] ??
          this.selectors[this.dimIndices[dimKey]?.name];
        if (dimSelection !== undefined) {
          idx =
            typeof dimSelection === "object"
              ? (dimSelection.selected as number)
              : dimSelection;
        }
        const chunkOffset = chunkIndices[i] * chunkSizes[i];
        idx = Math.max(0, idx - chunkOffset);
        idx = Math.max(0, Math.min(idx, chunkShape[i] - 1));
        selectorIndices.push(idx);
      }
    }

    const getChunkIndex = (indices: number[]): number => {
      let idx = 0;
      let stride = 1;
      for (let i = indices.length - 1; i >= 0; i--) {
        idx += indices[i] * stride;
        stride *= chunkShape[i];
      }
      return idx;
    };

    for (let latIdx = 0; latIdx < latSize; latIdx++) {
      for (let lonIdx = 0; lonIdx < lonSize; lonIdx++) {
        const indices = [...selectorIndices];
        if (latDimIdx >= 0) indices[latDimIdx] = latIdx;
        if (lonDimIdx >= 0) indices[lonDimIdx] = lonIdx;

        const srcIdx = getChunkIndex(indices);
        const dstIdx = latIdx * tileWidth + lonIdx;

        if (srcIdx < chunkData.length) {
          paddedData[dstIdx] = chunkData[srcIdx];
        }
      }
    }

    return paddedData;
  }

  private getOrCreateTile(tileKey: string): TileDataCache {
    let tile = this.tiles.get(tileKey);
    if (!tile) {
      tile = {
        chunkData: null,
        chunkShape: null,
        chunkIndices: undefined,
        data: null,
        selectorHash: null,
        loading: false,
        lastUsed: Date.now(),
      };
      this.tiles.set(tileKey, tile);
      this.accessOrder.push(tileKey);
      this.evictOldTiles();
    } else {
      tile.lastUsed = Date.now();
      const idx = this.accessOrder.indexOf(tileKey);
      if (idx > -1) {
        this.accessOrder.splice(idx, 1);
        this.accessOrder.push(tileKey);
      }
    }
    return tile;
  }

  private evictOldTiles() {
    while (this.tiles.size > this.maxCachedTiles) {
      const oldestKey = this.accessOrder.shift();
      if (!oldestKey) break;
      this.tiles.delete(oldestKey);
    }
  }

  getTile(tileTuple: TileTuple): TileDataCache | undefined {
    return this.tiles.get(tileToKey(tileTuple));
  }

  async reextractTileSlices(
    visibleTiles: TileTuple[],
    selectorHash: string
  ): Promise<void> {
    for (const tileTuple of visibleTiles) {
      const tileKey = tileToKey(tileTuple);
      const tile = this.tiles.get(tileKey);
      if (!tile) continue;
      const levelPath = this.store.levels[tileTuple[0]];
      if (!levelPath) continue;
      const levelArray = await this.store.getLevelArray(levelPath);
      const desiredChunkIndices = this.computeChunkIndices(levelArray, tileTuple);
      const canReuseChunk =
        tile.chunkData &&
        tile.chunkShape &&
        this.arraysEqual(tile.chunkIndices, desiredChunkIndices);
      if (canReuseChunk) {
        tile.data = this.extractSliceFromChunk(
          tile.chunkData!,
          tile.chunkShape!,
          levelArray,
          desiredChunkIndices
        );
        tile.selectorHash = selectorHash;
      } else {
        tile.data = null;
        tile.selectorHash = null;
        tile.chunkData = null;
        tile.chunkShape = null;
        tile.chunkIndices = undefined;
      }
    }
  }

  async fetchTile(
    tileTuple: TileTuple,
    selectorHash: string
  ): Promise<TileDataCache | null> {
    const [z] = tileTuple;
    const levelPath = this.store.levels[z];
    if (!levelPath) return null;

    const levelArray = await this.store.getLevelArray(levelPath);
    const tileKey = tileToKey(tileTuple);
    const tile = this.getOrCreateTile(tileKey);

    if (tile.data && tile.selectorHash === selectorHash) {
      return tile;
    }
    if (tile.loading) return null;

    tile.loading = true;

    try {
      const chunkIndices = this.computeChunkIndices(levelArray, tileTuple);
      const canReuseChunk =
        tile.chunkData &&
        tile.chunkShape &&
        this.arraysEqual(tile.chunkIndices, chunkIndices);

      if (canReuseChunk) {
        tile.data = this.extractSliceFromChunk(
          tile.chunkData!,
          tile.chunkShape!,
          levelArray,
          chunkIndices
        );
        tile.selectorHash = selectorHash;
        tile.loading = false;
        return tile;
      }

      const chunk = await this.store.getChunk(levelPath, chunkIndices);
      const chunkShape = (chunk.shape as number[]).map((n) => Number(n));
      const chunkData =
        chunk.data instanceof Float32Array
          ? new Float32Array(chunk.data.buffer)
          : Float32Array.from(chunk.data as any);

      tile.chunkData = chunkData;
      tile.chunkShape = chunkShape;
      tile.chunkIndices = chunkIndices;
      tile.data = this.extractSliceFromChunk(
        chunkData,
        chunkShape,
        levelArray,
        chunkIndices
      );
      tile.selectorHash = selectorHash;
      tile.loading = false;
      return tile;
    } catch (err) {
      console.error("Error fetching tile data:", err);
      tile.loading = false;
      return null;
    }
  }
}
