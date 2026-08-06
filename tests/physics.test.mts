import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApplePhysicsWorld } from '../src/shared/physics.ts';

describe('apple physics', () => {
  it('falls, bounces, and settles on the ground', () => {
    const physics = new ApplePhysicsWorld({
      columns: 8,
      rows: 6,
      random: () => 0.5,
    });
    assert.ok(physics.spawnFromTree({ x: 2, y: 2 }));
    let bounced = false;
    for (let index = 0; index < 500; index += 1) {
      physics.step(0.02);
      const apple = physics.getSnapshots()[0]!;
      if (apple.z === 0 && apple.velocityZ > 0) bounced = true;
    }
    const apple = physics.getSnapshots()[0]!;
    assert.equal(bounced, true);
    assert.equal(apple.z, 0);
    assert.equal(apple.velocityZ, 0);
  });

  it('is pushed by a moving rabbit and remains inside the world', () => {
    const physics = new ApplePhysicsWorld({
      columns: 4,
      rows: 4,
      random: () => 0,
      initialApples: [
        {
          id: 'fallen_apple_1',
          position: { x: 1.2, y: 1 },
          velocity: { x: 0, y: 0 },
          z: 0,
          velocityZ: 0,
        },
      ],
    });
    physics.step(0.1, {
      rabbitPosition: { x: 1, y: 1 },
      rabbitVelocity: { x: 1, y: 0 },
    });
    assert.ok(physics.getSnapshots()[0]!.position.x > 1.2);

    for (let index = 0; index < 100; index += 1) physics.step(0.1);
    const apple = physics.getSnapshots()[0]!;
    assert.ok(apple.position.x >= 0.12 && apple.position.x <= 2.88);
    assert.ok(apple.position.y >= 0.12 && apple.position.y <= 2.88);
  });

  it('does not pass through circular or fence-segment obstacles', () => {
    const initialApple = {
      id: 'fallen_apple_1',
      position: { x: 1, y: 1 },
      velocity: { x: 2, y: 0 },
      z: 0,
      velocityZ: 0,
    };
    const physics = new ApplePhysicsWorld({
      columns: 5,
      rows: 5,
      initialApples: [initialApple],
    });
    for (let index = 0; index < 20; index += 1) {
      physics.step(0.02, {
        circles: [{ position: { x: 1.5, y: 1 }, radius: 0.25 }],
        segments: [{ a: { x: 2, y: 0.5 }, b: { x: 2, y: 1.5 }, radius: 0.08 }],
      });
    }
    assert.ok(physics.getSnapshots()[0]!.position.x < 1.5);
  });

  it('caps the number of fallen apples', () => {
    const physics = new ApplePhysicsWorld({
      columns: 8,
      rows: 6,
      maxApples: 2,
      random: () => 0.5,
    });
    assert.ok(physics.spawnFromTree({ x: 2, y: 2 }));
    assert.ok(physics.spawnFromTree({ x: 2, y: 2 }));
    assert.equal(physics.spawnFromTree({ x: 2, y: 2 }), null);
    assert.equal(physics.count, 2);
  });
});
