// Import Leaflet and the markercluster plugin
import * as L from 'leaflet';

// Module augmentation for L.MarkerClusterGroup and L.Marker
declare module 'leaflet' {
  interface MarkerClusterGroup {
    /**
     * Updates the icon of all clusters which are parents of the given marker(s).
     * In singleMarkerMode, also updates the given marker(s) icon.
     * @param layers Optional list of markers (or single marker) whose parent clusters need to be updated.
     * If not provided, retrieves all child markers of this group.
     * Accepts various types:
     * - L.MarkerClusterGroup
     * - L.LayerGroup
     * - Array<L.Marker>
     * - Map of L.Marker
     * - L.MarkerCluster
     * - L.Marker
     * @returns {this}
     */
    refreshClusters(layers?: any): this;

    /**
     * Flags all parent clusters of the given markers as needing an icon update.
     * @param layers Array of L.Marker or an object (map) of L.Marker.
     * @private
     */
    _flagParentsIconsNeedUpdate(
      layers: { [id: string]: L.Marker } | L.Marker[]
    ): void;

    /**
     * Re-draws the icon of the supplied markers.
     * To be used in singleMarkerMode only.
     * @param layers Array of L.Marker or an object (map) of L.Marker.
     * @private
     */
    _refreshSingleMarkerModeMarkers(
      layers: { [id: string]: L.Marker } | L.Marker[]
    ): void;

    // Optionally, declare _overrideMarkerIcon if it's used
    _overrideMarkerIcon?(marker: L.Marker): L.Icon;
  }

  interface Marker {
    /**
     * Updates the given options in the marker's icon and refreshes the marker.
     * @param options Map object of icon options.
     * @param directlyRefreshClusters Optional boolean to trigger
     * MCG.refreshClusters() right away with this single marker.
     * @returns {this}
     */
    refreshIconOptions(
      options: L.IconOptions,
      directlyRefreshClusters?: boolean
    ): this;

    __parent?: any; // Internal property used by the marker cluster plugin
  }

  interface MarkerCluster extends Marker {
    _iconNeedsUpdate?: boolean;
    _group?: MarkerClusterGroup;
    __parent?: any;
    getAllChildMarkers(): L.Marker[];
    _zoom?: number;
  }

  interface MarkerClusterGroupOptions extends L.MarkerClusterGroupOptions {
    singleMarkerMode?: boolean;
  }
}

// Implement the methods
L.MarkerClusterGroup.include({
  refreshClusters: function (
    this: L.MarkerClusterGroup,
    layers?: any
  ): L.MarkerClusterGroup {
    if (!layers) {
      layers = (this as any)._topClusterLevel.getAllChildMarkers();
    } else if (layers instanceof L.MarkerClusterGroup) {
      layers = (layers as any)._topClusterLevel.getAllChildMarkers();
    } else if (layers instanceof L.LayerGroup) {
      layers = layers.getLayers();
    } else if (layers instanceof L.MarkerCluster) {
      layers = layers.getAllChildMarkers();
    } else if (layers instanceof L.Marker) {
      layers = [layers];
    } // else: must be an Array<L.Marker> or an object (map) of L.Marker

    this._flagParentsIconsNeedUpdate(layers);
    (this as any)._refreshClustersIcons();

    // In case of singleMarkerMode, also re-draw the markers.
    if (this.options.singleMarkerMode) {
      this._refreshSingleMarkerModeMarkers(layers);
    }

    return this;
  },

  _flagParentsIconsNeedUpdate: function (
    this: L.MarkerClusterGroup,
    layers: { [id: string]: L.Marker } | L.Marker[]
  ): void {
    let id: string | number;
    let parent: L.MarkerCluster | undefined;

    // Assumes layers is an Array or an Object whose prototype is non-enumerable.
    for (id in layers) {
      const marker = (layers as any)[id] as L.Marker & {
        __parent?: L.MarkerCluster;
      };

      // Flag parent clusters' icon as "dirty", all the way up.
      parent = marker.__parent;
      while (parent) {
        parent._iconNeedsUpdate = true;
        parent = parent.__parent;
      }
    }
  },

  _refreshSingleMarkerModeMarkers: function (
    this: L.MarkerClusterGroup,
    layers: { [id: string]: L.Marker } | L.Marker[]
  ): void {
    let id: string | number;
    let layer: L.Marker;

    for (id in layers) {
      layer = (layers as any)[id];

      // Make sure we do not override markers that do not belong to THIS group.
      if (this.hasLayer(layer)) {
        // Need to re-create the icon first, then re-draw the marker.
        layer.setIcon((this as any)._overrideMarkerIcon(layer));
      }
    }
  },
});

L.Marker.include({
  refreshIconOptions: function (
    this: L.Marker,
    options: L.IconOptions,
    directlyRefreshClusters?: boolean
  ): L.Marker {
    const icon = this.options.icon as L.Icon;

    L.Util.setOptions(icon, options);

    this.setIcon(icon);

    // Shortcut to refresh the associated MCG clusters right away.
    // To be used when refreshing a single marker.
    // Otherwise, better use MCG.refreshClusters() once at the end with
    // the list of modified markers.
    if (directlyRefreshClusters && (this as any).__parent) {
      (this as any).__parent._group.refreshClusters(this);
    }

    return this;
  },
});
