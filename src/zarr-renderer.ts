import {
  createProgram,
  createShader,
  mustCreateBuffer,
  mustCreateFramebuffer,
  mustGetUniformLocation,
} from './webgl-utils'
import {
  maplibreVertexShaderSource,
  renderFragmentShaderSource,
  renderVertexShaderSource,
} from './maplibre-shaders'
import { tileToKey, tileToScale, type TileTuple } from './maplibre-utils'
import type { MercatorBounds } from './maplibre-utils'
import type { TileRenderCache, TileRenderData } from './zarr-tile-cache'

interface RendererUniforms {
  vmin: number
  vmax: number
  opacity: number
  fillValue: number
  useFillValue: boolean
  noDataMin: number
  noDataMax: number
  scaleFactor: number
  offset: number
}

interface SingleImageParams {
  data: Float32Array | null
  width: number
  height: number
  bounds: MercatorBounds | null
  texture: WebGLTexture | null
  vertexBuffer: WebGLBuffer | null
  pixCoordBuffer: WebGLBuffer | null
  pixCoordArr: Float32Array
}

interface PrerenderParams {
  matrix: number[]
  colormapTexture: WebGLTexture
  uniforms: RendererUniforms
  worldOffsets: number[]
  isMultiscale: boolean
  visibleTiles: TileTuple[]
  tileCache: TileRenderCache
  tileSize: number
  vertexArr: Float32Array
  pixCoordArr: Float32Array
  singleImage?: SingleImageParams
}

export class ZarrRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private renderProgram: WebGLProgram
  private frameBuffers: {
    current: {
      framebuffer: WebGLFramebuffer
      texture: WebGLTexture
    } | null
    next: {
      framebuffer: WebGLFramebuffer
      texture: WebGLTexture
    } | null
  } = { current: null, next: null }
  private canvasWidth: number
  private canvasHeight: number

  private scaleLoc: WebGLUniformLocation
  private scaleXLoc: WebGLUniformLocation
  private scaleYLoc: WebGLUniformLocation
  private shiftXLoc: WebGLUniformLocation
  private shiftYLoc: WebGLUniformLocation
  private worldXOffsetLoc: WebGLUniformLocation
  private matrixLoc: WebGLUniformLocation
  private vminLoc: WebGLUniformLocation
  private vmaxLoc: WebGLUniformLocation
  private opacityLoc: WebGLUniformLocation
  private noDataLoc: WebGLUniformLocation
  private noDataMinLoc: WebGLUniformLocation
  private noDataMaxLoc: WebGLUniformLocation
  private useFillValueLoc: WebGLUniformLocation
  private fillValueLoc: WebGLUniformLocation
  private scaleFactorLoc: WebGLUniformLocation
  private addOffsetLoc: WebGLUniformLocation
  private cmapLoc: WebGLUniformLocation
  private texLoc: WebGLUniformLocation
  private vertexLoc: number
  private pixCoordLoc: number

  private renderVertexLoc: number
  private renderTexLoc: WebGLUniformLocation
  private quadBuffer: WebGLBuffer

  constructor(gl: WebGL2RenderingContext, fragmentShaderSource: string) {
    this.gl = ZarrRenderer.resolveGl(gl)

    const vertexShader = createShader(
      this.gl,
      this.gl.VERTEX_SHADER,
      maplibreVertexShaderSource
    )
    const fragmentShader = createShader(
      this.gl,
      this.gl.FRAGMENT_SHADER,
      fragmentShaderSource
    )
    if (!vertexShader || !fragmentShader) {
      throw new Error('Failed to create shaders')
    }
    const program = createProgram(this.gl, vertexShader, fragmentShader)
    if (!program) {
      throw new Error('Failed to create program')
    }
    this.program = program

    this.scaleLoc = mustGetUniformLocation(this.gl, program, 'scale')
    this.scaleXLoc = mustGetUniformLocation(this.gl, program, 'scale_x')
    this.scaleYLoc = mustGetUniformLocation(this.gl, program, 'scale_y')
    this.shiftXLoc = mustGetUniformLocation(this.gl, program, 'shift_x')
    this.shiftYLoc = mustGetUniformLocation(this.gl, program, 'shift_y')
    this.worldXOffsetLoc = mustGetUniformLocation(
      this.gl,
      program,
      'u_worldXOffset'
    )
    this.matrixLoc = mustGetUniformLocation(this.gl, program, 'matrix')
    this.vminLoc = mustGetUniformLocation(this.gl, program, 'vmin')
    this.vmaxLoc = mustGetUniformLocation(this.gl, program, 'vmax')
    this.opacityLoc = mustGetUniformLocation(this.gl, program, 'opacity')
    this.noDataLoc = mustGetUniformLocation(this.gl, program, 'nodata')
    this.noDataMinLoc = mustGetUniformLocation(this.gl, program, 'u_noDataMin')
    this.noDataMaxLoc = mustGetUniformLocation(this.gl, program, 'u_noDataMax')
    this.useFillValueLoc = mustGetUniformLocation(
      this.gl,
      program,
      'u_useFillValue'
    )
    this.fillValueLoc = mustGetUniformLocation(this.gl, program, 'u_fillValue')
    this.scaleFactorLoc = mustGetUniformLocation(
      this.gl,
      program,
      'u_scaleFactor'
    )
    this.addOffsetLoc = mustGetUniformLocation(this.gl, program, 'u_addOffset')
    this.cmapLoc = mustGetUniformLocation(this.gl, program, 'cmap')
    this.texLoc = mustGetUniformLocation(this.gl, program, 'tex')

    this.vertexLoc = this.gl.getAttribLocation(program, 'vertex')
    this.pixCoordLoc = this.gl.getAttribLocation(program, 'pix_coord_in')

    this.canvasWidth = this.gl.canvas.width
    this.canvasHeight = this.gl.canvas.height
    this.frameBuffers.current = mustCreateFramebuffer(
      this.gl,
      this.canvasWidth,
      this.canvasHeight
    )
    this.frameBuffers.next = mustCreateFramebuffer(
      this.gl,
      this.canvasWidth,
      this.canvasHeight
    )

    const renderVertShader = createShader(
      this.gl,
      this.gl.VERTEX_SHADER,
      renderVertexShaderSource
    )
    const renderFragShader = createShader(
      this.gl,
      this.gl.FRAGMENT_SHADER,
      renderFragmentShaderSource
    )
    if (!renderVertShader || !renderFragShader) {
      throw new Error('Failed to create render shaders')
    }
    const renderProgram = createProgram(
      this.gl,
      renderVertShader,
      renderFragShader
    )
    if (!renderProgram) {
      throw new Error('Failed to create render program')
    }
    this.renderProgram = renderProgram
    this.renderVertexLoc = this.gl.getAttribLocation(renderProgram, 'vertex')
    this.renderTexLoc = mustGetUniformLocation(this.gl, renderProgram, 'tex')
    this.quadBuffer = mustCreateBuffer(this.gl)

    this.gl.deleteShader(vertexShader)
    this.gl.deleteShader(fragmentShader)
    this.gl.deleteShader(renderVertShader)
    this.gl.deleteShader(renderFragShader)
  }

  private static resolveGl(gl: WebGL2RenderingContext): WebGL2RenderingContext {
    const hasWebGL2Methods =
      gl &&
      typeof gl.getUniformLocation === 'function' &&
      typeof gl.drawBuffers === 'function'
    if (hasWebGL2Methods) {
      return gl
    }
    throw new Error('Invalid WebGL2 context: missing required WebGL2 methods')
  }

  prerender(params: PrerenderParams) {
    const {
      matrix,
      colormapTexture,
      uniforms,
      worldOffsets,
      isMultiscale,
      visibleTiles,
      tileCache,
      tileSize,
      vertexArr,
      pixCoordArr,
      singleImage,
    } = params

    this.resizeIfNeeded()

    const gl = this.gl
    gl.useProgram(this.program)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffers.next!.framebuffer)
    gl.viewport(0, 0, this.canvasWidth, this.canvasHeight)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, colormapTexture)
    gl.uniform1i(this.cmapLoc, 1)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    gl.uniform1f(this.vminLoc, uniforms.vmin)
    gl.uniform1f(this.vmaxLoc, uniforms.vmax)
    gl.uniform1f(this.opacityLoc, uniforms.opacity)
    gl.uniform1f(this.noDataLoc, uniforms.fillValue)
    gl.uniform1f(this.noDataMinLoc, uniforms.noDataMin)
    gl.uniform1f(this.noDataMaxLoc, uniforms.noDataMax)
    gl.uniform1i(this.useFillValueLoc, uniforms.useFillValue ? 1 : 0)
    gl.uniform1f(this.fillValueLoc, uniforms.fillValue)
    gl.uniform1f(this.scaleFactorLoc, uniforms.scaleFactor)
    gl.uniform1f(this.addOffsetLoc, uniforms.offset)
    gl.uniformMatrix4fv(this.matrixLoc, false, matrix)

    if (isMultiscale) {
      this.renderTiles(
        visibleTiles,
        worldOffsets,
        tileCache,
        tileSize,
        vertexArr,
        pixCoordArr
      )
    } else if (singleImage) {
      this.renderSingleImage(worldOffsets, singleImage, vertexArr)
    }

    const temp = this.frameBuffers.current
    this.frameBuffers.current = this.frameBuffers.next
    this.frameBuffers.next = temp
  }

  present() {
    if (!this.frameBuffers.current) return

    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvasWidth, this.canvasHeight)

    gl.useProgram(this.renderProgram)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.frameBuffers.current.texture)
    gl.uniform1i(this.renderTexLoc, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    )
    gl.enableVertexAttribArray(this.renderVertexLoc)
    gl.vertexAttribPointer(this.renderVertexLoc, 2, gl.FLOAT, false, 0, 0)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  dispose() {
    const gl = this.gl
    if (this.program) {
      gl.deleteProgram(this.program)
    }
    if (this.renderProgram) {
      gl.deleteProgram(this.renderProgram)
    }
    if (this.frameBuffers.current) {
      gl.deleteFramebuffer(this.frameBuffers.current.framebuffer)
      gl.deleteTexture(this.frameBuffers.current.texture)
      this.frameBuffers.current = null
    }
    if (this.frameBuffers.next) {
      gl.deleteFramebuffer(this.frameBuffers.next.framebuffer)
      gl.deleteTexture(this.frameBuffers.next.texture)
      this.frameBuffers.next = null
    }
    gl.deleteBuffer(this.quadBuffer)
  }

  private resizeIfNeeded() {
    const gl = this.gl
    if (
      gl.canvas.width === this.canvasWidth &&
      gl.canvas.height === this.canvasHeight
    ) {
      return
    }
    if (this.frameBuffers.current) {
      gl.deleteFramebuffer(this.frameBuffers.current.framebuffer)
      gl.deleteTexture(this.frameBuffers.current.texture)
    }
    if (this.frameBuffers.next) {
      gl.deleteFramebuffer(this.frameBuffers.next.framebuffer)
      gl.deleteTexture(this.frameBuffers.next.texture)
    }
    this.canvasWidth = gl.canvas.width
    this.canvasHeight = gl.canvas.height
    this.frameBuffers.current = mustCreateFramebuffer(
      gl,
      this.canvasWidth,
      this.canvasHeight
    )
    this.frameBuffers.next = mustCreateFramebuffer(
      gl,
      this.canvasWidth,
      this.canvasHeight
    )
  }

  private renderSingleImage(
    worldOffsets: number[],
    params: SingleImageParams,
    vertexArr: Float32Array
  ) {
    const {
      data,
      bounds,
      texture,
      vertexBuffer,
      pixCoordBuffer,
      width,
      height,
      pixCoordArr,
    } = params

    if (!data || !bounds || !texture || !vertexBuffer || !pixCoordBuffer) {
      return
    }

    const gl = this.gl

    const scaleX = (bounds.x1 - bounds.x0) / 2
    const scaleY = (bounds.y1 - bounds.y0) / 2
    const shiftX = (bounds.x0 + bounds.x1) / 2
    const shiftY = (bounds.y0 + bounds.y1) / 2

    gl.uniform1f(this.scaleLoc, 0)
    gl.uniform1f(this.scaleXLoc, scaleX)
    gl.uniform1f(this.scaleYLoc, scaleY)
    gl.uniform1f(this.shiftXLoc, shiftX)
    gl.uniform1f(this.shiftYLoc, shiftY)

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertexArr, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, pixCoordBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, pixCoordArr, gl.STATIC_DRAW)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(this.texLoc, 0)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      width,
      height,
      0,
      gl.RED,
      gl.FLOAT,
      data
    )

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.enableVertexAttribArray(this.vertexLoc)
    gl.vertexAttribPointer(this.vertexLoc, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, pixCoordBuffer)
    gl.enableVertexAttribArray(this.pixCoordLoc)
    gl.vertexAttribPointer(this.pixCoordLoc, 2, gl.FLOAT, false, 0, 0)

    for (const worldOffset of worldOffsets) {
      gl.uniform1f(this.worldXOffsetLoc, worldOffset)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
  }

  private renderTiles(
    visibleTiles: TileTuple[],
    worldOffsets: number[],
    tileCache: TileRenderCache,
    tileSize: number,
    vertexArr: Float32Array,
    pixCoordArr: Float32Array
  ) {
    const gl = this.gl

    gl.uniform1f(this.scaleXLoc, 0)
    gl.uniform1f(this.scaleYLoc, 0)

    for (const worldOffset of worldOffsets) {
      gl.uniform1f(this.worldXOffsetLoc, worldOffset)

      for (const tileTuple of visibleTiles) {
        const [z, x, y] = tileTuple
        const tileKey = tileToKey(tileTuple)
        const tile = tileCache.get(tileKey)

        let tileToRender: TileRenderData | null = null
        let texCoords = pixCoordArr

        if (tile && tile.data) {
          tileToRender = tile
        } else {
          const parent = this.findBestParentTile(z, x, y, tileCache)
          if (parent) {
            tileToRender = parent.tile
            texCoords = this.getOverzoomTexCoords(z, x, y, parent.ancestorZ)
          }
        }

        if (!tileToRender || !tileToRender.data) continue

        const [scale, shiftX, shiftY] = tileToScale(tileTuple)
        gl.uniform1f(this.scaleLoc, scale)
        gl.uniform1f(this.shiftXLoc, shiftX)
        gl.uniform1f(this.shiftYLoc, shiftY)

        gl.bindBuffer(gl.ARRAY_BUFFER, tileToRender.vertexBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, vertexArr, gl.STATIC_DRAW)
        gl.bindBuffer(gl.ARRAY_BUFFER, tileToRender.pixCoordBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, tileToRender.tileTexture)
        gl.uniform1i(this.texLoc, 0)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R16F,
          tileSize,
          tileSize,
          0,
          gl.RED,
          gl.FLOAT,
          tileToRender.data
        )

        gl.bindBuffer(gl.ARRAY_BUFFER, tileToRender.vertexBuffer)
        gl.enableVertexAttribArray(this.vertexLoc)
        gl.vertexAttribPointer(this.vertexLoc, 2, gl.FLOAT, false, 0, 0)

        gl.bindBuffer(gl.ARRAY_BUFFER, tileToRender.pixCoordBuffer)
        gl.enableVertexAttribArray(this.pixCoordLoc)
        gl.vertexAttribPointer(this.pixCoordLoc, 2, gl.FLOAT, false, 0, 0)

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
    }
  }

  private findBestParentTile(
    z: number,
    x: number,
    y: number,
    tileCache: TileRenderCache
  ): {
    tile: TileRenderData
    ancestorZ: number
    ancestorX: number
    ancestorY: number
  } | null {
    let ancestorZ = z - 1
    let ancestorX = Math.floor(x / 2)
    let ancestorY = Math.floor(y / 2)

    while (ancestorZ >= 0) {
      const parentKey = tileToKey([ancestorZ, ancestorX, ancestorY])
      const parentTile = tileCache.get(parentKey)
      if (parentTile && parentTile.data) {
        return { tile: parentTile, ancestorZ, ancestorX, ancestorY }
      }
      ancestorZ--
      ancestorX = Math.floor(ancestorX / 2)
      ancestorY = Math.floor(ancestorY / 2)
    }
    return null
  }

  private getOverzoomTexCoords(
    targetZ: number,
    targetX: number,
    targetY: number,
    ancestorZ: number
  ): Float32Array {
    const levelDiff = targetZ - ancestorZ
    const divisor = Math.pow(2, levelDiff)

    const localX = targetX % divisor
    const localY = targetY % divisor

    const texX0 = localX / divisor
    const texX1 = (localX + 1) / divisor
    const texY0 = localY / divisor
    const texY1 = (localY + 1) / divisor

    return new Float32Array([
      texX0,
      texY0,
      texX0,
      texY1,
      texX1,
      texY0,
      texX1,
      texY1,
    ])
  }
}
