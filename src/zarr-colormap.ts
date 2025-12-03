import { colormapBuilder } from "./jsColormaps";
import { mustCreateTexture } from "./webgl-utils";
import type { ColorMapName } from "./types";

function hexToRgb(hex: string): number[] {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const num = parseInt(cleaned, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return [r, g, b];
}

export function normalizeColormap(
  colormap: ColorMapName | number[][] | string[]
): number[][] {
  const isRgbArray = Array.isArray(colormap) && Array.isArray(colormap[0]);
  if (isRgbArray) {
    const first = (colormap as number[][])[0];
    const isNumberRow = Array.isArray(first) && typeof first[0] === "number";
    if (isNumberRow) {
      return colormap as number[][];
    }
  }
  if (Array.isArray(colormap) && typeof colormap[0] === "string") {
    return (colormap as string[]).map((hex) => hexToRgb(hex));
  }
  return colormapBuilder(colormap as ColorMapName) as number[][];
}

export class ColormapState {
  colors: number[][];
  floatData: Float32Array;
  length: number;
  texture: WebGLTexture | null = null;
  private dirty: boolean = true;

  constructor(colormap: ColorMapName | number[][] | string[]) {
    const { colors, floatData, length } = this.build(colormap);
    this.colors = colors;
    this.floatData = floatData;
    this.length = length;
    this.dirty = true;
  }

  apply(colormap: ColorMapName | number[][] | string[]) {
    const { colors, floatData, length } = this.build(colormap);
    this.colors = colors;
    this.floatData = floatData;
    this.length = length;
    this.dirty = true;
  }

  ensureTexture(gl: WebGL2RenderingContext): WebGLTexture {
    if (!this.texture || this.dirty) {
      this.upload(gl);
    }
    return this.texture!;
  }

  upload(gl: WebGL2RenderingContext) {
    if (!this.texture) {
      this.texture = mustCreateTexture(gl);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB16F,
      this.length,
      1,
      0,
      gl.RGB,
      gl.FLOAT,
      this.floatData
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.dirty = false;
  }

  dispose(gl: WebGL2RenderingContext) {
    if (this.texture) {
      gl.deleteTexture(this.texture);
      this.texture = null;
    }
  }

  private build(colormap: ColorMapName | number[][] | string[]) {
    const colors = normalizeColormap(colormap);
    const floatData = new Float32Array(colors.flat().map((v) => v / 255.0));
    return { colors, floatData, length: colors.length };
  }
}
