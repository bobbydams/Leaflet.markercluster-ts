/**
 * QuickHull algorithm implementation in TypeScript.
 *
 * Original JavaScript implementation:
 * http://en.literateprograms.org/Quickhull_(Javascript)
 *
 * Converted to TypeScript and adapted for use with Leaflet.
 *
 * This code is provided under the MIT License.
 */

import LeafletInstance from './LeafletInstance'

const L = LeafletInstance.getInstance()

class QuickHull {
  /**
   * Calculates the distance of a point from a baseline.
   * @param cpt A point to be measured from the baseline.
   * @param bl The baseline, represented by a two-element array of LatLng objects.
   * @returns An approximate distance measure.
   */
  static getDistant(cpt: L.LatLng, bl: [L.LatLng, L.LatLng]): number {
    const vY = bl[1].lat - bl[0].lat
    const vX = bl[0].lng - bl[1].lng
    return vX * (cpt.lat - bl[0].lat) + vY * (cpt.lng - bl[0].lng)
  }

  /**
   * Finds the point most distant from the baseline and the points that remain for consideration.
   * @param baseLine A two-element array of LatLng objects representing the baseline.
   * @param latLngs An array of LatLng objects.
   * @returns An object containing the maximum point and the new points to consider.
   */
  static findMostDistantPointFromBaseLine(
    baseLine: [L.LatLng, L.LatLng],
    latLngs: L.LatLng[]
  ): { maxPoint: L.LatLng | null; newPoints: L.LatLng[] } {
    let maxD = 0
    let maxPt: L.LatLng | null = null
    const newPoints: L.LatLng[] = []

    for (let i = latLngs.length - 1; i >= 0; i--) {
      const pt = latLngs[i]
      const d = this.getDistant(pt, baseLine)

      if (d > 0) {
        newPoints.push(pt)
      } else {
        continue
      }

      if (d > maxD) {
        maxD = d
        maxPt = pt
      }
    }

    return { maxPoint: maxPt, newPoints }
  }

  /**
   * Builds the convex hull from the baseline and the set of points.
   * @param baseLine A two-element array of LatLng objects representing the baseline.
   * @param latLngs An array of LatLng objects.
   * @returns An array of LatLng objects representing the convex hull.
   */
  static buildConvexHull(
    baseLine: [L.LatLng, L.LatLng],
    latLngs: L.LatLng[]
  ): L.LatLng[] {
    let convexHullBaseLines: L.LatLng[] = []
    const t = this.findMostDistantPointFromBaseLine(baseLine, latLngs)

    if (t.maxPoint) {
      convexHullBaseLines = convexHullBaseLines.concat(
        this.buildConvexHull([baseLine[0], t.maxPoint], t.newPoints)
      )
      convexHullBaseLines = convexHullBaseLines.concat(
        this.buildConvexHull([t.maxPoint, baseLine[1]], t.newPoints)
      )
      return convexHullBaseLines
    } else {
      // If there is no more point "outside" the base line, the current base line is part of the convex hull
      return [baseLine[0]]
    }
  }

  /**
   * Computes the convex hull of a set of LatLng points.
   * @param latLngs An array of LatLng objects.
   * @returns An array of LatLng objects representing the convex hull.
   */
  static getConvexHull(latLngs: L.LatLng[]): L.LatLng[] {
    // Find initial baseline
    let maxLat: number | null = null,
      minLat: number | null = null,
      maxLng: number | null = null,
      minLng: number | null = null
    let maxLatPt: L.LatLng | null = null,
      minLatPt: L.LatLng | null = null,
      maxLngPt: L.LatLng | null = null,
      minLngPt: L.LatLng | null = null

    for (let i = latLngs.length - 1; i >= 0; i--) {
      const pt = latLngs[i]
      if (maxLat === null || pt.lat > maxLat) {
        maxLatPt = pt
        maxLat = pt.lat
      }
      if (minLat === null || pt.lat < minLat) {
        minLatPt = pt
        minLat = pt.lat
      }
      if (maxLng === null || pt.lng > maxLng) {
        maxLngPt = pt
        maxLng = pt.lng
      }
      if (minLng === null || pt.lng < minLng) {
        minLngPt = pt
        minLng = pt.lng
      }
    }

    let minPt: L.LatLng | null = null
    let maxPt: L.LatLng | null = null

    if (minLat !== maxLat) {
      minPt = minLatPt
      maxPt = maxLatPt
    } else {
      minPt = minLngPt
      maxPt = maxLngPt
    }

    const ch = ([] as L.LatLng[]).concat(
      this.buildConvexHull([minPt!, maxPt!], latLngs),
      this.buildConvexHull([maxPt!, minPt!], latLngs)
    )
    return ch
  }
}

// Extend L.MarkerCluster with the getConvexHull method
L.MarkerCluster.include({
  getConvexHull: function (this: typeof L.MarkerCluster): L.LatLng[] {
    const childMarkers = this.getAllChildMarkers()
    const points: L.LatLng[] = []

    for (let i = childMarkers.length - 1; i >= 0; i--) {
      const p = childMarkers[i].getLatLng()
      points.push(p)
    }

    return QuickHull.getConvexHull(points)
  },
})

export default QuickHull
