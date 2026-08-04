import type { Point } from './isometric';

export interface GridCell extends Point {
  x: number;
  y: number;
}

export interface NavigationGridOptions {
  columns: number;
  rows: number;
  blocked?: readonly GridCell[];
}

const CARDINAL_DIRECTIONS: readonly GridCell[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function cellKey(cell: GridCell): string {
  return `${cell.x},${cell.y}`;
}

function parseCellKey(key: string): GridCell {
  const [x, y] = key.split(',').map(Number);
  if (x === undefined || y === undefined) {
    throw new TypeError(`Invalid navigation cell key: ${key}`);
  }
  return { x, y };
}

function manhattanDistance(a: GridCell, b: GridCell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function assertGridSize(columns: number, rows: number): void {
  if (!Number.isInteger(columns) || columns < 1) {
    throw new RangeError('Navigation columns must be a positive integer.');
  }
  if (!Number.isInteger(rows) || rows < 1) {
    throw new RangeError('Navigation rows must be a positive integer.');
  }
}

export class NavigationGrid {
  readonly columns: number;
  readonly rows: number;
  private readonly blocked = new Set<string>();
  private navigationVersion = 0;

  constructor(options: NavigationGridOptions) {
    assertGridSize(options.columns, options.rows);
    this.columns = options.columns;
    this.rows = options.rows;
    for (const cell of options.blocked ?? []) this.setBlocked(cell, true);
    this.navigationVersion = 0;
  }

  get version(): number {
    return this.navigationVersion;
  }

  isInside(cell: GridCell): boolean {
    return (
      Number.isInteger(cell.x) &&
      Number.isInteger(cell.y) &&
      cell.x >= 0 &&
      cell.x < this.columns &&
      cell.y >= 0 &&
      cell.y < this.rows
    );
  }

  isWalkable(cell: GridCell): boolean {
    return this.isInside(cell) && !this.blocked.has(cellKey(cell));
  }

  setBlocked(cell: GridCell, blocked: boolean): boolean {
    if (!this.isInside(cell)) {
      throw new RangeError('Blocked navigation cell must be inside the grid.');
    }

    const key = cellKey(cell);
    const changed = blocked ? !this.blocked.has(key) : this.blocked.has(key);
    if (!changed) return false;

    if (blocked) this.blocked.add(key);
    else this.blocked.delete(key);
    this.navigationVersion += 1;
    return true;
  }

  toggleBlocked(cell: GridCell): boolean {
    const nextBlocked = this.isWalkable(cell);
    this.setBlocked(cell, nextBlocked);
    return nextBlocked;
  }

  getBlockedCells(): GridCell[] {
    return [...this.blocked].map(parseCellKey);
  }

  getNeighbors(cell: GridCell): GridCell[] {
    return CARDINAL_DIRECTIONS.map((direction) => ({
      x: cell.x + direction.x,
      y: cell.y + direction.y,
    })).filter((neighbor) => this.isWalkable(neighbor));
  }

  findPath(start: GridCell, goal: GridCell): GridCell[] | null {
    if (!this.isWalkable(start) || !this.isWalkable(goal)) return null;
    if (start.x === goal.x && start.y === goal.y) return [{ ...start }];

    const startKey = cellKey(start);
    const goalKey = cellKey(goal);
    const open = new Set([startKey]);
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>([[startKey, 0]]);
    const fScore = new Map<string, number>([
      [startKey, manhattanDistance(start, goal)],
    ]);

    while (open.size > 0) {
      let currentKey: string | null = null;
      let currentScore = Number.POSITIVE_INFINITY;
      for (const candidate of open) {
        const score = fScore.get(candidate) ?? Number.POSITIVE_INFINITY;
        if (score < currentScore) {
          currentKey = candidate;
          currentScore = score;
        }
      }
      if (currentKey === null) break;
      if (currentKey === goalKey) {
        return this.reconstructPath(cameFrom, currentKey);
      }

      open.delete(currentKey);
      const current = parseCellKey(currentKey);
      for (const neighbor of this.getNeighbors(current)) {
        const neighborKey = cellKey(neighbor);
        const tentativeScore = (gScore.get(currentKey) ?? 0) + 1;
        if (tentativeScore >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
          continue;
        }
        cameFrom.set(neighborKey, currentKey);
        gScore.set(neighborKey, tentativeScore);
        fScore.set(
          neighborKey,
          tentativeScore + manhattanDistance(neighbor, goal),
        );
        open.add(neighborKey);
      }
    }

    return null;
  }

  findNearestWalkable(origin: GridCell): GridCell | null {
    const clamped = {
      x: Math.min(this.columns - 1, Math.max(0, Math.round(origin.x))),
      y: Math.min(this.rows - 1, Math.max(0, Math.round(origin.y))),
    };
    const queue: GridCell[] = [clamped];
    const visited = new Set([cellKey(clamped)]);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (this.isWalkable(current)) return current;

      for (const direction of CARDINAL_DIRECTIONS) {
        const neighbor = {
          x: current.x + direction.x,
          y: current.y + direction.y,
        };
        const key = cellKey(neighbor);
        if (!this.isInside(neighbor) || visited.has(key)) continue;
        visited.add(key);
        queue.push(neighbor);
      }
    }

    return null;
  }

  private reconstructPath(
    cameFrom: ReadonlyMap<string, string>,
    goalKey: string,
  ): GridCell[] {
    const path = [parseCellKey(goalKey)];
    let currentKey = goalKey;
    while (cameFrom.has(currentKey)) {
      currentKey = cameFrom.get(currentKey)!;
      path.push(parseCellKey(currentKey));
    }
    return path.reverse();
  }
}
