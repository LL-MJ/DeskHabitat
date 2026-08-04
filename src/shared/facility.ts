import type { GridCell } from './navigation';

export type FacilityKind = 'foodBowl' | 'waterBowl';

export interface FacilityDefinition {
  id: string;
  kind: FacilityKind;
  cell: GridCell;
  capacity?: number;
  maxCapacity?: number;
}

export interface FacilitySnapshot {
  id: string;
  kind: FacilityKind;
  cell: GridCell;
  capacity: number;
  maxCapacity: number;
  available: boolean;
}

export interface FacilityTarget {
  facilityId: string;
  kind: FacilityKind;
  entrance: GridCell;
  path: GridCell[];
}

export interface FacilityNavigation {
  isWalkable(cell: GridCell): boolean;
  setBlocked(cell: GridCell, blocked: boolean): boolean;
  getNeighbors(cell: GridCell): GridCell[];
  findPath(start: GridCell, goal: GridCell): GridCell[] | null;
}

type FacilityRecord = FacilitySnapshot;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export class FacilitySystem {
  private readonly navigation: FacilityNavigation;
  private readonly facilities = new Map<string, FacilityRecord>();
  private facilityVersion = 0;

  constructor(
    navigation: FacilityNavigation,
    definitions: readonly FacilityDefinition[],
  ) {
    this.navigation = navigation;
    for (const definition of definitions) this.add(definition);
    this.facilityVersion = 0;
  }

  get version(): number {
    return this.facilityVersion;
  }

  getSnapshots(): FacilitySnapshot[] {
    return [...this.facilities.values()].map((facility) => ({
      ...facility,
      cell: { ...facility.cell },
    }));
  }

  getSnapshot(id: string): FacilitySnapshot | null {
    const facility = this.facilities.get(id);
    return facility ? { ...facility, cell: { ...facility.cell } } : null;
  }

  isUsable(id: string, kind?: FacilityKind): boolean {
    const facility = this.facilities.get(id);
    return Boolean(
      facility &&
        facility.available &&
        facility.capacity > 0 &&
        (kind === undefined || facility.kind === kind),
    );
  }

  findReachableTarget(
    kind: FacilityKind,
    start: GridCell,
    excludedIds: ReadonlySet<string> = new Set(),
  ): FacilityTarget | null {
    let best: FacilityTarget | null = null;
    for (const facility of this.facilities.values()) {
      if (
        facility.kind !== kind ||
        !facility.available ||
        facility.capacity <= 0 ||
        excludedIds.has(facility.id)
      ) {
        continue;
      }

      for (const entrance of this.navigation.getNeighbors(facility.cell)) {
        const path = this.navigation.findPath(start, entrance);
        if (!path || (best && path.length >= best.path.length)) continue;
        best = {
          facilityId: facility.id,
          kind,
          entrance: { ...entrance },
          path,
        };
      }
    }
    return best;
  }

  consume(id: string, amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const facility = this.facilities.get(id);
    if (!facility || !facility.available) return 0;

    const consumed = Math.min(amount, facility.capacity);
    facility.capacity -= consumed;
    if (facility.capacity === 0) {
      facility.available = false;
      this.facilityVersion += 1;
    }
    return consumed;
  }

  refill(id: string, amount?: number): boolean {
    const facility = this.facilities.get(id);
    if (!facility) return false;
    const nextCapacity = clamp(
      amount ?? facility.maxCapacity,
      0,
      facility.maxCapacity,
    );
    const changed = nextCapacity !== facility.capacity;
    const availabilityChanged = facility.available !== (nextCapacity > 0);
    facility.capacity = nextCapacity;
    facility.available = nextCapacity > 0;
    if (changed || availabilityChanged) this.facilityVersion += 1;
    return changed;
  }

  remove(id: string): boolean {
    const facility = this.facilities.get(id);
    if (!facility) return false;
    this.navigation.setBlocked(facility.cell, false);
    this.facilities.delete(id);
    this.facilityVersion += 1;
    return true;
  }

  private add(definition: FacilityDefinition): void {
    if (!definition.id || this.facilities.has(definition.id)) {
      throw new TypeError('Facility IDs must be non-empty and unique.');
    }
    if (!this.navigation.isWalkable(definition.cell)) {
      throw new RangeError('Facility cell must be inside and walkable.');
    }
    const maxCapacity = definition.maxCapacity ?? 100;
    if (!Number.isFinite(maxCapacity) || maxCapacity <= 0) {
      throw new RangeError('Facility maximum capacity must be positive.');
    }
    const capacity = clamp(
      definition.capacity ?? maxCapacity,
      0,
      maxCapacity,
    );
    this.navigation.setBlocked(definition.cell, true);
    this.facilities.set(definition.id, {
      id: definition.id,
      kind: definition.kind,
      cell: { ...definition.cell },
      capacity,
      maxCapacity,
      available: capacity > 0,
    });
    this.facilityVersion += 1;
  }
}
