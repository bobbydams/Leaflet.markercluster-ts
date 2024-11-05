export { MarkerClusterGroup } from './MarkerClusterGroup'
export { MarkerCluster } from './MarkerCluster'
import LeafletInstance from './LeafletInstance'
import {} from './MarkerOpacity'
import {} from './DistanceGrid'
import QuickHull from './MarkerCluster.QuickHull'
import {} from './MarkerCluster.Spiderfier'
import {} from './MarkerClusterGroup.Refresh'
import 'leaflet.markercluster'

// Get the singleton instance of LeafletInstance
export const leafletInstance = LeafletInstance.getInstance()
export const leafletMap = leafletInstance.getMap()

// Now you can use `map` to add layers, markers, etc.
