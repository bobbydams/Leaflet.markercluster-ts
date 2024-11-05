/**
 * This code is based on https://github.com/jawj/OverlappingMarkerSpiderfier-Leaflet
 * Huge thanks to jawj for implementing it first to make the job easier.
 */

import LeafletInstance from './LeafletInstance'

const L = LeafletInstance.getInstance()

// Extend L.MarkerCluster
class MarkerCluster extends L.MarkerCluster {
  private _2PI = Math.PI * 2
  private _circleFootSeparation = 25 // Related to circumference of circle
  private _circleStartAngle = 0

  private _spiralFootSeparation = 28 // Related to size of spiral (experiment!)
  private _spiralLengthStart = 11
  private _spiralLengthFactor = 5

  private _circleSpiralSwitchover = 9 // Show spiral instead of circle from this marker count upwards.
  // 0 -> always spiral; Infinity -> always circle

  spiderfy(): void {
    if (this._group._spiderfied === this || this._group._inZoomAnimation) {
      return
    }

    const childMarkers = this.getAllChildMarkers(null, true)
    const group = this._group
    const map = group._map
    const center = map.latLngToLayerPoint(this._latlng)
    let positions: L.Point[]

    this._group._unspiderfy()
    this._group._spiderfied = this

    // TODO: Maybe order childMarkers by distance to center

    if (this._group.options.spiderfyShapePositions) {
      positions = this._group.options.spiderfyShapePositions(
        childMarkers.length,
        center
      )
    } else if (childMarkers.length >= this._circleSpiralSwitchover) {
      positions = this._generatePointsSpiral(childMarkers.length, center)
    } else {
      center.y += 10 // Hack for standard blue icon, renders differently for other icons.
      positions = this._generatePointsCircle(childMarkers.length, center)
    }

    this._animationSpiderfy(childMarkers, positions)
  }

  unspiderfy(zoomDetails?: L.ZoomAnimEvent): void {
    if (this._group._inZoomAnimation) {
      return
    }
    this._animationUnspiderfy(zoomDetails)

    this._group._spiderfied = null
  }

  private _generatePointsCircle(count: number, centerPt: L.Point): L.Point[] {
    const circumference =
      this._group.options.spiderfyDistanceMultiplier *
      this._circleFootSeparation *
      (2 + count)
    let legLength = circumference / this._2PI // Radius from circumference
    const angleStep = this._2PI / count
    const res: L.Point[] = []

    legLength = Math.max(legLength, 35) // Minimum distance to get outside the cluster icon.

    for (let i = 0; i < count; i++) {
      // Clockwise, like spiral.
      const angle = this._circleStartAngle + i * angleStep
      res[i] = new L.Point(
        centerPt.x + legLength * Math.cos(angle),
        centerPt.y + legLength * Math.sin(angle)
      ).round()
    }

    return res
  }

  private _generatePointsSpiral(count: number, centerPt: L.Point): L.Point[] {
    const spiderfyDistanceMultiplier =
      this._group.options.spiderfyDistanceMultiplier
    let legLength = spiderfyDistanceMultiplier * this._spiralLengthStart
    const separation = spiderfyDistanceMultiplier * this._spiralFootSeparation
    const lengthFactor =
      spiderfyDistanceMultiplier * this._spiralLengthFactor * this._2PI
    let angle = 0
    const res: L.Point[] = []

    // Higher index, closer position to cluster center.
    for (let i = count; i >= 0; i--) {
      // Skip the first position to avoid being under the default cluster icon.
      if (i < count) {
        res[i] = new L.Point(
          centerPt.x + legLength * Math.cos(angle),
          centerPt.y + legLength * Math.sin(angle)
        ).round()
      }
      angle += separation / legLength + i * 0.0005
      legLength += lengthFactor / angle
    }
    return res
  }

  _noanimationUnspiderfy(): void {
    const group = this._group
    const map = group._map
    const fg = group._featureGroup
    const childMarkers = this.getAllChildMarkers(null, true)

    group._ignoreMove = true

    this.setOpacity(1)
    for (let i = childMarkers.length - 1; i >= 0; i--) {
      const m = childMarkers[i]

      fg.removeLayer(m)

      if ((m as any)._preSpiderfyLatlng) {
        m.setLatLng((m as any)._preSpiderfyLatlng)
        delete (m as any)._preSpiderfyLatlng
      }
      if (m.setZIndexOffset) {
        m.setZIndexOffset(0)
      }

      if ((m as any)._spiderLeg) {
        map.removeLayer((m as any)._spiderLeg)
        delete (m as any)._spiderLeg
      }
    }

    group.fire('unspiderfied', {
      cluster: this,
      markers: childMarkers,
    })
    group._ignoreMove = false
    group._spiderfied = null
  }

  // ... Include other methods as needed
}

// Non-Animated versions of everything
class MarkerClusterNonAnimated extends MarkerCluster {
  _animationSpiderfy(childMarkers: L.Marker[], positions: L.Point[]): void {
    const group = this._group
    const map = group._map
    const fg = group._featureGroup
    const legOptions = this._group.options.spiderLegPolylineOptions

    group._ignoreMove = true

    // Traverse in ascending order to ensure inner circleMarkers are on top.
    for (let i = 0; i < childMarkers.length; i++) {
      const newPos = map.layerPointToLatLng(positions[i])
      const m = childMarkers[i]

      // Add the leg before the marker
      const leg = new L.Polyline([this._latlng, newPos], legOptions)
      map.addLayer(leg)
      ;(m as any)._spiderLeg = leg

      // Now add the marker
      ;(m as any)._preSpiderfyLatlng = m.getLatLng()
      m.setLatLng(newPos)
      if (m.setZIndexOffset) {
        m.setZIndexOffset(1000000) // Appear on top of everything
      }

      fg.addLayer(m)
    }
    this.setOpacity(0.3)

    group._ignoreMove = false
    group.fire('spiderfied', {
      cluster: this,
      markers: childMarkers,
    })
  }

  _animationUnspiderfy(): void {
    this._noanimationUnspiderfy()
  }
}

// Animated versions
MarkerCluster.prototype._animationSpiderfy = function (
  this: MarkerCluster,
  childMarkers: L.Marker[],
  positions: L.Point[]
): void {
  const me = this
  const group = this._group
  const map = group._map
  const fg = group._featureGroup
  const thisLayerLatLng = this._latlng
  const thisLayerPos = map.latLngToLayerPoint(thisLayerLatLng)
  const svg = L.Path.SVG
  const legOptions = L.extend({}, this._group.options.spiderLegPolylineOptions) // Copy options to modify for animation
  let finalLegOpacity = legOptions.opacity

  if (finalLegOpacity === undefined) {
    finalLegOpacity =
      L.MarkerClusterGroup.prototype.options.spiderLegPolylineOptions.opacity
  }

  if (svg) {
    // Initial opacity is 0 to avoid appearing before animation
    legOptions.opacity = 0
    legOptions.className =
      (legOptions.className || '') + ' leaflet-cluster-spider-leg'
  } else {
    // Ensure opacity is defined
    legOptions.opacity = finalLegOpacity
  }

  group._ignoreMove = true

  // Add markers and spider legs to map, hidden at our center point.
  for (let i = 0; i < childMarkers.length; i++) {
    const m = childMarkers[i]
    const newPos = map.layerPointToLatLng(positions[i])

    // Add the leg before the marker
    const leg = new L.Polyline([thisLayerLatLng, newPos], legOptions)
    map.addLayer(leg)
    ;(m as any)._spiderLeg = leg

    // Explanations: https://jakearchibald.com/2013/animated-line-drawing-svg/
    if (svg) {
      const legPath = leg._path
      const legLength = legPath.getTotalLength() + 0.1 // Avoid remaining dot in Firefox
      legPath.style.strokeDasharray = legLength.toString()
      legPath.style.strokeDashoffset = legLength.toString()
    }

    // If it is a marker, add it now and we'll animate it out
    if (m.setZIndexOffset) {
      m.setZIndexOffset(1000000) // Appear on top of everything
    }
    if ((m as any).clusterHide) {
      ;(m as any).clusterHide()
    }

    // Vectors just get immediately added
    fg.addLayer(m)

    if ((m as any)._setPos) {
      ;(m as any)._setPos(thisLayerPos)
    }
  }

  group._forceLayout()
  group._animationStart()

  // Reveal markers and spider legs
  for (let i = childMarkers.length - 1; i >= 0; i--) {
    const newPos = map.layerPointToLatLng(positions[i])
    const m = childMarkers[i]

    // Move marker to new position
    ;(m as any)._preSpiderfyLatlng = m.getLatLng()
    m.setLatLng(newPos)

    if ((m as any).clusterShow) {
      ;(m as any).clusterShow()
    }

    // Animate leg (delegated to CSS transition)
    if (svg) {
      const leg = (m as any)._spiderLeg
      const legPath = leg._path
      legPath.style.strokeDashoffset = '0'
      leg.setStyle({ opacity: finalLegOpacity })
    }
  }
  this.setOpacity(0.3)

  group._ignoreMove = false

  setTimeout(() => {
    group._animationEnd()
    group.fire('spiderfied', {
      cluster: me,
      markers: childMarkers,
    })
  }, 200)
}

MarkerCluster.prototype._animationUnspiderfy = function (
  this: MarkerCluster,
  zoomDetails?: L.ZoomAnimEvent
): void {
  const me = this
  const group = this._group
  const map = group._map
  const fg = group._featureGroup
  const thisLayerPos = zoomDetails
    ? map._latLngToNewLayerPoint(
        this._latlng,
        zoomDetails.zoom,
        zoomDetails.center
      )
    : map.latLngToLayerPoint(this._latlng)
  const childMarkers = this.getAllChildMarkers(null, true)
  const svg = L.Path.SVG

  group._ignoreMove = true
  group._animationStart()

  // Make us visible and bring the child markers back in
  this.setOpacity(1)
  for (let i = childMarkers.length - 1; i >= 0; i--) {
    const m = childMarkers[i]

    // Marker was added after we were spiderfied
    if (!(m as any)._preSpiderfyLatlng) {
      continue
    }

    // Close any popup to avoid map scroll
    m.closePopup()

    // Fix the location to the real one
    m.setLatLng((m as any)._preSpiderfyLatlng)
    delete (m as any)._preSpiderfyLatlng

    // Hack to override the location to be our center
    let nonAnimatable = true
    if ((m as any)._setPos) {
      ;(m as any)._setPos(thisLayerPos)
      nonAnimatable = false
    }
    if ((m as any).clusterHide) {
      ;(m as any).clusterHide()
      nonAnimatable = false
    }
    if (nonAnimatable) {
      fg.removeLayer(m)
    }

    // Animate the spider leg back in (delegated to CSS transition)
    if (svg) {
      const leg = (m as any)._spiderLeg
      const legPath = leg._path
      const legLength = legPath.getTotalLength() + 0.1
      legPath.style.strokeDashoffset = legLength.toString()
      leg.setStyle({ opacity: 0 })
    }
  }

  group._ignoreMove = false

  setTimeout(() => {
    // If we have only <= one child left, then that marker will be shown on the map, so don't remove it
    let stillThereChildCount = 0
    for (let i = childMarkers.length - 1; i >= 0; i--) {
      const m = childMarkers[i]
      if ((m as any)._spiderLeg) {
        stillThereChildCount++
      }
    }

    for (let i = childMarkers.length - 1; i >= 0; i--) {
      const m = childMarkers[i]

      if (!(m as any)._spiderLeg) {
        continue
      }

      if ((m as any).clusterShow) {
        ;(m as any).clusterShow()
      }
      if (m.setZIndexOffset) {
        m.setZIndexOffset(0)
      }

      if (stillThereChildCount > 1) {
        fg.removeLayer(m)
      }

      map.removeLayer((m as any)._spiderLeg)
      delete (m as any)._spiderLeg
    }
    group._animationEnd()
    group.fire('unspiderfied', {
      cluster: me,
      markers: childMarkers,
    })
  }, 200)
}

// Extend L.MarkerClusterGroup
class MarkerClusterGroupExtended extends L.MarkerClusterGroup {
  _spiderfied: MarkerCluster | null = null

  unspiderfy(): void {
    this._unspiderfy()
  }

  private _spiderfierOnAdd(): void {
    this._map.on('click', this._unspiderfyWrapper, this)

    if (this._map.options.zoomAnimation) {
      this._map.on('zoomstart', this._unspiderfyZoomStart, this)
    }
    // Browsers without zoomAnimation or a big zoom don't fire zoomstart
    this._map.on('zoomend', this._noanimationUnspiderfy, this)

    if (!L.Browser.touch) {
      this._map.getRenderer(this)
      // Needs to happen in the page load, or animations don't work in WebKit
    }
  }

  private _spiderfierOnRemove(): void {
    this._map.off('click', this._unspiderfyWrapper, this)
    this._map.off('zoomstart', this._unspiderfyZoomStart, this)
    this._map.off('zoomanim', this._unspiderfyZoomAnim, this)
    this._map.off('zoomend', this._noanimationUnspiderfy, this)

    // Ensure that markers are back where they should be
    // Use no animation to avoid a sticky leaflet-cluster-anim class on mapPane
    this._noanimationUnspiderfy()
  }

  private _unspiderfyZoomStart(): void {
    if (!this._map) {
      // May have been removed from the map by a zoomEnd handler
      return
    }

    this._map.on('zoomanim', this._unspiderfyZoomAnim, this)
  }

  private _unspiderfyZoomAnim(zoomDetails: L.ZoomAnimEvent): void {
    // Wait until the first zoomanim after the user has finished touch-zooming
    if (L.DomUtil.hasClass(this._map._mapPane, 'leaflet-touching')) {
      return
    }

    this._map.off('zoomanim', this._unspiderfyZoomAnim, this)
    this._unspiderfy(zoomDetails)
  }

  private _unspiderfyWrapper(): void {
    this._unspiderfy()
  }

  private _unspiderfy(zoomDetails?: L.ZoomAnimEvent): void {
    if (this._spiderfied) {
      this._spiderfied.unspiderfy(zoomDetails)
    }
  }

  private _noanimationUnspiderfy(): void {
    if (this._spiderfied) {
      this._spiderfied._noanimationUnspiderfy()
    }
  }

  // If the given layer is currently being spiderfied then we unspiderfy it
  _unspiderfyLayer(layer: L.Layer): void {
    if ((layer as any)._spiderLeg) {
      this._featureGroup.removeLayer(layer)

      if ((layer as any).clusterShow) {
        ;(layer as any).clusterShow()
      }
      // Position will be fixed up immediately in _animationUnspiderfy
      if ((layer as any).setZIndexOffset) {
        ;(layer as any).setZIndexOffset(0)
      }

      this._map.removeLayer((layer as any)._spiderLeg)
      delete (layer as any)._spiderLeg
    }
  }
}

// Assign the extended classes to the local L object
L.MarkerCluster = MarkerCluster
L.MarkerClusterNonAnimated = MarkerClusterNonAnimated
L.MarkerClusterGroup = MarkerClusterGroupExtended

// Export the local L object and extended classes
export {
  L,
  MarkerCluster,
  MarkerClusterNonAnimated,
  MarkerClusterGroupExtended,
}
