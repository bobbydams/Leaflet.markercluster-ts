import L, {
  Marker,
  LatLng,
  LatLngBounds,
  MarkerOptions,
  Map,
  FitBoundsOptions,
} from 'leaflet'

export class MarkerCluster extends Marker {
  options: MarkerOptions = L.Icon.prototype.options
  _group: any
  _zoom: number
  _markers: Marker[] = []
  _childClusters: MarkerCluster[] = []
  _childCount: number = 0
  _iconNeedsUpdate: boolean = true
  _boundsNeedUpdate: boolean = true
  _bounds: LatLngBounds = new LatLngBounds()
  _cLatLng?: LatLng
  _iconObj: any
  _backupLatlng?: LatLng
  _wLatLng?: LatLng
  __parent?: MarkerCluster

  constructor(group: any, zoom: number, a?: Marker, b?: Marker) {
    const latlng = a ? a['_cLatLng'] || a.getLatLng() : new LatLng(0, 0)
    const options = {
      icon: this,
      pane: group.options.clusterPane,
    }
    super(latlng, options)
    this._group = group
    this._zoom = zoom

    if (a) {
      this._addChild(a)
    }
    if (b) {
      this._addChild(b)
    }
  }

  getAllChildMarkers(
    storageArray: Marker[] = [],
    ignoreDraggedMarker: boolean = false
  ): Marker[] {
    for (let i = this._childClusters.length - 1; i >= 0; i--) {
      this._childClusters[i].getAllChildMarkers(
        storageArray,
        ignoreDraggedMarker
      )
    }

    for (let j = this._markers.length - 1; j >= 0; j--) {
      if (ignoreDraggedMarker && this._markers[j]['__dragStart']) {
        continue
      }
      storageArray.push(this._markers[j])
    }

    return storageArray
  }

  getChildCount(): number {
    return this._childCount
  }

  zoomToBounds(fitBoundsOptions?: FitBoundsOptions): void {
    let childClusters = this._childClusters.slice(),
      map = this._group._map as Map,
      boundsZoom = map.getBoundsZoom(this._bounds),
      zoom = this._zoom + 1,
      mapZoom = map.getZoom()

    while (childClusters.length > 0 && boundsZoom > zoom) {
      zoom++
      let newClusters: MarkerCluster[] = []
      for (let i = 0; i < childClusters.length; i++) {
        newClusters = newClusters.concat(childClusters[i]._childClusters)
      }
      childClusters = newClusters
    }

    if (boundsZoom > zoom) {
      this._group._map.setView(this._latlng, zoom)
    } else if (boundsZoom <= mapZoom) {
      this._group._map.setView(this._latlng, mapZoom + 1)
    } else {
      this._group._map.fitBounds(this._bounds, fitBoundsOptions)
    }
  }

  getBounds(): LatLngBounds {
    let bounds = new LatLngBounds()
    bounds.extend(this._bounds)
    return bounds
  }

  _updateIcon(): void {
    this._iconNeedsUpdate = true
    if (this._icon) {
      this.setIcon(this)
    }
  }

  createIcon(): HTMLElement {
    if (this._iconNeedsUpdate) {
      this._iconObj = this._group.options.iconCreateFunction(this)
      this._iconNeedsUpdate = false
    }
    return this._iconObj.createIcon()
  }

  createShadow(): HTMLElement {
    return this._iconObj.createShadow()
  }

  _addChild(
    new1: Marker | MarkerCluster,
    isNotificationFromChild?: boolean
  ): void {
    this._iconNeedsUpdate = true
    this._boundsNeedUpdate = true
    this._setClusterCenter(new1)

    if (new1 instanceof MarkerCluster) {
      if (!isNotificationFromChild) {
        this._childClusters.push(new1)
        new1.__parent = this
      }
      this._childCount += new1._childCount
    } else {
      if (!isNotificationFromChild) {
        this._markers.push(new1)
      }
      this._childCount++
    }

    if (this.__parent) {
      this.__parent._addChild(new1, true)
    }
  }

  _setClusterCenter(child: Marker | MarkerCluster): void {
    if (!this._cLatLng) {
      this._cLatLng = child['_cLatLng'] || child.getLatLng()
    }
  }

  _resetBounds(): void {
    let bounds = this._bounds

    if (bounds._southWest) {
      bounds._southWest.lat = Infinity
      bounds._southWest.lng = Infinity
    }
    if (bounds._northEast) {
      bounds._northEast.lat = -Infinity
      bounds._northEast.lng = -Infinity
    }
  }

  _recalculateBounds(): void {
    let markers = this._markers,
      childClusters = this._childClusters,
      latSum = 0,
      lngSum = 0,
      totalCount = this._childCount

    if (totalCount === 0) {
      return
    }

    this._resetBounds()

    for (let i = 0; i < markers.length; i++) {
      let childLatLng = markers[i].getLatLng()
      this._bounds.extend(childLatLng)
      latSum += childLatLng.lat
      lngSum += childLatLng.lng
    }

    for (let i = 0; i < childClusters.length; i++) {
      let child = childClusters[i]

      if (child._boundsNeedUpdate) {
        child._recalculateBounds()
      }

      this._bounds.extend(child._bounds)

      let childLatLng = child._wLatLng!
      let childCount = child._childCount

      latSum += childLatLng.lat * childCount
      lngSum += childLatLng.lng * childCount
    }

    this._latlng = this._wLatLng = new LatLng(
      latSum / totalCount,
      lngSum / totalCount
    )
    this._boundsNeedUpdate = false
  }

  _addToMap(startPos?: LatLng): void {
    if (startPos) {
      this._backupLatlng = this._latlng
      this.setLatLng(startPos)
    }
    this._group._featureGroup.addLayer(this)
  }

  _recursivelyAnimateChildrenIn(
    bounds: LatLngBounds,
    center: L.Point,
    maxZoom: number
  ): void {
    this._recursively(
      bounds,
      this._group._map.getMinZoom(),
      maxZoom - 1,
      (c: MarkerCluster) => {
        let markers = c._markers
        for (let i = markers.length - 1; i >= 0; i--) {
          let m = markers[i]
          if (m['_icon']) {
            m['_setPos'](center)
            m['clusterHide']()
          }
        }
      },
      (c: MarkerCluster) => {
        let childClusters = c._childClusters
        for (let j = childClusters.length - 1; j >= 0; j--) {
          let cm = childClusters[j]
          if (cm._icon) {
            cm['_setPos'](center)
            cm['clusterHide']()
          }
        }
      }
    )
  }

  _recursivelyAnimateChildrenInAndAddSelfToMap(
    bounds: LatLngBounds,
    mapMinZoom: number,
    previousZoomLevel: number,
    newZoomLevel: number
  ): void {
    this._recursively(bounds, newZoomLevel, mapMinZoom, (c: MarkerCluster) => {
      c._recursivelyAnimateChildrenIn(
        bounds,
        c._group._map.latLngToLayerPoint(c.getLatLng()).round(),
        previousZoomLevel
      )

      if (c._isSingleParent() && previousZoomLevel - 1 === newZoomLevel) {
        c['clusterShow']()
        c._recursivelyRemoveChildrenFromMap(
          bounds,
          mapMinZoom,
          previousZoomLevel
        )
      } else {
        c['clusterHide']()
      }

      c._addToMap()
    })
  }

  _recursivelyBecomeVisible(bounds: LatLngBounds, zoomLevel: number): void {
    this._recursively(
      bounds,
      this._group._map.getMinZoom(),
      zoomLevel,
      null,
      (c: MarkerCluster) => {
        c['clusterShow']()
      }
    )
  }

  _recursivelyAddChildrenToMap(
    startPos: LatLng,
    zoomLevel: number,
    bounds: LatLngBounds
  ): void {
    this._recursively(
      bounds,
      this._group._map.getMinZoom() - 1,
      zoomLevel,
      (c: MarkerCluster) => {
        if (zoomLevel === c._zoom) {
          return
        }

        for (let i = c._markers.length - 1; i >= 0; i--) {
          let nm = c._markers[i]

          if (!bounds.contains(nm.getLatLng())) {
            continue
          }

          if (startPos) {
            nm['_backupLatlng'] = nm.getLatLng()
            nm.setLatLng(startPos)
            if (nm['clusterHide']) {
              nm['clusterHide']()
            }
          }

          c._group._featureGroup.addLayer(nm)
        }
      },
      (c: MarkerCluster) => {
        c._addToMap(startPos)
      }
    )
  }

  _recursivelyRestoreChildPositions(zoomLevel: number): void {
    for (let i = this._markers.length - 1; i >= 0; i--) {
      let nm = this._markers[i]
      if (nm['_backupLatlng']) {
        nm.setLatLng(nm['_backupLatlng'])
        delete nm['_backupLatlng']
      }
    }

    if (zoomLevel - 1 === this._zoom) {
      for (let j = this._childClusters.length - 1; j >= 0; j--) {
        this._childClusters[j]._restorePosition()
      }
    } else {
      for (let k = this._childClusters.length - 1; k >= 0; k--) {
        this._childClusters[k]._recursivelyRestoreChildPositions(zoomLevel)
      }
    }
  }

  _restorePosition(): void {
    if (this._backupLatlng) {
      this.setLatLng(this._backupLatlng)
      delete this._backupLatlng
    }
  }

  _recursivelyRemoveChildrenFromMap(
    previousBounds: LatLngBounds,
    mapMinZoom: number,
    zoomLevel: number,
    exceptBounds?: LatLngBounds
  ): void {
    this._recursively(
      previousBounds,
      mapMinZoom - 1,
      zoomLevel - 1,
      (c: MarkerCluster) => {
        for (let i = c._markers.length - 1; i >= 0; i--) {
          let m = c._markers[i]
          if (!exceptBounds || !exceptBounds.contains(m.getLatLng())) {
            c._group._featureGroup.removeLayer(m)
            if (m['clusterShow']) {
              m['clusterShow']()
            }
          }
        }
      },
      (c: MarkerCluster) => {
        for (let i = c._childClusters.length - 1; i >= 0; i--) {
          let m = c._childClusters[i]
          if (!exceptBounds || !exceptBounds.contains(m.getLatLng())) {
            c._group._featureGroup.removeLayer(m)
            if (m['clusterShow']) {
              m['clusterShow']()
            }
          }
        }
      }
    )
  }

  _recursively(
    boundsToApplyTo: LatLngBounds,
    zoomLevelToStart: number,
    zoomLevelToStop: number,
    runAtEveryLevel: ((c: MarkerCluster) => void) | null,
    runAtBottomLevel: ((c: MarkerCluster) => void) | null
  ): void {
    let childClusters = this._childClusters,
      zoom = this._zoom

    if (zoomLevelToStart <= zoom) {
      if (runAtEveryLevel) {
        runAtEveryLevel(this)
      }
      if (runAtBottomLevel && zoom === zoomLevelToStop) {
        runAtBottomLevel(this)
      }
    }

    if (zoom < zoomLevelToStart || zoom < zoomLevelToStop) {
      for (let i = childClusters.length - 1; i >= 0; i--) {
        let c = childClusters[i]
        if (c._boundsNeedUpdate) {
          c._recalculateBounds()
        }
        if (boundsToApplyTo.intersects(c._bounds)) {
          c._recursively(
            boundsToApplyTo,
            zoomLevelToStart,
            zoomLevelToStop,
            runAtEveryLevel,
            runAtBottomLevel
          )
        }
      }
    }
  }

  _isSingleParent(): boolean {
    return (
      this._childClusters.length > 0 &&
      this._childClusters[0]._childCount === this._childCount
    )
  }
}
