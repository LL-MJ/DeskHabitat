import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RabbitModel,
  selectRabbitFacing,
} from '../src/shared/rabbit.ts';
import { NavigationGrid } from '../src/shared/navigation.ts';
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
  it('selects a screen-facing direction from grid movement', () => {
    assert.equal(selectRabbitFacing({ x: 1, y: 0 }), 'south');
    assert.equal(selectRabbitFacing({ x: 0, y: 1 }), 'south');
    assert.equal(selectRabbitFacing({ x: 1, y: -1 }), 'east');
    assert.equal(selectRabbitFacing({ x: -1, y: 1 }), 'west');
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
});
