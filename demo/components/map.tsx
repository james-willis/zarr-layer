import React from 'react'
import { MapComponentBase, MapProps } from './map-shared'

const MapComponent = (props: MapProps) => {
  return <MapComponentBase {...props} />
}

export default MapComponent
