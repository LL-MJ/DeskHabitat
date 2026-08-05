import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateOfflineSeconds,
  DEFAULT_SETTINGS,
  MAX_OFFLINE_SECONDS,
  parseSaveEnvelope,
  parseSettings,
  SAVE_SCHEMA_VERSION,
  type SaveSnapshot,
} from '../src/shared/save.ts';

const snapshot: SaveSnapshot = {
  worldId: 'test-habitat',
  columns: 8,
  rows: 6,
  rabbit: {
    position: { x: 1.5, y: 2 },
    needs: { hunger: 70, thirst: 60, energy: 80 },
    state: 'wander',
    facing: 'east',
  },
  facilities: [
    {
      id: 'food_bowl_01',
      kind: 'foodBowl',
      cell: { x: 1, y: 1 },
      capacity: 50,
      maxCapacity: 100,
      rotation: 0,
    },
  ],
  fencePosts: [{ x: 2, y: 2 }],
  fenceConnections: [],
  decorations: [
    {
      id: 'apple_tree_01',
      kind: 'appleTree',
      position: { x: 1.25, y: 3.5 },
      rotation: 90,
      mirrored: true,
    },
  ],
  gameTimeSeconds: 120,
  lastOnlineAt: '2026-08-04T00:00:00.000Z',
};

describe('save validation', () => {
  it('accepts a complete versioned save envelope', () => {
    const envelope = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      appVersion: '0.1.0',
      savedAt: '2026-08-04T00:00:00.000Z',
      data: snapshot,
    };
    assert.deepEqual(parseSaveEnvelope(envelope), envelope);
  });

  it('rejects incompatible schemas and invalid world data', () => {
    assert.equal(
      parseSaveEnvelope({
        schemaVersion: 2,
        appVersion: '0.1.0',
        savedAt: '2026-08-04T00:00:00.000Z',
        data: snapshot,
      }),
      null,
    );
    assert.equal(
      parseSaveEnvelope({
        schemaVersion: SAVE_SCHEMA_VERSION,
        appVersion: '0.1.0',
        savedAt: '2026-08-04T00:00:00.000Z',
        data: { ...snapshot, columns: 0 },
      }),
      null,
    );
    assert.equal(
      parseSaveEnvelope({
        schemaVersion: SAVE_SCHEMA_VERSION,
        appVersion: '0.1.0',
        savedAt: '2026-08-04T00:00:00.000Z',
        data: {
          ...snapshot,
          decorations: [
            {
              ...snapshot.decorations![0]!,
              position: { x: 99, y: 2 },
            },
          ],
        },
      }),
      null,
    );
  });
});

describe('settings validation', () => {
  it('keeps settings independent from the world save', () => {
    assert.deepEqual(parseSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
    assert.equal(parseSettings({ ...DEFAULT_SETTINGS, maxFps: 45 }), null);
  });

  it('adds the onboarding flag when loading an earlier v1 settings file', () => {
    const parsed = parseSettings({
      schemaVersion: DEFAULT_SETTINGS.schemaVersion,
      targetDisplayId: null,
      maxFps: 30,
      layer: 'overlay',
      offlineProgress: true,
    });
    assert.equal(parsed?.onboardingComplete, false);
  });
});

describe('offline progress', () => {
  it('caps elapsed time and ignores future timestamps', () => {
    const now = Date.parse('2026-08-04T12:00:00.000Z');
    assert.equal(
      calculateOfflineSeconds('2026-08-04T11:30:00.000Z', now),
      30 * 60,
    );
    assert.equal(
      calculateOfflineSeconds('2026-08-01T00:00:00.000Z', now),
      MAX_OFFLINE_SECONDS,
    );
    assert.equal(
      calculateOfflineSeconds('2026-08-05T00:00:00.000Z', now),
      0,
    );
  });
});
