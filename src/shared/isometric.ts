export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Bounds extends Point, Size {}

export interface IsometricProjection {
  tileWidth: number;
  tileHeight: number;
  origin: Point;
}

export interface WorldGrid {
  columns: number;
  rows: number;
}

export interface WorldTransform extends Point {
  scale: number;
}

export const DEFAULT_PROJECTION: Readonly<IsometricProjection> = {
  tileWidth: 128,
  tileHeight: 64,
  origin: { x: 0, y: 0 },
};

export function gridToScreen(
  grid: Point,
  projection: IsometricProjection = DEFAULT_PROJECTION,
): Point {
  return {
    x:
      projection.origin.x +
      ((grid.x - grid.y) * projection.tileWidth) / 2,
    y:
      projection.origin.y +
      ((grid.x + grid.y) * projection.tileHeight) / 2,
  };
}

export function screenToGrid(
  screen: Point,
  projection: IsometricProjection = DEFAULT_PROJECTION,
): Point {
  const normalizedX =
    (screen.x - projection.origin.x) / (projection.tileWidth / 2);
  const normalizedY =
    (screen.y - projection.origin.y) / (projection.tileHeight / 2);

  return {
    x: (normalizedX + normalizedY) / 2,
    y: (normalizedY - normalizedX) / 2,
  };
}

export function getTileDiamond(
  grid: Point,
  projection: IsometricProjection = DEFAULT_PROJECTION,
): readonly [Point, Point, Point, Point] {
  const center = gridToScreen(grid, projection);
  const halfWidth = projection.tileWidth / 2;
  const halfHeight = projection.tileHeight / 2;

  return [
    { x: center.x, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y },
    { x: center.x, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y },
  ];
}

export function calculateWorldBounds(
  grid: WorldGrid,
  projection: IsometricProjection = DEFAULT_PROJECTION,
): Bounds {
  if (!Number.isInteger(grid.columns) || grid.columns < 1) {
    throw new RangeError('World columns must be a positive integer.');
  }
  if (!Number.isInteger(grid.rows) || grid.rows < 1) {
    throw new RangeError('World rows must be a positive integer.');
  }

  const corners = [
    ...getTileDiamond({ x: 0, y: 0 }, projection),
    ...getTileDiamond(
      { x: grid.columns - 1, y: grid.rows - 1 },
      projection,
    ),
    ...getTileDiamond({ x: grid.columns - 1, y: 0 }, projection),
    ...getTileDiamond({ x: 0, y: grid.rows - 1 }, projection),
  ];
  const xValues = corners.map((point) => point.x);
  const yValues = corners.map((point) => point.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function fitWorldToViewport(
  bounds: Bounds,
  viewport: Size,
  padding = 48,
): WorldTransform {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const scale = Math.min(
    1,
    availableWidth / bounds.width,
    availableHeight / bounds.height,
  );

  return {
    x: viewport.width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: viewport.height / 2 - (bounds.y + bounds.height / 2) * scale,
    scale,
  };
}
