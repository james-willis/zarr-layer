import React from 'react'
import type { AppProps } from 'next/app'
import { ThemeProvider } from 'theme-ui'
import theme from '../lib/theme'
import '@carbonplan/components/fonts.css'
import '@carbonplan/components/globals.css'
import 'maplibre-gl/dist/maplibre-gl.css'

const App = ({ Component, pageProps }: AppProps) => {
  return (
    <ThemeProvider theme={theme}>
      <Component {...pageProps} />
    </ThemeProvider>
  )
}

export default App

