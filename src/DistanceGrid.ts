import { Util, Point } from 'leaflet';

export class DistanceGrid {
  private _cellSize: number;
  private _sqCellSize: number;
  private _grid: { [key: number]: { [key: number]: any[] } };
  private _objectPoint: { [key: number]: Point };

  constructor(cellSize: number) {
    this._cellSize = cellSize;
    this._sqCellSize = cellSize * cellSize;
    this._grid = {};
    this._objectPoint = {};
  }

  addObject(obj: any, point: Point): void {
    const x = this._getCoord(point.x);
    const y = this._getCoord(point.y);
    const grid = this._grid;
    const row = (grid[y] = grid[y] || {});
    const cell = (row[x] = row[x] || []);
    const stamp = Util.stamp(obj);

    this._objectPoint[stamp] = point;
    cell.push(obj);
  }

  updateObject(obj: any, point: Point): void {
    this.removeObject(obj);
    this.addObject(obj, point);
  }

  removeObject(obj: any, point: Point): boolean {
    const x = this._getCoord(point.x);
    const y = this._getCoord(point.y);
    const grid = this._grid;
    const row = (grid[y] = grid[y] || {});
    const cell = (row[x] = row[x] || []);
    const stamp = Util.stamp(obj);

    delete this._objectPoint[stamp];

    for (let i = 0, len = cell.length; i < len; i++) {
      if (cell[i] === obj) {
        cell.splice(i, 1);

        if (len === 1) {
          delete row[x];
        }

        return true;
      }
    }

    return false;
  }

  eachObject(fn: (obj: any) => boolean, context?: any): void {
    const grid = this._grid;

    for (const i in grid) {
      const row = grid[i];

      for (const j in row) {
        const cell = row[j];

        for (let k = 0, len = cell.length; k < len; k++) {
          const removed = fn.call(context, cell[k]);
          if (removed) {
            k--;
            len--;
          }
        }
      }
    }
  }

  getNearObject(point: Point): any {
    const x = this._getCoord(point.x);
    const y = this._getCoord(point.y);
    let closestDistSq = this._sqCellSize;
    let closest = null;

    for (let i = y - 1; i <= y + 1; i++) {
      const row = this._grid[i];
      if (row) {
        for (let j = x - 1; j <= x + 1; j++) {
          const cell = row[j];
          if (cell) {
            for (let k = 0, len = cell.length; k < len; k++) {
              const obj = cell[k];
              const dist = this._sqDist(
                this._objectPoint[Util.stamp(obj)],
                point
              );
              if (
                dist < closestDistSq ||
                (dist <= closestDistSq && closest === null)
              ) {
                closestDistSq = dist;
                closest = obj;
              }
            }
          }
        }
      }
    }

    return closest;
  }

  private _getCoord(x: number): number {
    const coord = Math.floor(x / this._cellSize);
    return isFinite(coord) ? coord : x;
  }

  private _sqDist(p: Point, p2: Point): number {
    const dx = p2.x - p.x;
    const dy = p2.y - p.y;
    return dx * dx + dy * dy;
  }
}
