import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  constrainDecorationPosition,
  getShelterPillarCells,
  rotateDecoration,
  snapDecorationPosition,
} from '../src/shared/decoration.ts';

describe('orchard decoration placement', () => {
  it('uses gentle quarter-grid snapping only near a guide', () => {
    assert.deepEqual(snapDecorationPosition({ x: 2.04, y: 1.67 }), {
      x: 2,
      y: 1.67,
    });
  });

  it('keeps each decoration anchor inside its visual safe area', () => {
    assert.deepEqual(
      constrainDecorationPosition('appleTree', { x: -4, y: 20 }, 8, 6),
      { x: 0, y: 5 },
    );
    assert.deepEqual(
      constrainDecorationPosition('shelter', { x: 7, y: 0 }, 8, 6),
      { x: 7, y: 0 },
    );
  });

  it('rotates in isometric quarter turns', () => {
    assert.equal(rotateDecoration(0), 90);
    assert.equal(rotateDecoration(270), 0);
  });

  it('maps shelter legs to four cells while keeping the center open', () => {
    const shelter = {
      id: 'shelter_01',
      kind: 'shelter' as const,
      position: { x: 3, y: 2 },
      rotation: 0 as const,
      mirrored: false,
    };
    assert.deepEqual(getShelterPillarCells(shelter, 8, 6), [
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 2, y: 3 },
      { x: 4, y: 3 },
    ]);
    assert.deepEqual(
      getShelterPillarCells({ ...shelter, rotation: 90 }, 8, 6),
      getShelterPillarCells(shelter, 8, 6),
    );
  });
});
