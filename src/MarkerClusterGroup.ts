import LeafletInstance from './LeafletInstance'
import { LeafletMarkerCluster } from './types'

const L = LeafletInstance.getInstance()

interface MarkerClusterGroupOptions
  extends LeafletMarkerCluster.MarkerClusterGroupOptions {
  maxClusterRadius?: number | ((zoom: number) => number)
  iconCreateFunction?: (cluster: LeafletMarkerCluster.MarkerCluster) => L.Icon
  clusterPane?: string

  spiderfyOnEveryZoom?: boolean
  spiderfyOnMaxZoom?: boolean
  showCoverageOnHover?: boolean
  zoomToBoundsOnClick?: boolean
  singleMarkerMode?: boolean

  disableClusteringAtZoom?: number | null

  removeOutsideVisibleBounds?: boolean

  animate?: boolean

  animateAddingMarkers?: boolean

  spiderfyShapePositions?: (count: number, centerPt: L.Point) => L.Point[]

  spiderfyDistanceMultiplier?: number

  spiderLegPolylineOptions?: L.PolylineOptions

  chunkedLoading?: boolean
  chunkInterval?: number
  chunkDelay?: number
  chunkProgress?: (processed: number, total: number, elapsed: number) => void

  polygonOptions?: L.PolylineOptions
}

type ChildMarkerEventHandlers = {
  [event: string]: (e: L.LeafletEvent) => void
}

type LayerWithLatLng = L.Layer & { getLatLng: () => L.LatLng }

class MarkerClusterGroup extends L.MarkerClusterGroup {
  options: MarkerClusterGroupOptions

  private _featureGroup: L.FeatureGroup = L.featureGroup()
  private _nonPointGroup: L.FeatureGroup = L.featureGroup()
  private _inZoomAnimation: number = 0
  private _needsClustering: LayerWithLatLng[] = []
  private _needsRemoving: Array<{ layer: LayerWithLatLng; latlng: L.LatLng }> =
    []
  private _currentShownBounds: L.LatLngBounds | null = null
  private _queue: Array<() => void> = []
  private _childMarkerEventHandlers: ChildMarkerEventHandlers
  private _zoom: number = 0
  private _currentShownBoundsInfinite: L.LatLngBounds = new L.LatLngBounds(
    new L.LatLng(-Infinity, -Infinity),
    new L.LatLng(Infinity, Infinity)
  )
  private _topClusterLevel: L.MarkerCluster
  private _maxZoom: number = 0
  private _gridClusters: { [zoom: number]: L.DistanceGrid<L.MarkerCluster> } =
    {}
  private _gridUnclustered: {
    [zoom: number]: L.DistanceGrid<LayerWithLatLng>
  } = {}
  private _spiderfierOnAdd?: () => void
  private _spiderfierOnRemove?: () => void
  private _unspiderfy?: () => void
  private _unspiderfyLayer?: (layer: LayerWithLatLng) => void
  private _ignoreMove: boolean = false
  private _spiderfied?: L.MarkerCluster
  private _shownPolygon?: L.Polygon
  private _map?: L.Map
  private _maxLat?: number
  private _markerCluster:
    | typeof LeafletMarkerCluster.MarkerCluster
    | typeof LeafletMarkerCluster.MarkerClusterNonAnimated
  private _queueTimeout?: number

  constructor(options?: MarkerClusterGroupOptions) {
    super()
    L.Util.setOptions(this, options)
    this.options = {
      maxClusterRadius: 80,
      iconCreateFunction: null,
      clusterPane: L.Marker.prototype.options.pane,

      spiderfyOnEveryZoom: false,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: true,
      zoomToBoundsOnClick: true,
      singleMarkerMode: false,

      disableClusteringAtZoom: null,

      removeOutsideVisibleBounds: true,

      animate: true,

      animateAddingMarkers: false,

      spiderfyShapePositions: null,

      spiderfyDistanceMultiplier: 1,

      spiderLegPolylineOptions: { weight: 1.5, color: '#222', opacity: 0.5 },

      chunkedLoading: false,
      chunkInterval: 200,
      chunkDelay: 50,
      chunkProgress: null,

      polygonOptions: {},
      ...options,
    }

    if (!this.options.iconCreateFunction) {
      this.options.iconCreateFunction = this._defaultIconCreateFunction
    }

    this._featureGroup.addEventParent(this)
    this._nonPointGroup.addEventParent(this)

    this._childMarkerEventHandlers = {
      dragstart: this._childMarkerDragStart.bind(this),
      move: this._childMarkerMoved.bind(this),
      dragend: this._childMarkerDragEnd.bind(this),
    }

    // Hook the appropriate animation methods.
    const animate = L.DomUtil.TRANSITION && this.options.animate
    if (animate) {
      Object.assign(this, this._withAnimation)
      this._markerCluster = L.MarkerCluster
    } else {
      Object.assign(this, this._noAnimation)
      this._markerCluster = L.MarkerClusterNonAnimated
    }
  }

  addLayer(layer: L.Layer): this {
    if (layer instanceof L.LayerGroup) {
      return this.addLayers([layer])
    }

    // Don't cluster non-point data
    if (!(layer as LayerWithLatLng).getLatLng) {
      this._nonPointGroup.addLayer(layer)
      this.fire('layeradd', { layer })
      return this
    }

    if (!this._map) {
      this._needsClustering.push(layer as LayerWithLatLng)
      this.fire('layeradd', { layer })
      return this
    }

    if (this.hasLayer(layer)) {
      return this
    }

    // If we have already clustered, we'll need to add this one to a cluster
    if (this._unspiderfy) {
      this._unspiderfy()
    }

    this._addLayer(layer as LayerWithLatLng, this._maxZoom)
    this.fire('layeradd', { layer })

    // Refresh bounds and weighted positions.
    this._topClusterLevel._recalculateBounds()

    this._refreshClustersIcons()

    // Work out what is visible
    let visibleLayer: any = layer
    const currentZoom = this._zoom
    if ((layer as any).__parent) {
      while (
        (visibleLayer as any).__parent &&
        (visibleLayer as any).__parent._zoom >= currentZoom
      ) {
        visibleLayer = (visibleLayer as any).__parent
      }
    }

    if (
      this._currentShownBounds &&
      this._currentShownBounds.contains(visibleLayer.getLatLng())
    ) {
      if (this.options.animateAddingMarkers) {
        this._animationAddLayer(layer as LayerWithLatLng, visibleLayer)
      } else {
        this._animationAddLayerNonAnimated(
          layer as LayerWithLatLng,
          visibleLayer
        )
      }
    }
    return this
  }

  removeLayer(layer: L.Layer): this {
    if (layer instanceof L.LayerGroup) {
      return this.removeLayers([layer])
    }

    // Non-point layers
    if (!(layer as LayerWithLatLng).getLatLng) {
      this._nonPointGroup.removeLayer(layer)
      this.fire('layerremove', { layer })
      return this
    }

    if (!this._map) {
      if (
        !this._arraySplice(this._needsClustering, layer as LayerWithLatLng) &&
        this.hasLayer(layer)
      ) {
        this._needsRemoving.push({
          layer: layer as LayerWithLatLng,
          latlng: (layer as any)._latlng,
        })
      }
      this.fire('layerremove', { layer })
      return this
    }

    if (!(layer as any).__parent) {
      return this
    }

    if (this._unspiderfy) {
      this._unspiderfy()
      if (this._unspiderfyLayer) {
        this._unspiderfyLayer(layer as LayerWithLatLng)
      }
    }

    // Remove the marker from clusters
    this._removeLayer(layer as LayerWithLatLng, true)
    this.fire('layerremove', { layer })

    // Refresh bounds and weighted positions.
    this._topClusterLevel._recalculateBounds()

    this._refreshClustersIcons()
    ;(layer as any).off(this._childMarkerEventHandlers, this)

    if (this._featureGroup.hasLayer(layer)) {
      this._featureGroup.removeLayer(layer)
      if ((layer as any).clusterShow) {
        ;(layer as any).clusterShow()
      }
    }

    return this
  }

  addLayers(layersArray: L.Layer[], skipLayerAddEvent?: boolean): this {
    if (!Array.isArray(layersArray)) {
      return this.addLayer(layersArray)
    }

    const fg = this._featureGroup
    const npg = this._nonPointGroup
    const chunked = this.options.chunkedLoading
    const chunkInterval = this.options.chunkInterval
    const chunkDelay = this.options.chunkDelay
    const chunkProgress = this.options.chunkProgress
    let l = layersArray.length
    let offset = 0
    let originalArray = true
    let m: L.Layer

    if (this._map) {
      const started = Date.now()
      const process = () => {
        const start = Date.now()

        // Make sure to unspiderfy before starting to add layers
        if (this._map && this._unspiderfy) {
          this._unspiderfy()
        }

        for (; offset < l; offset++) {
          if (chunked && offset % 200 === 0) {
            const elapsed = Date.now() - start
            if (elapsed > chunkInterval) {
              break
            }
          }

          m = layersArray[offset]

          // Group of layers, append children to layersArray and skip.
          if (m instanceof L.LayerGroup) {
            if (originalArray) {
              layersArray = layersArray.slice()
              originalArray = false
            }
            this._extractNonGroupLayers(m, layersArray)
            l = layersArray.length
            continue
          }

          // Non-point data
          if (!(m as LayerWithLatLng).getLatLng) {
            npg.addLayer(m)
            if (!skipLayerAddEvent) {
              this.fire('layeradd', { layer: m })
            }
            continue
          }

          if (this.hasLayer(m)) {
            continue
          }

          this._addLayer(m as LayerWithLatLng, this._maxZoom)
          if (!skipLayerAddEvent) {
            this.fire('layeradd', { layer: m })
          }

          // If we just made a cluster of size 2 then we need to remove the other marker from the map
          if ((m as any).__parent) {
            if ((m as any).__parent._childCount === 2) {
              const markers = (m as any).__parent.getAllChildMarkers()
              const otherMarker = markers[0] === m ? markers[1] : markers[0]
              fg.removeLayer(otherMarker)
            }
          }
        }

        if (chunkProgress) {
          chunkProgress(offset, l, Date.now() - started)
        }

        // Completed processing all markers.
        if (offset === l) {
          // Refresh bounds and weighted positions.
          this._topClusterLevel._recalculateBounds()

          this._refreshClustersIcons()

          this._topClusterLevel._recursivelyAddChildrenToMap(
            null,
            this._zoom,
            this._currentShownBounds
          )
        } else {
          setTimeout(process, chunkDelay)
        }
      }

      process()
    } else {
      const needsClustering = this._needsClustering

      for (; offset < l; offset++) {
        m = layersArray[offset]

        // Group of layers, append children to layersArray and skip.
        if (m instanceof L.LayerGroup) {
          if (originalArray) {
            layersArray = layersArray.slice()
            originalArray = false
          }
          this._extractNonGroupLayers(m, layersArray)
          l = layersArray.length
          continue
        }

        // Non-point data
        if (!(m as LayerWithLatLng).getLatLng) {
          npg.addLayer(m)
          continue
        }

        if (this.hasLayer(m)) {
          continue
        }

        needsClustering.push(m as LayerWithLatLng)
      }
    }
    return this
  }

  removeLayers(layersArray: L.Layer[]): this {
    let i: number
    let m: L.Layer
    let l = layersArray.length
    const fg = this._featureGroup
    const npg = this._nonPointGroup
    let originalArray = true

    if (!this._map) {
      for (i = 0; i < l; i++) {
        m = layersArray[i]

        // Group of layers, append children to layersArray and skip.
        if (m instanceof L.LayerGroup) {
          if (originalArray) {
            layersArray = layersArray.slice()
            originalArray = false
          }
          this._extractNonGroupLayers(m, layersArray)
          l = layersArray.length
          continue
        }

        this._arraySplice(this._needsClustering, m as LayerWithLatLng)
        npg.removeLayer(m)
        if (this.hasLayer(m)) {
          this._needsRemoving.push({
            layer: m as LayerWithLatLng,
            latlng: (m as any)._latlng,
          })
        }
        this.fire('layerremove', { layer: m })
      }
      return this
    }

    if (this._unspiderfy) {
      this._unspiderfy()

      // Work on a copy of the array
      const layersArray2 = layersArray.slice()
      let l2 = l
      for (i = 0; i < l2; i++) {
        m = layersArray2[i]

        // Group of layers, append children to layersArray and skip.
        if (m instanceof L.LayerGroup) {
          this._extractNonGroupLayers(m, layersArray2)
          l2 = layersArray2.length
          continue
        }

        if (this._unspiderfyLayer) {
          this._unspiderfyLayer(m as LayerWithLatLng)
        }
      }
    }

    for (i = 0; i < l; i++) {
      m = layersArray[i]

      // Group of layers, append children to layersArray and skip.
      if (m instanceof L.LayerGroup) {
        if (originalArray) {
          layersArray = layersArray.slice()
          originalArray = false
        }
        this._extractNonGroupLayers(m, layersArray)
        l = layersArray.length
        continue
      }

      if (!(m as any).__parent) {
        npg.removeLayer(m)
        this.fire('layerremove', { layer: m })
        continue
      }

      this._removeLayer(m as LayerWithLatLng, true, true)
      this.fire('layerremove', { layer: m })

      if (fg.hasLayer(m)) {
        fg.removeLayer(m)
        if ((m as any).clusterShow) {
          ;(m as any).clusterShow()
        }
      }
    }

    // Refresh bounds and weighted positions.
    this._topClusterLevel._recalculateBounds()

    this._refreshClustersIcons()

    // Fix up the clusters and markers on the map
    this._topClusterLevel._recursivelyAddChildrenToMap(
      null,
      this._zoom,
      this._currentShownBounds
    )

    return this
  }

  clearLayers(): this {
    // Need our own special implementation as the LayerGroup one doesn't work for us

    // If we aren't on the map (yet), blow away the markers we know of
    if (!this._map) {
      this._needsClustering = []
      this._needsRemoving = []
      delete this._gridClusters
      delete this._gridUnclustered
    }

    if (this._unspiderfy) {
      this._unspiderfy()
    }

    // Remove all the visible layers
    this._featureGroup.clearLayers()
    this._nonPointGroup.clearLayers()

    this.eachLayer((marker: any) => {
      marker.off(this._childMarkerEventHandlers, this)
      delete marker.__parent
    })

    if (this._map) {
      // Reset _topClusterLevel and the DistanceGrids
      this._generateInitialClusters()
    }

    return this
  }

  getBounds(): L.LatLngBounds {
    const bounds = new L.LatLngBounds()

    if (this._topClusterLevel) {
      bounds.extend(this._topClusterLevel._bounds)
    }

    for (let i = this._needsClustering.length - 1; i >= 0; i--) {
      bounds.extend(this._needsClustering[i].getLatLng())
    }

    bounds.extend(this._nonPointGroup.getBounds())

    return bounds
  }

  eachLayer(fn: (layer: L.Layer) => void, context?: any): this {
    const markers = this._needsClustering.slice()
    const needsRemoving = this._needsRemoving
    let thisNeedsRemoving: boolean

    if (this._topClusterLevel) {
      this._topClusterLevel.getAllChildMarkers(markers)
    }

    for (let i = markers.length - 1; i >= 0; i--) {
      thisNeedsRemoving = true

      for (let j = needsRemoving.length - 1; j >= 0; j--) {
        if (needsRemoving[j].layer === markers[i]) {
          thisNeedsRemoving = false
          break
        }
      }

      if (thisNeedsRemoving) {
        fn.call(context, markers[i])
      }
    }

    this._nonPointGroup.eachLayer(fn, context)
    return this
  }

  getLayers(): L.Layer[] {
    const layers: L.Layer[] = []
    this.eachLayer((l) => {
      layers.push(l)
    })
    return layers
  }

  getLayer(id: number): L.Layer | null {
    let result: L.Layer | null = null

    id = parseInt(id as any, 10)

    this.eachLayer((l) => {
      if (L.stamp(l) === id) {
        result = l
      }
    })

    return result
  }

  hasLayer(layer: L.Layer): boolean {
    if (!layer) {
      return false
    }

    let i: number
    let anArray = this._needsClustering

    for (i = anArray.length - 1; i >= 0; i--) {
      if (anArray[i] === layer) {
        return true
      }
    }

    anArray = this._needsRemoving.map((item) => item.layer)
    for (i = anArray.length - 1; i >= 0; i--) {
      if (anArray[i] === layer) {
        return false
      }
    }

    return (
      !!((layer as any).__parent && (layer as any).__parent._group === this) ||
      this._nonPointGroup.hasLayer(layer)
    )
  }

  zoomToShowLayer(layer: L.Layer, callback?: () => void): void {
    const map = this._map

    if (typeof callback !== 'function') {
      callback = () => {}
    }

    const showMarker = () => {
      if (
        (map!.hasLayer(layer) || map!.hasLayer((layer as any).__parent)) &&
        !this._inZoomAnimation
      ) {
        map!.off('moveend', showMarker, this)
        this.off('animationend', showMarker, this)

        if (map!.hasLayer(layer)) {
          callback!()
        } else if ((layer as any).__parent._icon) {
          this.once('spiderfied', callback!, this)
          ;(layer as any).__parent.spiderfy()
        }
      }
    }

    if (
      (layer as any)._icon &&
      map!.getBounds().contains((layer as LayerWithLatLng).getLatLng())
    ) {
      // Layer is visible and on screen, immediate return
      callback()
    } else if ((layer as any).__parent._zoom < Math.round(map!._zoom)) {
      // Layer should be visible at this zoom level. It must not be on screen so just pan over to it
      map!.on('moveend', showMarker, this)
      map!.panTo((layer as LayerWithLatLng).getLatLng())
    } else {
      map!.on('moveend', showMarker, this)
      this.on('animationend', showMarker, this)
      ;(layer as any).__parent.zoomToBounds()
    }
  }

  onAdd(map: L.Map): this {
    this._map = map

    if (!isFinite(this._map.getMaxZoom())) {
      throw new Error('Map has no maxZoom specified')
    }

    this._featureGroup.addTo(map)
    this._nonPointGroup.addTo(map)

    if (!this._gridClusters) {
      this._generateInitialClusters()
    }

    this._maxLat = map.options.crs.projection.MAX_LATITUDE

    // Restore all the positions as they are in the MCG before removing them
    for (let i = 0, l = this._needsRemoving.length; i < l; i++) {
      const layer = this._needsRemoving[i]
      ;(layer as any).newlatlng = layer.layer._latlng
      layer.layer._latlng = layer.latlng
    }
    // Remove them, then restore their new positions
    for (let i = 0, l = this._needsRemoving.length; i < l; i++) {
      const layer = this._needsRemoving[i]
      this._removeLayer(layer.layer, true)
      layer.layer._latlng = (layer as any).newlatlng
    }
    this._needsRemoving = []

    // Remember the current zoom level and bounds
    this._zoom = Math.round(this._map._zoom)
    this._currentShownBounds = this._getExpandedVisibleBounds()

    this._map.on('zoomend', this._zoomEnd, this)
    this._map.on('moveend', this._moveEnd, this)

    if (this._spiderfierOnAdd) {
      this._spiderfierOnAdd()
    }

    this._bindEvents()

    // Actually add our markers to the map
    const l = this._needsClustering
    this._needsClustering = []
    this.addLayers(l, true)

    return this
  }

  onRemove(map: L.Map): this {
    map.off('zoomend', this._zoomEnd, this)
    map.off('moveend', this._moveEnd, this)

    this._unbindEvents()

    // In case we are in a cluster animation
    map._mapPane.className = map._mapPane.className.replace(
      ' leaflet-cluster-anim',
      ''
    )

    if (this._spiderfierOnRemove) {
      this._spiderfierOnRemove()
    }

    delete this._maxLat

    // Clean up all the layers we added to the map
    this._hideCoverage()
    this._featureGroup.remove()
    this._nonPointGroup.remove()

    this._featureGroup.clearLayers()

    this._map = undefined

    return this
  }

  // ... (Implement other methods with appropriate type annotations)

  // Utility functions
  private _arraySplice<T>(anArray: T[], obj: T): boolean {
    const index = anArray.indexOf(obj)
    if (index !== -1) {
      anArray.splice(index, 1)
      return true
    }
    return false
  }

  // Default icon creation function
  private _defaultIconCreateFunction(cluster: L.MarkerCluster): L.Icon {
    const childCount = cluster.getChildCount()

    let c = ' marker-cluster-'
    if (childCount < 10) {
      c += 'small'
    } else if (childCount < 100) {
      c += 'medium'
    } else {
      c += 'large'
    }

    return new L.DivIcon({
      html: `<div><span>${childCount} <span aria-label="markers"></span></span></div>`,
      className: 'marker-cluster' + c,
      iconSize: new L.Point(40, 40),
    })
  }

  // Implement other private methods and event handlers...

  // Bind events
  private _bindEvents(): void {
    const map = this._map
    const spiderfyOnMaxZoom = this.options.spiderfyOnMaxZoom
    const showCoverageOnHover = this.options.showCoverageOnHover
    const zoomToBoundsOnClick = this.options.zoomToBoundsOnClick
    const spiderfyOnEveryZoom = this.options.spiderfyOnEveryZoom

    // Zoom on cluster click or spiderfy if we are at the lowest level
    if (spiderfyOnMaxZoom || zoomToBoundsOnClick || spiderfyOnEveryZoom) {
      this.on('clusterclick clusterkeypress', this._zoomOrSpiderfy, this)
    }

    // Show convex hull (boundary) polygon on mouse over
    if (showCoverageOnHover) {
      this.on('clustermouseover', this._showCoverage, this)
      this.on('clustermouseout', this._hideCoverage, this)
      map!.on('zoomend', this._hideCoverage, this)
    }
  }

  // Unbind events
  private _unbindEvents(): void {
    const spiderfyOnMaxZoom = this.options.spiderfyOnMaxZoom
    const showCoverageOnHover = this.options.showCoverageOnHover
    const zoomToBoundsOnClick = this.options.zoomToBoundsOnClick
    const spiderfyOnEveryZoom = this.options.spiderfyOnEveryZoom
    const map = this._map

    if (spiderfyOnMaxZoom || zoomToBoundsOnClick || spiderfyOnEveryZoom) {
      this.off('clusterclick clusterkeypress', this._zoomOrSpiderfy, this)
    }
    if (showCoverageOnHover) {
      this.off('clustermouseover', this._showCoverage, this)
      this.off('clustermouseout', this._hideCoverage, this)
      map!.off('zoomend', this._hideCoverage, this)
    }
  }

  // Implement other private methods required for functionality...

  // Factory function for consistency with Leaflet conventions
  static markerClusterGroup(
    options?: MarkerClusterGroupOptions
  ): MarkerClusterGroup {
    return new MarkerClusterGroup(options)
  }
}

// Export the class and options interface
export { MarkerClusterGroup, MarkerClusterGroupOptions }
