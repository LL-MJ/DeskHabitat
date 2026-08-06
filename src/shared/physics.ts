import type { Point } from './isometric';

export interface AppleSnapshot {
  id: string;
  position: Point;
  velocity: Point;
  z: number;
  velocityZ: number;
}

export interface CircleObstacle {
  position: Point;
  radius: number;
}

export interface SegmentObstacle {
  a: Point;
  b: Point;
  radius: number;
}

export interface ApplePhysicsStepContext {
  rabbitPosition?: Point;
  rabbitVelocity?: Point;
  circles?: readonly CircleObstacle[];
  segments?: readonly SegmentObstacle[];
}

export interface ApplePhysicsOptions {
  columns: number;
  rows: number;
  random?: () => number;
  maxApples?: number;
  initialApples?: readonly AppleSnapshot[];
}

const APPLE_RADIUS = 0.12;
const GRAVITY = 5.8;
const GROUND_FRICTION = 3.6;
const AIR_FRICTION = 0.35;
const BOUNCE_FACTOR = 0.3;
const MIN_BOUNCE_SPEED = 0.65;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export class ApplePhysicsWorld {
  readonly columns: number;
  readonly rows: number;
  readonly maxApples: number;
  private readonly random: () => number;
  private readonly apples = new Map<string, AppleSnapshot>();
  private idCounter = 1;

  constructor(options: ApplePhysicsOptions) {
    if (!Number.isInteger(options.columns) || options.columns < 2) {
      throw new RangeError('Apple physics columns must be at least 2.');
    }
    if (!Number.isInteger(options.rows) || options.rows < 2) {
      throw new RangeError('Apple physics rows must be at least 2.');
    }
    this.columns = options.columns;
    this.rows = options.rows;
    this.random = options.random ?? Math.random;
    this.maxApples = options.maxApples ?? 12;
    if (!Number.isInteger(this.maxApples) || this.maxApples < 1) {
      throw new RangeError('Maximum apple count must be a positive integer.');
    }

    for (const apple of options.initialApples ?? []) {
      if (this.apples.size >= this.maxApples) break;
      if (!this.isValidSnapshot(apple) || this.apples.has(apple.id)) continue;
      this.apples.set(apple.id, this.clampSnapshot(apple));
      const suffix = /_(\d+)$/.exec(apple.id)?.[1];
      if (suffix) this.idCounter = Math.max(this.idCounter, Number(suffix) + 1);
    }
  }

  get count(): number {
    return this.apples.size;
  }

  getSnapshots(): AppleSnapshot[] {
    return [...this.apples.values()].map((apple) => ({
      ...apple,
      position: { ...apple.position },
      velocity: { ...apple.velocity },
    }));
  }

  spawnFromTree(treePosition: Point): AppleSnapshot | null {
    if (!isFinitePoint(treePosition) || this.apples.size >= this.maxApples) {
      return null;
    }
    const angle = clamp(this.random(), 0, 1) * Math.PI * 2;
    const distance = 0.32 + clamp(this.random(), 0, 1) * 0.24;
    const apple: AppleSnapshot = {
      id: `fallen_apple_${this.idCounter++}`,
      position: {
        x: clamp(
          treePosition.x + Math.cos(angle) * distance,
          APPLE_RADIUS,
          this.columns - 1 - APPLE_RADIUS,
        ),
        y: clamp(
          treePosition.y + Math.sin(angle) * distance,
          APPLE_RADIUS,
          this.rows - 1 - APPLE_RADIUS,
        ),
      },
      velocity: {
        x: Math.cos(angle) * 0.08,
        y: Math.sin(angle) * 0.08,
      },
      z: 3.2 + clamp(this.random(), 0, 1) * 0.6,
      velocityZ: 0.15,
    };
    this.apples.set(apple.id, apple);
    return {
      ...apple,
      position: { ...apple.position },
      velocity: { ...apple.velocity },
    };
  }

  step(stepSeconds: number, context: ApplePhysicsStepContext = {}): void {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) return;
    const seconds = Math.min(stepSeconds, 0.1);
    const circles = context.circles ?? [];
    const segments = context.segments ?? [];

    for (const apple of this.apples.values()) {
      const airborne = apple.z > 0 || Math.abs(apple.velocityZ) > 0.0001;
      if (airborne) {
        apple.velocityZ -= GRAVITY * seconds;
        apple.z += apple.velocityZ * seconds;
        if (apple.z <= 0) {
          apple.z = 0;
          if (Math.abs(apple.velocityZ) >= MIN_BOUNCE_SPEED) {
            apple.velocityZ = Math.abs(apple.velocityZ) * BOUNCE_FACTOR;
          } else {
            apple.velocityZ = 0;
          }
        }
      }

      const friction = Math.exp(
        -(apple.z > 0 ? AIR_FRICTION : GROUND_FRICTION) * seconds,
      );
      apple.velocity.x *= friction;
      apple.velocity.y *= friction;

      if (apple.z <= 0.08) this.applyRabbitPush(apple, context);
      apple.position.x += apple.velocity.x * seconds;
      apple.position.y += apple.velocity.y * seconds;
      this.resolveWorldBounds(apple);

      if (apple.z <= 0.08) {
        for (const circle of circles) this.resolveCircle(apple, circle);
        for (const segment of segments) this.resolveSegment(apple, segment);
      }
    }

    const grounded = [...this.apples.values()].filter((apple) => apple.z <= 0.08);
    for (let first = 0; first < grounded.length; first += 1) {
      for (let second = first + 1; second < grounded.length; second += 1) {
        this.resolveApplePair(grounded[first]!, grounded[second]!);
      }
    }
  }

  private applyRabbitPush(
    apple: AppleSnapshot,
    context: ApplePhysicsStepContext,
  ): void {
    const rabbitPosition = context.rabbitPosition;
    const rabbitVelocity = context.rabbitVelocity;
    if (!rabbitPosition || !rabbitVelocity) return;
    const deltaX = apple.position.x - rabbitPosition.x;
    const deltaY = apple.position.y - rabbitPosition.y;
    const distance = Math.hypot(deltaX, deltaY);
    const minimumDistance = 0.3;
    if (distance >= minimumDistance) return;

    const speed = Math.hypot(rabbitVelocity.x, rabbitVelocity.y);
    const directionX = distance > 0.0001 ? deltaX / distance : 1;
    const directionY = distance > 0.0001 ? deltaY / distance : 0;
    const overlap = minimumDistance - distance;
    apple.position.x += directionX * overlap;
    apple.position.y += directionY * overlap;
    if (speed > 0.02) {
      apple.velocity.x += rabbitVelocity.x * 0.9 + directionX * speed * 0.25;
      apple.velocity.y += rabbitVelocity.y * 0.9 + directionY * speed * 0.25;
    }
  }

  private resolveWorldBounds(apple: AppleSnapshot): void {
    const maximumX = this.columns - 1 - APPLE_RADIUS;
    const maximumY = this.rows - 1 - APPLE_RADIUS;
    if (apple.position.x < APPLE_RADIUS || apple.position.x > maximumX) {
      apple.position.x = clamp(apple.position.x, APPLE_RADIUS, maximumX);
      apple.velocity.x *= -0.35;
    }
    if (apple.position.y < APPLE_RADIUS || apple.position.y > maximumY) {
      apple.position.y = clamp(apple.position.y, APPLE_RADIUS, maximumY);
      apple.velocity.y *= -0.35;
    }
  }

  private resolveCircle(apple: AppleSnapshot, obstacle: CircleObstacle): void {
    if (!isFinitePoint(obstacle.position) || obstacle.radius <= 0) return;
    const deltaX = apple.position.x - obstacle.position.x;
    const deltaY = apple.position.y - obstacle.position.y;
    const distance = Math.hypot(deltaX, deltaY);
    const minimumDistance = APPLE_RADIUS + obstacle.radius;
    if (distance >= minimumDistance) return;
    const directionX = distance > 0.0001 ? deltaX / distance : 1;
    const directionY = distance > 0.0001 ? deltaY / distance : 0;
    apple.position.x = obstacle.position.x + directionX * minimumDistance;
    apple.position.y = obstacle.position.y + directionY * minimumDistance;
    const normalSpeed =
      apple.velocity.x * directionX + apple.velocity.y * directionY;
    if (normalSpeed < 0) {
      apple.velocity.x -= normalSpeed * directionX * 1.25;
      apple.velocity.y -= normalSpeed * directionY * 1.25;
    }
  }

  private resolveSegment(apple: AppleSnapshot, obstacle: SegmentObstacle): void {
    const segmentX = obstacle.b.x - obstacle.a.x;
    const segmentY = obstacle.b.y - obstacle.a.y;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;
    if (!Number.isFinite(lengthSquared) || lengthSquared <= 0 || obstacle.radius <= 0) {
      return;
    }
    const projection = clamp(
      ((apple.position.x - obstacle.a.x) * segmentX +
        (apple.position.y - obstacle.a.y) * segmentY) /
        lengthSquared,
      0,
      1,
    );
    this.resolveCircle(apple, {
      position: {
        x: obstacle.a.x + segmentX * projection,
        y: obstacle.a.y + segmentY * projection,
      },
      radius: obstacle.radius,
    });
  }

  private resolveApplePair(first: AppleSnapshot, second: AppleSnapshot): void {
    const deltaX = second.position.x - first.position.x;
    const deltaY = second.position.y - first.position.y;
    const distance = Math.hypot(deltaX, deltaY);
    const minimumDistance = APPLE_RADIUS * 2;
    if (distance >= minimumDistance) return;
    const directionX = distance > 0.0001 ? deltaX / distance : 1;
    const directionY = distance > 0.0001 ? deltaY / distance : 0;
    const correction = (minimumDistance - distance) / 2;
    first.position.x -= directionX * correction;
    first.position.y -= directionY * correction;
    second.position.x += directionX * correction;
    second.position.y += directionY * correction;
    const relativeSpeed =
      (second.velocity.x - first.velocity.x) * directionX +
      (second.velocity.y - first.velocity.y) * directionY;
    if (relativeSpeed < 0) {
      const impulse = relativeSpeed * 0.35;
      first.velocity.x += impulse * directionX;
      first.velocity.y += impulse * directionY;
      second.velocity.x -= impulse * directionX;
      second.velocity.y -= impulse * directionY;
    }
  }

  private isValidSnapshot(apple: AppleSnapshot): boolean {
    return (
      typeof apple.id === 'string' &&
      apple.id.length > 0 &&
      isFinitePoint(apple.position) &&
      isFinitePoint(apple.velocity) &&
      Number.isFinite(apple.z) &&
      Number.isFinite(apple.velocityZ)
    );
  }

  private clampSnapshot(apple: AppleSnapshot): AppleSnapshot {
    return {
      id: apple.id,
      position: {
        x: clamp(apple.position.x, APPLE_RADIUS, this.columns - 1 - APPLE_RADIUS),
        y: clamp(apple.position.y, APPLE_RADIUS, this.rows - 1 - APPLE_RADIUS),
      },
      velocity: { ...apple.velocity },
      z: Math.max(0, apple.z),
      velocityZ: apple.velocityZ,
    };
  }
}
