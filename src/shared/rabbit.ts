import type { Point } from './isometric';

export type RabbitState = 'idle' | 'wander';
export type RabbitFacing = 'north' | 'east' | 'south' | 'west';

export interface RabbitSnapshot {
  position: Point;
  state: RabbitState;
  facing: RabbitFacing;
  stateElapsedSeconds: number;
  transitionReason: string;
}

export interface RabbitModelOptions {
  columns: number;
  rows: number;
  random?: () => number;
  speed?: number;
}

const EDGE_PADDING = 0.25;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function selectRabbitFacing(delta: Point): RabbitFacing {
  const screenX = delta.x - delta.y;
  const screenY = delta.x + delta.y;

  if (Math.abs(screenX) > Math.abs(screenY)) {
    return screenX >= 0 ? 'east' : 'west';
  }
  return screenY >= 0 ? 'south' : 'north';
}

export class RabbitModel {
  private readonly columns: number;
  private readonly rows: number;
  private readonly random: () => number;
  private readonly speed: number;
  private readonly position: Point;
  private target: Point | null = null;
  private state: RabbitState = 'idle';
  private facing: RabbitFacing = 'south';
  private stateElapsedSeconds = 0;
  private idleRemainingSeconds = 0.8;
  private transitionReason = 'spawned';

  constructor(options: RabbitModelOptions) {
    if (!Number.isInteger(options.columns) || options.columns < 2) {
      throw new RangeError('Rabbit world columns must be at least 2.');
    }
    if (!Number.isInteger(options.rows) || options.rows < 2) {
      throw new RangeError('Rabbit world rows must be at least 2.');
    }

    this.columns = options.columns;
    this.rows = options.rows;
    this.random = options.random ?? Math.random;
    this.speed = options.speed ?? 0.9;
    if (!Number.isFinite(this.speed) || this.speed <= 0) {
      throw new RangeError('Rabbit speed must be positive.');
    }

    this.position = {
      x: (this.columns - 1) / 2,
      y: (this.rows - 1) / 2,
    };
  }

  getSnapshot(): RabbitSnapshot {
    return {
      position: { ...this.position },
      state: this.state,
      facing: this.facing,
      stateElapsedSeconds: this.stateElapsedSeconds,
      transitionReason: this.transitionReason,
    };
  }

  step(stepSeconds: number): void {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) return;
    this.stateElapsedSeconds += stepSeconds;

    if (this.state === 'idle') {
      this.idleRemainingSeconds -= stepSeconds;
      if (this.idleRemainingSeconds <= 0) this.beginWander();
      return;
    }

    this.moveTowardsTarget(stepSeconds);
  }

  private beginWander(): void {
    const width = this.columns - 1 - EDGE_PADDING * 2;
    const height = this.rows - 1 - EDGE_PADDING * 2;
    this.target = {
      x: EDGE_PADDING + clamp(this.random(), 0, 1) * width,
      y: EDGE_PADDING + clamp(this.random(), 0, 1) * height,
    };
    const delta = {
      x: this.target.x - this.position.x,
      y: this.target.y - this.position.y,
    };
    this.facing = selectRabbitFacing(delta);
    this.transition('wander', 'idle_timer_elapsed');
  }

  private moveTowardsTarget(stepSeconds: number): void {
    if (!this.target) {
      this.beginIdle('missing_target');
      return;
    }

    const deltaX = this.target.x - this.position.x;
    const deltaY = this.target.y - this.position.y;
    const distance = Math.hypot(deltaX, deltaY);
    const distanceThisStep = this.speed * stepSeconds;

    if (distance <= distanceThisStep) {
      this.position.x = this.target.x;
      this.position.y = this.target.y;
      this.beginIdle('wander_target_reached');
      return;
    }

    this.position.x += (deltaX / distance) * distanceThisStep;
    this.position.y += (deltaY / distance) * distanceThisStep;
    this.position.x = clamp(
      this.position.x,
      EDGE_PADDING,
      this.columns - 1 - EDGE_PADDING,
    );
    this.position.y = clamp(
      this.position.y,
      EDGE_PADDING,
      this.rows - 1 - EDGE_PADDING,
    );
    this.facing = selectRabbitFacing({ x: deltaX, y: deltaY });
  }

  private beginIdle(reason: string): void {
    this.target = null;
    this.idleRemainingSeconds = 0.8 + clamp(this.random(), 0, 1) * 1.4;
    this.transition('idle', reason);
  }

  private transition(state: RabbitState, reason: string): void {
    this.state = state;
    this.stateElapsedSeconds = 0;
    this.transitionReason = reason;
  }
}
