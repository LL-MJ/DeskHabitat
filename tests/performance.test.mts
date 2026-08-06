import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { describe, it } from 'node:test';

import { FacilitySystem } from '../src/shared/facility.ts';
import { NavigationGrid } from '../src/shared/navigation.ts';
import { RabbitModel } from '../src/shared/rabbit.ts';

describe('accelerated baseline habitat', () => {
  it('simulates 30 minutes with 50 fence cells and 10 facilities', () => {
    const fenceCells = Array.from({ length: 50 }, (_, index) => ({
      x: 6 + (index % 10),
      y: 2 + Math.floor(index / 10),
    }));
    const navigation = new NavigationGrid({
      columns: 24,
      rows: 16,
      blocked: fenceCells,
    });
    const facilities = new FacilitySystem(
      navigation,
      Array.from({ length: 10 }, (_, index) => ({
        id: `benchmark_${index}`,
        kind: index % 2 === 0 ? 'foodBowl' as const : 'waterBowl' as const,
        cell: {
          x: 1 + (index % 5) * 4,
          y: index < 5 ? 0 : 15,
        },
        capacity: 10_000,
        maxCapacity: 10_000,
      })),
    );
    const rabbit = new RabbitModel({
      columns: 24,
      rows: 16,
      navigation,
      facilities,
    });

    const startedAt = performance.now();
    for (let step = 0; step < 18_000; step += 1) rabbit.step(0.1);
    const elapsedMilliseconds = performance.now() - startedAt;
    const snapshot = rabbit.getSnapshot();

    assert.ok(elapsedMilliseconds < 5_000);
    assert.ok(snapshot.position.x >= 0 && snapshot.position.x < 24);
    assert.ok(snapshot.position.y >= 0 && snapshot.position.y < 16);
    assert.ok(snapshot.needs.hunger >= 0 && snapshot.needs.hunger <= 100);
    assert.ok(snapshot.needs.thirst >= 0 && snapshot.needs.thirst <= 100);
    assert.ok(snapshot.needs.energy >= 0 && snapshot.needs.energy <= 100);
  });
});
