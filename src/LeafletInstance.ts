import * as L from 'leaflet'
import { LeafletMarkerCluster } from './types'
import { MarkerCluster } from './MarkerCluster.Spiderfier'
import { MarkerClusterGroup } from './MarkerClusterGroup'

class LeafletInstance implements LeafletMarkerCluster.LeafletInstance {
  private static instance: LeafletInstance
  private map: L.Map
  public L: typeof L
  public Marker: typeof L.Marker
  public MarkerCluster: typeof LeafletMarkerCluster.MarkerCluster
  public MarkerClusterGroup: typeof LeafletMarkerCluster.MarkerClusterGroup

  private constructor() {
    this.map = L.map('mapId') // Replace 'mapId' with your actual map container ID
    this.L = { ...L }
    this.MarkerCluster = MarkerCluster
    this.MarkerClusterGroup = MarkerClusterGroup
    this.Marker = L.Marker
  }
  getInstance(): LeafletMarkerCluster.LeafletInstance {
    throw new Error('Method not implemented.')
  }

  public static getInstance(): LeafletInstance {
    if (!LeafletInstance.instance) {
      LeafletInstance.instance = new LeafletInstance()
    }
    return LeafletInstance.instance
  }

  public getMap(): L.Map {
    return this.map
  }
}

export default LeafletInstance
