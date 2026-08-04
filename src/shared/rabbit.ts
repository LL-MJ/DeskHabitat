import type {
  FacilityKind,
  FacilityTarget,
} from './facility';
import type { Point } from './isometric';
import type { GridCell } from './navigation';

export interface RabbitNavigation {
  readonly columns: number;
  readonly rows: number;
  readonly version: number;
  isWalkable(cell: GridCell): boolean;
  findPath(start: GridCell, goal: GridCell): GridCell[] | null;
  findNearestWalkable(origin: GridCell): GridCell | null;
}

export interface RabbitFacilities {
  readonly version: number;
  isUsable(id: string, kind?: FacilityKind): boolean;
  findReachableTarget(
    kind: FacilityKind,
    start: GridCell,
    excludedIds?: ReadonlySet<string>,
  ): FacilityTarget | null;
  consume(id: string, amount: number): number;
}

export type RabbitState =
  | 'idle'
  | 'wander'
  | 'seekFood'
  | 'eat'
  | 'seekWater'
  | 'drink'
  | 'rest';
export type RabbitFacing = 'north' | 'east' | 'south' | 'west';

export interface RabbitNeeds {
  hunger: number;
  thirst: number;
  energy: number;
}

export interface RabbitSnapshot {
  position: Point;
  state: RabbitState;
  facing: RabbitFacing;
  stateElapsedSeconds: number;
  transitionReason: string;
  target: GridCell | null;
  targetFacilityId: string | null;
  path: readonly GridCell[];
  needs: RabbitNeeds;
  navigationVersion: number;
  facilityVersion: number;
  repathCount: number;
}

export interface RabbitModelOptions {
  columns: number;
  rows: number;
  random?: () => number;
  speed?: number;
  navigation?: RabbitNavigation;
  facilities?: RabbitFacilities;
  initialNeeds?: Partial<RabbitNeeds>;
}

const HUNGER_SEEK_THRESHOLD = 70;
const THIRST_SEEK_THRESHOLD = 75;
const NEED_SATISFIED_THRESHOLD = 15;
const REST_THRESHOLD = 18;
const RESTED_THRESHOLD = 85;

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

class OpenRabbitNavigation implements RabbitNavigation {
  readonly version = 0;
  readonly columns: number;
  readonly rows: number;

  constructor(columns: number, rows: number) {
    this.columns = columns;
    this.rows = rows;
  }

  isWalkable(cell: GridCell): boolean {
    return (
      Number.isInteger(cell.x) &&
      Number.isInteger(cell.y) &&
      cell.x >= 0 &&
      cell.x < this.columns &&
      cell.y >= 0 &&
      cell.y < this.rows
    );
  }

  findPath(start: GridCell, goal: GridCell): GridCell[] | null {
    if (!this.isWalkable(start) || !this.isWalkable(goal)) return null;
    const path = [{ ...start }];
    let current = { ...start };
    while (current.x !== goal.x) {
      current = { ...current, x: current.x + Math.sign(goal.x - current.x) };
      path.push(current);
    }
    while (current.y !== goal.y) {
      current = { ...current, y: current.y + Math.sign(goal.y - current.y) };
      path.push(current);
    }
    return path;
  }

  findNearestWalkable(origin: GridCell): GridCell | null {
    const cell = {
      x: clamp(Math.round(origin.x), 0, this.columns - 1),
      y: clamp(Math.round(origin.y), 0, this.rows - 1),
    };
    return this.isWalkable(cell) ? cell : null;
  }
}

export class RabbitModel {
  private readonly columns: number;
  private readonly rows: number;
  private readonly random: () => number;
  private readonly speed: number;
  private readonly navigation: RabbitNavigation;
  private readonly facilities: RabbitFacilities | null;
  private readonly position: Point;
  private readonly needs: RabbitNeeds;
  private readonly failedFacilityIds = new Set<string>();
  private target: GridCell | null = null;
  private targetFacility: { id: string; kind: FacilityKind } | null = null;
  private path: GridCell[] = [];
  private pathIndex = 0;
  private pathVersion = 0;
  private state: RabbitState = 'idle';
  private facing: RabbitFacing = 'south';
  private stateElapsedSeconds = 0;
  private idleRemainingSeconds = 0.8;
  private transitionReason = 'spawned';
  private stuckSeconds = 0;
  private repathCount = 0;

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
    this.navigation =
      options.navigation ??
      new OpenRabbitNavigation(options.columns, options.rows);
    if (
      this.navigation.columns !== options.columns ||
      this.navigation.rows !== options.rows
    ) {
      throw new RangeError('Rabbit world and navigation grid sizes must match.');
    }
    this.facilities = options.facilities ?? null;
    this.speed = options.speed ?? 0.9;
    if (!Number.isFinite(this.speed) || this.speed <= 0) {
      throw new RangeError('Rabbit speed must be positive.');
    }

    this.position = {
      x: Math.floor((this.columns - 1) / 2),
      y: Math.floor((this.rows - 1) / 2),
    };
    this.needs = {
      hunger: clamp(options.initialNeeds?.hunger ?? 40, 0, 100),
      thirst: clamp(options.initialNeeds?.thirst ?? 40, 0, 100),
      energy: clamp(options.initialNeeds?.energy ?? 80, 0, 100),
    };
    this.recoverFromBlockedCell();
  }

  getSnapshot(): RabbitSnapshot {
    return {
      position: { ...this.position },
      state: this.state,
      facing: this.facing,
      stateElapsedSeconds: this.stateElapsedSeconds,
      transitionReason: this.transitionReason,
      target: this.target ? { ...this.target } : null,
      targetFacilityId: this.targetFacility?.id ?? null,
      path: this.path.slice(this.pathIndex).map((cell) => ({ ...cell })),
      needs: { ...this.needs },
      navigationVersion: this.navigation.version,
      facilityVersion: this.facilities?.version ?? 0,
      repathCount: this.repathCount,
    };
  }

  step(stepSeconds: number): void {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) return;
    this.updatePassiveNeeds(stepSeconds);
    if (this.navigation.version !== this.pathVersion) {
      this.handleNavigationChange();
    }
    this.stateElapsedSeconds += stepSeconds;

    switch (this.state) {
      case 'idle':
        if (this.chooseNeedBehavior()) return;
        this.idleRemainingSeconds -= stepSeconds;
        if (this.idleRemainingSeconds <= 0) this.beginWander();
        return;
      case 'wander':
        if (this.chooseNeedBehavior()) return;
        this.moveTowardsTarget(stepSeconds);
        return;
      case 'seekFood':
      case 'seekWater':
        if (!this.validateFacilityTarget()) return;
        this.moveTowardsTarget(stepSeconds);
        return;
      case 'eat':
        this.consumeFacility('foodBowl', 'hunger', stepSeconds);
        return;
      case 'drink':
        this.consumeFacility('waterBowl', 'thirst', stepSeconds);
        return;
      case 'rest':
        this.needs.energy = clamp(this.needs.energy + 18 * stepSeconds, 0, 100);
        if (this.needs.energy >= RESTED_THRESHOLD) {
          this.beginIdle('rest_complete');
        }
        return;
    }
  }

  private updatePassiveNeeds(stepSeconds: number): void {
    this.needs.hunger = clamp(this.needs.hunger + 0.55 * stepSeconds, 0, 100);
    this.needs.thirst = clamp(this.needs.thirst + 0.75 * stepSeconds, 0, 100);
    if (this.state !== 'rest') {
      this.needs.energy = clamp(this.needs.energy - 0.25 * stepSeconds, 0, 100);
    }
  }

  private chooseNeedBehavior(): boolean {
    if (this.needs.thirst >= THIRST_SEEK_THRESHOLD) {
      return this.beginSeeking('waterBowl', 'thirst_threshold');
    }
    if (this.needs.hunger >= HUNGER_SEEK_THRESHOLD) {
      return this.beginSeeking('foodBowl', 'hunger_threshold');
    }
    if (this.needs.energy <= REST_THRESHOLD) {
      this.clearMovement();
      this.transition('rest', 'energy_threshold');
      return true;
    }
    return false;
  }

  private beginSeeking(kind: FacilityKind, reason: string): boolean {
    if (!this.facilities) return false;
    let facilityTarget = this.facilities.findReachableTarget(
      kind,
      this.currentCell(),
      this.failedFacilityIds,
    );
    if (!facilityTarget && this.failedFacilityIds.size > 0) {
      this.failedFacilityIds.clear();
      facilityTarget = this.facilities.findReachableTarget(
        kind,
        this.currentCell(),
      );
    }
    if (!facilityTarget) {
      this.beginIdle(`${kind}_unreachable`);
      return false;
    }

    this.targetFacility = { id: facilityTarget.facilityId, kind };
    this.target = { ...facilityTarget.entrance };
    this.setPath(facilityTarget.path);
    this.transition(
      kind === 'foodBowl' ? 'seekFood' : 'seekWater',
      reason,
    );
    if (facilityTarget.path.length < 2) this.arriveAtTarget();
    return true;
  }

  private validateFacilityTarget(): boolean {
    if (
      this.targetFacility &&
      this.facilities?.isUsable(
        this.targetFacility.id,
        this.targetFacility.kind,
      )
    ) {
      return true;
    }
    const kind = this.targetFacility?.kind;
    if (this.targetFacility) this.failedFacilityIds.add(this.targetFacility.id);
    if (kind && this.beginSeeking(kind, 'facility_target_invalid')) return false;
    this.beginIdle('facility_target_lost');
    return false;
  }

  private consumeFacility(
    kind: FacilityKind,
    need: 'hunger' | 'thirst',
    stepSeconds: number,
  ): void {
    if (!this.validateFacilityTarget() || !this.targetFacility || !this.facilities) {
      return;
    }
    const consumed = this.facilities.consume(
      this.targetFacility.id,
      20 * stepSeconds,
    );
    this.needs[need] = clamp(this.needs[need] - consumed, 0, 100);
    if (this.needs[need] <= NEED_SATISFIED_THRESHOLD) {
      this.failedFacilityIds.clear();
      this.beginIdle(`${need}_satisfied`);
    } else if (consumed <= 0) {
      this.failedFacilityIds.add(this.targetFacility.id);
      if (!this.beginSeeking(kind, 'facility_depleted')) {
        this.beginIdle('no_replacement_facility');
      }
    }
  }

  private beginWander(): void {
    const start = this.currentCell();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const target = {
        x: Math.min(
          this.columns - 1,
          Math.floor(clamp(this.random(), 0, 1) * this.columns),
        ),
        y: Math.min(
          this.rows - 1,
          Math.floor(clamp(this.random(), 0, 1) * this.rows),
        ),
      };
      if (!this.navigation.isWalkable(target)) continue;
      const path = this.navigation.findPath(start, target);
      if (!path || path.length < 2) continue;

      this.target = target;
      this.targetFacility = null;
      this.setPath(path);
      this.transition('wander', 'idle_timer_elapsed');
      return;
    }

    this.beginIdle('no_reachable_wander_target');
  }

  private moveTowardsTarget(stepSeconds: number): void {
    const waypoint = this.path[this.pathIndex];
    if (!this.target || !waypoint) {
      this.beginIdle('missing_target');
      return;
    }

    const previousPosition = { ...this.position };
    const deltaX = waypoint.x - this.position.x;
    const deltaY = waypoint.y - this.position.y;
    const distance = Math.hypot(deltaX, deltaY);
    const distanceThisStep = this.speed * stepSeconds;

    if (distance <= distanceThisStep) {
      this.position.x = waypoint.x;
      this.position.y = waypoint.y;
      this.pathIndex += 1;
      if (this.pathIndex >= this.path.length) {
        this.arriveAtTarget();
        return;
      }
    } else {
      this.position.x += (deltaX / distance) * distanceThisStep;
      this.position.y += (deltaY / distance) * distanceThisStep;
    }

    this.facing = selectRabbitFacing({ x: deltaX, y: deltaY });
    const movement = Math.hypot(
      this.position.x - previousPosition.x,
      this.position.y - previousPosition.y,
    );
    this.stuckSeconds = movement < 0.0001 ? this.stuckSeconds + stepSeconds : 0;
    if (this.stuckSeconds >= 2) this.replan('stuck_recovery');
  }

  private arriveAtTarget(): void {
    this.path = [];
    this.pathIndex = 0;
    this.stuckSeconds = 0;
    if (this.state === 'seekFood') {
      this.transition('eat', 'food_entrance_reached');
    } else if (this.state === 'seekWater') {
      this.transition('drink', 'water_entrance_reached');
    } else {
      this.beginIdle('wander_target_reached');
    }
  }

  private beginIdle(reason: string): void {
    this.clearMovement();
    this.targetFacility = null;
    this.idleRemainingSeconds = 0.8 + clamp(this.random(), 0, 1) * 1.4;
    this.transition('idle', reason);
  }

  private clearMovement(): void {
    this.target = null;
    this.path = [];
    this.pathIndex = 0;
    this.pathVersion = this.navigation.version;
    this.stuckSeconds = 0;
  }

  private transition(state: RabbitState, reason: string): void {
    this.state = state;
    this.stateElapsedSeconds = 0;
    this.transitionReason = reason;
  }

  private currentCell(): GridCell {
    return {
      x: clamp(Math.round(this.position.x), 0, this.columns - 1),
      y: clamp(Math.round(this.position.y), 0, this.rows - 1),
    };
  }

  private setPath(path: GridCell[]): void {
    this.path = path;
    this.pathIndex = 1;
    this.pathVersion = this.navigation.version;
    this.stuckSeconds = 0;
    const waypoint = this.path[this.pathIndex];
    if (waypoint) {
      this.facing = selectRabbitFacing({
        x: waypoint.x - this.position.x,
        y: waypoint.y - this.position.y,
      });
    }
  }

  private handleNavigationChange(): void {
    if (this.recoverFromBlockedCell()) {
      this.pathVersion = this.navigation.version;
      return;
    }
    if (this.state === 'wander') {
      this.replan('navigation_version_changed');
    } else if (this.state === 'seekFood' || this.state === 'seekWater') {
      const kind = this.state === 'seekFood' ? 'foodBowl' : 'waterBowl';
      this.repathCount += 1;
      if (!this.beginSeeking(kind, 'navigation_version_changed')) {
        this.beginIdle('facility_repath_failed');
      }
    }
    this.pathVersion = this.navigation.version;
  }

  private recoverFromBlockedCell(): boolean {
    const current = this.currentCell();
    if (this.navigation.isWalkable(current)) return false;

    const safeCell = this.navigation.findNearestWalkable(current);
    if (!safeCell) {
      this.beginIdle('no_walkable_recovery_cell');
      return true;
    }
    this.position.x = safeCell.x;
    this.position.y = safeCell.y;
    this.beginIdle('blocked_cell_recovery');
    this.repathCount += 1;
    return true;
  }

  private replan(reason: string): void {
    if (this.state === 'seekFood' || this.state === 'seekWater') {
      const kind = this.state === 'seekFood' ? 'foodBowl' : 'waterBowl';
      this.repathCount += 1;
      if (!this.beginSeeking(kind, reason)) this.beginIdle('repath_failed');
      return;
    }
    if (!this.target) {
      this.beginIdle('repath_without_target');
      return;
    }
    const path = this.navigation.findPath(this.currentCell(), this.target);
    this.repathCount += 1;
    if (!path || path.length < 2) {
      this.beginIdle('repath_failed');
      return;
    }
    this.setPath(path);
    this.transitionReason = reason;
  }
}
