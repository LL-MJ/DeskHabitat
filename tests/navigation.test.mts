import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NavigationGrid } from '../src/shared/navigation.ts';

describe('navigation grid', () => {
  it('finds the shortest cardinal path around an L-shaped obstacle', () => {
    const grid = new NavigationGrid({
      columns: 6,
      rows: 6,
      blocked: [
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 3, y: 3 },
      ],
    });
    const path = grid.findPath({ x: 1, y: 2 }, { x: 4, y: 2 });
    assert.ok(path);
    assert.deepEqual(path[0], { x: 1, y: 2 });
    assert.deepEqual(path.at(-1), { x: 4, y: 2 });
    assert.ok(path.every((cell) => grid.isWalkable(cell)));
    assert.equal(path.length, 8);
  });

  it('returns null for an unreachable or blocked goal', () => {
    const grid = new NavigationGrid({
      columns: 3,
      rows: 3,
      blocked: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
    });
    assert.equal(grid.findPath({ x: 0, y: 0 }, { x: 2, y: 2 }), null);
    assert.equal(grid.findPath({ x: 0, y: 0 }, { x: 1, y: 1 }), null);
  });

  it('handles identical start and goal cells', () => {
    const grid = new NavigationGrid({ columns: 3, rows: 3 });
    assert.deepEqual(grid.findPath({ x: 1, y: 1 }, { x: 1, y: 1 }), [
      { x: 1, y: 1 },
    ]);
  });

  it('increments its version only when occupancy changes', () => {
    const grid = new NavigationGrid({ columns: 3, rows: 3 });
    assert.equal(grid.version, 0);
    assert.equal(grid.setBlocked({ x: 1, y: 1 }, true), true);
    assert.equal(grid.version, 1);
    assert.equal(grid.setBlocked({ x: 1, y: 1 }, true), false);
    assert.equal(grid.version, 1);
    assert.equal(grid.setBlocked({ x: 1, y: 1 }, false), true);
    assert.equal(grid.version, 2);
  });

  it('finds a safe cell when the current cell becomes blocked', () => {
    const grid = new NavigationGrid({
      columns: 3,
      rows: 3,
      blocked: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
      ],
    });
    const safeCell = grid.findNearestWalkable({ x: 1, y: 1 });
    assert.ok(safeCell);
    assert.equal(grid.isWalkable(safeCell), true);
    assert.equal(
      Math.abs(safeCell.x - 1) + Math.abs(safeCell.y - 1),
      1,
    );
  });
});
