import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizePixelRatio } from '../src/shared/runtime.ts';

describe('normalizePixelRatio', () => {
  it('keeps supported pixel ratios unchanged', () => {
    assert.equal(normalizePixelRatio(1), 1);
    assert.equal(normalizePixelRatio(1.5), 1.5);
    assert.equal(normalizePixelRatio(2), 2);
  });

  it('clamps values outside the supported range', () => {
    assert.equal(normalizePixelRatio(0.5), 1);
    assert.equal(normalizePixelRatio(3), 2);
  });

  it('uses a safe fallback for non-finite values', () => {
    assert.equal(normalizePixelRatio(Number.NaN), 1);
    assert.equal(normalizePixelRatio(Number.POSITIVE_INFINITY), 1);
  });
});
