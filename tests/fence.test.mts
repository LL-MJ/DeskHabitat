import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fenceConnectionKey,
  rasterizeFenceStroke,
} from '../src/shared/fence.ts';

describe('manual fence strokes', () => {
  it('rasterizes horizontal and diagonal drags into adjacent cells', () => {
    assert.deepEqual(
      rasterizeFenceStroke({ x: 1, y: 2 }, { x: 4, y: 2 }),
      [
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ],
    );
    assert.deepEqual(
      rasterizeFenceStroke({ x: 1, y: 1 }, { x: 3, y: 3 }),
      [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
    );
  });

  it('uses the same connection identity in both directions', () => {
    assert.equal(
      fenceConnectionKey({ x: 2, y: 3 }, { x: 3, y: 4 }),
      fenceConnectionKey({ x: 3, y: 4 }, { x: 2, y: 3 }),
    );
  });

});
