import type { GridCell } from './navigation';

function assertCell(cell: GridCell): void {
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
    throw new TypeError('Fence stroke cells must use integer coordinates.');
  }
}

export function fenceConnectionKey(a: GridCell, b: GridCell): string {
  assertCell(a);
  assertCell(b);
  const first = `${a.x},${a.y}`;
  const second = `${b.x},${b.y}`;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

export function rasterizeFenceStroke(
  start: GridCell,
  end: GridCell,
): GridCell[] {
  assertCell(start);
  assertCell(end);
  const cells = [{ ...start }];
  let current = { ...start };

  while (current.x !== end.x || current.y !== end.y) {
    current = {
      x: current.x + Math.sign(end.x - current.x),
      y: current.y + Math.sign(end.y - current.y),
    };
    cells.push(current);
  }

  return cells;
}
