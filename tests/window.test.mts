import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  defaultPointerPassthrough,
  isWindowMode,
} from '../src/shared/window.ts';

describe('window mode validation', () => {
  it('accepts the three supported modes', () => {
    assert.equal(isWindowMode('life'), true);
    assert.equal(isWindowMode('build'), true);
    assert.equal(isWindowMode('paused'), true);
  });

  it('rejects unsupported IPC values', () => {
    assert.equal(isWindowMode('debug'), false);
    assert.equal(isWindowMode(null), false);
    assert.equal(isWindowMode({ mode: 'life' }), false);
  });
});

describe('default pointer passthrough', () => {
  it('captures input only in build mode', () => {
    assert.equal(defaultPointerPassthrough('life'), true);
    assert.equal(defaultPointerPassthrough('paused'), true);
    assert.equal(defaultPointerPassthrough('build'), false);
  });
});
