import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FacilitySystem } from '../src/shared/facility.ts';
import { NavigationGrid } from '../src/shared/navigation.ts';

describe('facility targets and capacity', () => {
  it('selects the nearest reachable entrance and occupies its own cell', () => {
    const navigation = new NavigationGrid({ columns: 6, rows: 6 });
    const facilities = new FacilitySystem(navigation, [
      { id: 'far', kind: 'foodBowl', cell: { x: 5, y: 5 } },
      { id: 'near', kind: 'foodBowl', cell: { x: 2, y: 2 } },
    ]);

    assert.equal(navigation.isWalkable({ x: 2, y: 2 }), false);
    const target = facilities.findReachableTarget('foodBowl', { x: 0, y: 0 });
    assert.equal(target?.facilityId, 'near');
    assert.ok(target?.path.every((cell) => navigation.isWalkable(cell)));
  });

  it('ignores unreachable, empty, and explicitly excluded facilities', () => {
    const navigation = new NavigationGrid({
      columns: 5,
      rows: 5,
      blocked: [
        { x: 0, y: 2 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ],
    });
    const facilities = new FacilitySystem(navigation, [
      { id: 'blocked', kind: 'waterBowl', cell: { x: 4, y: 4 } },
      {
        id: 'empty',
        kind: 'waterBowl',
        cell: { x: 0, y: 1 },
        capacity: 0,
      },
      { id: 'usable', kind: 'waterBowl', cell: { x: 4, y: 0 } },
    ]);
    assert.equal(
      facilities.findReachableTarget('waterBowl', { x: 0, y: 0 })
        ?.facilityId,
      'usable',
    );
    assert.equal(
      facilities.findReachableTarget(
        'waterBowl',
        { x: 0, y: 0 },
        new Set(['usable']),
      ),
      null,
    );
  });

  it('marks depleted capacity unavailable and supports refill and removal', () => {
    const navigation = new NavigationGrid({ columns: 4, rows: 4 });
    const facilities = new FacilitySystem(navigation, [
      {
        id: 'water',
        kind: 'waterBowl',
        cell: { x: 2, y: 2 },
        capacity: 5,
        maxCapacity: 10,
      },
    ]);
    assert.equal(facilities.consume('water', 8), 5);
    assert.equal(facilities.isUsable('water'), false);
    assert.equal(facilities.refill('water'), true);
    assert.equal(facilities.getSnapshot('water')?.capacity, 10);
    assert.equal(facilities.remove('water'), true);
    assert.equal(navigation.isWalkable({ x: 2, y: 2 }), true);
  });
});
