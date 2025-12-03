declare module '@carbonplan/colormaps' {
  export interface ColormapOptions {
    count?: number
    format?: 'rgb' | 'hex'
    mode?: 'light' | 'dark'
  }

  export function makeColormap(
    name: string,
    options?: ColormapOptions
  ): string[] | number[][]

  export function useColormap(
    name: string,
    options?: ColormapOptions
  ): string[] | number[][]

  export function useThemedColormap(
    name: string,
    options?: ColormapOptions
  ): string[] | number[][]

  export interface ColormapInfo {
    name: string
    type: string
  }

  export const colormaps: ColormapInfo[]
}

