import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RabbitModel,
  selectRabbitFacing,
} from '../src/shared/rabbit.ts';
import { NavigationGrid } from '../src/shared/navigation.ts';
import { FacilitySystem } from '../src/shared/facility.ts';
import { FixedStepClock } from '../src/shared/simulation.ts';

describe('fixed-step simulation clock', () => {
  it('runs simulation independently of render frame duration', () => {
    const clock = new FixedStepClock({ stepMilliseconds: 100 });
    const steps: number[] = [];
    assert.equal(clock.advance(60, (step) => steps.push(step)), 0);
    assert.equal(clock.advance(240, (step) => steps.push(step)), 3);
    assert.deepEqual(steps, [0.1, 0.1, 0.1]);
  });

  it('caps catch-up work and can discard paused time', () => {
    const clock = new FixedStepClock({
      stepMilliseconds: 100,
      maxStepsPerFrame: 3,
    });
    let updates = 0;
    assert.equal(clock.advance(5_000, () => updates += 1), 3);
    clock.advance(50, () => updates += 1);
    clock.reset();
    assert.equal(clock.advance(50, () => updates += 1), 0);
    assert.equal(updates, 3);
  });
});

describe('rabbit simulation', () => {
  it('selects all four facings from grid movement', () => {
    assert.equal(selectRabbitFacing({ x: 1, y: 0 }), 'east');
    assert.equal(selectRabbitFacing({ x: -1, y: 0 }), 'west');
    assert.equal(selectRabbitFacing({ x: 0, y: 1 }), 'west');
    assert.equal(selectRabbitFacing({ x: 0, y: -1 }), 'east');
    assert.equal(selectRabbitFacing({ x: 1, y: -1 }), 'east');
    assert.equal(selectRabbitFacing({ x: -1, y: 1 }), 'west');
    assert.equal(selectRabbitFacing({ x: 1, y: 1 }), 'south');
    assert.equal(selectRabbitFacing({ x: -1, y: -1 }), 'north');
  });

  it('alternates between idle and wandering without leaving the map', () => {
    const values = [0, 1, 0.5, 0.25, 0.75];
    let randomIndex = 0;
    const rabbit = new RabbitModel({
      columns: 8,
      rows: 6,
      random: () => values[randomIndex++ % values.length] ?? 0.5,
      speed: 2,
    });

    for (let index = 0; index < 500; index += 1) rabbit.step(0.1);

    const snapshot = rabbit.getSnapshot();
    assert.ok(snapshot.position.x >= 0 && snapshot.position.x <= 7);
    assert.ok(snapshot.position.y >= 0 && snapshot.position.y <= 5);
    assert.ok(snapshot.state === 'idle' || snapshot.state === 'wander');
  });

  it('invalidates its path when the navigation grid changes', () => {
    const navigation = new NavigationGrid({ columns: 5, rows: 5 });
    const rabbit = new RabbitModel({
      columns: 5,
      rows: 5,
      navigation,
      random: () => 0.99,
    });
    for (let index = 0; index < 9; index += 1) rabbit.step(0.1);

    const wandering = rabbit.getSnapshot();
    assert.equal(wandering.state, 'wander');
    assert.ok(wandering.target);
    navigation.setBlocked(wandering.target, true);
    rabbit.step(0.1);

    const recovered = rabbit.getSnapshot();
    assert.equal(recovered.state, 'idle');
    assert.equal(recovered.target, null);
    assert.equal(recovered.repathCount, 1);
    assert.equal(recovered.transitionReason, 'repath_failed');
  });

  it('recovers to the nearest walkable cell if fenced in place', () => {
    const navigation = new NavigationGrid({ columns: 5, rows: 5 });
    const rabbit = new RabbitModel({
      columns: 5,
      rows: 5,
      navigation,
    });
    navigation.setBlocked({ x: 2, y: 2 }, true);
    rabbit.step(0.1);

    const recovered = rabbit.getSnapshot();
    assert.notDeepEqual(recovered.position, { x: 2, y: 2 });
    assert.equal(navigation.isWalkable(recovered.position), true);
    assert.equal(recovered.transitionReason, 'blocked_cell_recovery');
    assert.equal(recovered.repathCount, 1);
  });

  it('seeks reachable food, eats, and keeps needs bounded', () => {
    const navigation = new NavigationGrid({ columns: 5, rows: 5 });
    const facilities = new FacilitySystem(navigation, [
      {
        id: 'food',
        kind: 'foodBowl',
        cell: { x: 4, y: 4 },
        capacity: 100,
      },
    ]);
    const rabbit = new RabbitModel({
      columns: 5,
      rows: 5,
      navigation,
      facilities,
      speed: 4,
      initialNeeds: { hunger: 75, thirst: 0, energy: 100 },
    });

    let satisfied = false;
    for (let index = 0; index < 300; index += 1) {
      rabbit.step(0.1);
      if (rabbit.getSnapshot().transitionReason === 'hunger_satisfied') {
        satisfied = true;
        break;
      }
    }
    const snapshot = rabbit.getSnapshot();
    assert.equal(satisfied, true);
    assert.ok(snapshot.needs.hunger >= 0 && snapshot.needs.hunger <= 15);
    assert.ok(snapshot.needs.thirst >= 0 && snapshot.needs.thirst <= 100);
    assert.ok(snapshot.needs.energy >= 0 && snapshot.needs.energy <= 100);
    assert.ok((facilities.getSnapshot('food')?.capacity ?? 100) < 100);
  });

  it('switches to another facility when the current target is depleted', () => {
    const navigation = new NavigationGrid({ columns: 5, rows: 5 });
    const facilities = new FacilitySystem(navigation, [
      {
        id: 'near_water',
        kind: 'waterBowl',
        cell: { x: 2, y: 1 },
        capacity: 1,
      },
      {
        id: 'backup_water',
        kind: 'waterBowl',
        cell: { x: 4, y: 4 },
        capacity: 100,
      },
    ]);
    const rabbit = new RabbitModel({
      columns: 5,
      rows: 5,
      navigation,
      facilities,
      speed: 4,
      initialNeeds: { hunger: 0, thirst: 90, energy: 100 },
    });

    let selectedBackup = false;
    for (let index = 0; index < 100; index += 1) {
      rabbit.step(0.1);
      if (rabbit.getSnapshot().targetFacilityId === 'backup_water') {
        selectedBackup = true;
        break;
      }
    }
    assert.equal(facilities.isUsable('near_water'), false);
    assert.equal(selectedBackup, true);
  });

  it('safely replaces a facility target that is removed while traveling', () => {
    const navigation = new NavigationGrid({ columns: 6, rows: 6 });
    const facilities = new FacilitySystem(navigation, [
      { id: 'first_food', kind: 'foodBowl', cell: { x: 4, y: 4 } },
      { id: 'backup_food', kind: 'foodBowl', cell: { x: 5, y: 0 } },
    ]);
    const rabbit = new RabbitModel({
      columns: 6,
      rows: 6,
      navigation,
      facilities,
      initialNeeds: { hunger: 90, thirst: 0, energy: 100 },
    });
    rabbit.step(0.1);
    const firstTarget = rabbit.getSnapshot().targetFacilityId;
    assert.ok(firstTarget);
    facilities.remove(firstTarget);
    rabbit.step(0.1);

    const replacement = rabbit.getSnapshot();
    assert.notEqual(replacement.targetFacilityId, firstTarget);
    assert.equal(replacement.state, 'seekFood');
  });

  it('replans when a selected facility is moved during build mode', () => {
    const navigation = new NavigationGrid({ columns: 6, rows: 6 });
    const facilities = new FacilitySystem(navigation, [
      { id: 'food', kind: 'foodBowl', cell: { x: 5, y: 5 } },
    ]);
    const rabbit = new RabbitModel({
      columns: 6,
      rows: 6,
      navigation,
      facilities,
      initialNeeds: { hunger: 90, thirst: 0, energy: 100 },
    });
    rabbit.step(0.1);
    const oldTarget = rabbit.getSnapshot().target;
    assert.equal(facilities.move('food', { x: 0, y: 0 }), true);
    rabbit.step(0.1);

    const replanned = rabbit.getSnapshot();
    assert.equal(replanned.state, 'seekFood');
    assert.equal(replanned.targetFacilityId, 'food');
    assert.notDeepEqual(replanned.target, oldTarget);
    assert.ok(replanned.repathCount >= 1);
  });

  it('rests in place when energy is low', () => {
    const rabbit = new RabbitModel({
      columns: 5,
      rows: 5,
      initialNeeds: { hunger: 0, thirst: 0, energy: 17 },
    });
    const position = rabbit.getSnapshot().position;
    rabbit.step(0.1);
    assert.equal(rabbit.getSnapshot().state, 'rest');
    for (let index = 0; index < 20; index += 1) rabbit.step(0.1);
    assert.deepEqual(rabbit.getSnapshot().position, position);
    assert.ok(rabbit.getSnapshot().needs.energy > 17);
  });
});
