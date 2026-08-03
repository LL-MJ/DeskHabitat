import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateWorldBounds,
  fitWorldToViewport,
  getTileDiamond,
  gridToScreen,
  screenToGrid,
} from '../src/shared/isometric.ts';

const projection = {
  tileWidth: 128,
  tileHeight: 64,
  origin: { x: 400, y: 120 },
};

describe('isometric coordinate projection', () => {
  it('projects the origin and positive grid coordinates', () => {
    assert.deepEqual(gridToScreen({ x: 0, y: 0 }, projection), {
      x: 400,
      y: 120,
    });
    assert.deepEqual(gridToScreen({ x: 2, y: 1 }, projection), {
      x: 464,
      y: 216,
    });
  });

  it('supports fractional grid coordinates', () => {
    assert.deepEqual(gridToScreen({ x: 1.5, y: 0.5 }, projection), {
      x: 464,
      y: 184,
    });
  });

  it('round trips coordinates within floating-point tolerance', () => {
    const grid = { x: 3.125, y: 6.75 };
    const result = screenToGrid(gridToScreen(grid, projection), projection);
    assert.ok(Math.abs(result.x - grid.x) < 1e-10);
    assert.ok(Math.abs(result.y - grid.y) < 1e-10);
  });
});

describe('isometric world geometry', () => {
  it('returns the four tile vertices in clockwise order', () => {
    assert.deepEqual(getTileDiamond({ x: 0, y: 0 }, projection), [
      { x: 400, y: 88 },
      { x: 464, y: 120 },
      { x: 400, y: 152 },
      { x: 336, y: 120 },
    ]);
  });

  it('calculates bounds for a rectangular grid', () => {
    assert.deepEqual(
      calculateWorldBounds(
        { columns: 8, rows: 6 },
        { ...projection, origin: { x: 0, y: 0 } },
      ),
      { x: -384, y: -32, width: 896, height: 448 },
    );
  });

  it('rejects empty or fractional grids', () => {
    assert.throws(() => calculateWorldBounds({ columns: 0, rows: 4 }));
    assert.throws(() => calculateWorldBounds({ columns: 4.5, rows: 4 }));
  });

  it('centers and scales oversized worlds into the viewport', () => {
    const transform = fitWorldToViewport(
      { x: -400, y: -32, width: 1024, height: 512 },
      { width: 800, height: 600 },
      40,
    );
    assert.equal(transform.scale, 720 / 1024);
    assert.equal(transform.x, 400 - 112 * transform.scale);
    assert.equal(transform.y, 300 - 224 * transform.scale);
  });
});
