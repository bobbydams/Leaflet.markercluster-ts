import LeafletInstance from './LeafletInstance'

const L = LeafletInstance.getInstance()

// Implement the clusterHide and clusterShow methods
L.Marker.include({
  clusterHide: function (this: L.Marker): L.Marker {
    const backupOpacity = this.options.opacity
    this.setOpacity(0)
    this.options.opacity = backupOpacity
    return this
  },

  clusterShow: function (this: L.Marker): L.Marker {
    return this.setOpacity(this.options.opacity || 1)
  },
})
