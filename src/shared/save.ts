import type { FacilityKind } from './facility';
import type { DecorationDefinition } from './decoration';
import type { Point } from './isometric';
import type { GridCell } from './navigation';
import type { RabbitFacing, RabbitNeeds, RabbitState } from './rabbit';
import type { WindowLayer } from './window';

export const SAVE_SCHEMA_VERSION = 1;
export const SETTINGS_SCHEMA_VERSION = 1;
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;

const DECORATION_KINDS = new Set([
  'appleTree',
  'shelter',
  'appleBasket',
  'wildflowers',
  'stoneEdge',
]);

function isOrchardDecorationKind(value: unknown): boolean {
  return typeof value === 'string' && DECORATION_KINDS.has(value);
}

function isDecorationRotation(value: unknown): boolean {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

export interface SavedRabbit {
  position: Point;
  needs: RabbitNeeds;
  state: RabbitState;
  facing: RabbitFacing;
}

export interface SavedFacility {
  id: string;
  kind: FacilityKind;
  cell: GridCell;
  capacity: number;
  maxCapacity: number;
  rotation: number;
}

export interface SavedFenceConnection {
  a: GridCell;
  b: GridCell;
}

export interface SaveSnapshot {
  worldId: string;
  columns: number;
  rows: number;
  rabbit: SavedRabbit;
  facilities: SavedFacility[];
  fencePosts: GridCell[];
  fenceConnections: SavedFenceConnection[];
  decorations?: DecorationDefinition[];
  gameTimeSeconds: number;
  lastOnlineAt: string;
}

export interface SaveEnvelope {
  schemaVersion: typeof SAVE_SCHEMA_VERSION;
  appVersion: string;
  savedAt: string;
  data: SaveSnapshot;
}

export interface SaveLoadResult {
  envelope: SaveEnvelope | null;
  source: 'primary' | 'backup' | 'default';
  warning?: string;
}

export interface SaveWriteResult {
  savedAt: string;
}

export interface AppSettings {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  targetDisplayId: number | null;
  maxFps: 30 | 60;
  layer: WindowLayer;
  offlineProgress: boolean;
  onboardingComplete: boolean;
}

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  targetDisplayId: null,
  maxFps: 30,
  layer: 'overlay',
  offlineProgress: true,
  onboardingComplete: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isGridCell(value: unknown): value is GridCell {
  return (
    isRecord(value) &&
    Number.isInteger(value['x']) &&
    Number.isInteger(value['y'])
  );
}

function isPoint(value: unknown): value is Point {
  return (
    isRecord(value) &&
    isFiniteNumber(value['x']) &&
    isFiniteNumber(value['y'])
  );
}

function isNeeds(value: unknown): value is RabbitNeeds {
  return (
    isRecord(value) &&
    ['hunger', 'thirst', 'energy'].every(
      (key) => isFiniteNumber(value[key]) && value[key] >= 0 && value[key] <= 100,
    )
  );
}

const RABBIT_STATES: readonly RabbitState[] = [
  'idle',
  'wander',
  'seekFood',
  'eat',
  'seekWater',
  'drink',
  'rest',
];
const RABBIT_FACINGS: readonly RabbitFacing[] = [
  'north',
  'east',
  'south',
  'west',
];

export function isSaveSnapshot(value: unknown): value is SaveSnapshot {
  if (!isRecord(value)) return false;
  if (
    typeof value['worldId'] !== 'string' ||
    value['worldId'].length === 0 ||
    !Number.isInteger(value['columns']) ||
    !Number.isInteger(value['rows']) ||
    (value['columns'] as number) < 2 ||
    (value['rows'] as number) < 2 ||
    (value['columns'] as number) > 256 ||
    (value['rows'] as number) > 256 ||
    !isFiniteNumber(value['gameTimeSeconds']) ||
    value['gameTimeSeconds'] < 0 ||
    !isIsoDate(value['lastOnlineAt'])
  ) {
    return false;
  }
  const columns = value['columns'] as number;
  const rows = value['rows'] as number;
  const isInside = (cell: GridCell): boolean =>
    cell.x >= 0 && cell.y >= 0 && cell.x < columns && cell.y < rows;
  const rabbit = value['rabbit'];
  if (
    !isRecord(rabbit) ||
    !isPoint(rabbit['position']) ||
    !isNeeds(rabbit['needs']) ||
    !RABBIT_STATES.includes(rabbit['state'] as RabbitState) ||
    !RABBIT_FACINGS.includes(rabbit['facing'] as RabbitFacing) ||
    rabbit['position'].x < 0 ||
    rabbit['position'].y < 0 ||
    rabbit['position'].x > columns - 1 ||
    rabbit['position'].y > rows - 1
  ) {
    return false;
  }
  const facilities = value['facilities'];
  const fencePosts = value['fencePosts'];
  const fenceConnections = value['fenceConnections'];
  const decorations = value['decorations'];
  if (
    !Array.isArray(facilities) ||
    !Array.isArray(fencePosts) ||
    !Array.isArray(fenceConnections) ||
    (decorations !== undefined && !Array.isArray(decorations)) ||
    !fencePosts.every(isGridCell) ||
    !fencePosts.every(isInside)
  ) {
    return false;
  }
  const fencePostKeys = new Set(
    fencePosts.map((cell) => `${cell.x},${cell.y}`),
  );
  const ids = new Set<string>();
  const occupiedCells = new Set(fencePostKeys);
  for (const facility of facilities) {
    if (
      !isRecord(facility) ||
      typeof facility['id'] !== 'string' ||
      facility['id'].length === 0 ||
      ids.has(facility['id']) ||
      !['foodBowl', 'waterBowl'].includes(facility['kind'] as string) ||
      !isGridCell(facility['cell']) ||
      !isInside(facility['cell']) ||
      occupiedCells.has(`${facility['cell'].x},${facility['cell'].y}`) ||
      !isFiniteNumber(facility['capacity']) ||
      !isFiniteNumber(facility['maxCapacity']) ||
      facility['capacity'] < 0 ||
      facility['maxCapacity'] <= 0 ||
      facility['capacity'] > facility['maxCapacity'] ||
      !isFiniteNumber(facility['rotation'])
    ) {
      return false;
    }
    ids.add(facility['id']);
    occupiedCells.add(`${facility['cell'].x},${facility['cell'].y}`);
  }
  const decorationIds = new Set<string>();
  if (Array.isArray(decorations)) {
    for (const decoration of decorations) {
      if (
        !isRecord(decoration) ||
        typeof decoration['id'] !== 'string' ||
        decoration['id'].length === 0 ||
        decorationIds.has(decoration['id']) ||
        !isOrchardDecorationKind(decoration['kind']) ||
        !isPoint(decoration['position']) ||
        decoration['position'].x < 0 ||
        decoration['position'].y < 0 ||
        decoration['position'].x > columns - 1 ||
        decoration['position'].y > rows - 1 ||
        !isDecorationRotation(decoration['rotation']) ||
        typeof decoration['mirrored'] !== 'boolean'
      ) {
        return false;
      }
      decorationIds.add(decoration['id']);
    }
  }
  return fenceConnections.every(
    (connection) => {
      if (
        !isRecord(connection) ||
        !isGridCell(connection['a']) ||
        !isGridCell(connection['b'])
      ) {
        return false;
      }
      const deltaX = Math.abs(connection['a'].x - connection['b'].x);
      const deltaY = Math.abs(connection['a'].y - connection['b'].y);
      return (
        fencePostKeys.has(`${connection['a'].x},${connection['a'].y}`) &&
        fencePostKeys.has(`${connection['b'].x},${connection['b'].y}`) &&
        Math.max(deltaX, deltaY) === 1
      );
    },
  );
}

export function parseSaveEnvelope(value: unknown): SaveEnvelope | null {
  if (
    !isRecord(value) ||
    value['schemaVersion'] !== SAVE_SCHEMA_VERSION ||
    typeof value['appVersion'] !== 'string' ||
    !isIsoDate(value['savedAt']) ||
    !isSaveSnapshot(value['data'])
  ) {
    return null;
  }
  return value as unknown as SaveEnvelope;
}

export function parseSettings(value: unknown): AppSettings | null {
  if (
    !isRecord(value) ||
    value['schemaVersion'] !== SETTINGS_SCHEMA_VERSION ||
    (value['targetDisplayId'] !== null &&
      !Number.isInteger(value['targetDisplayId'])) ||
    ![30, 60].includes(value['maxFps'] as number) ||
    !['overlay', 'desktop'].includes(value['layer'] as string) ||
    typeof value['offlineProgress'] !== 'boolean' ||
    (value['onboardingComplete'] !== undefined &&
      typeof value['onboardingComplete'] !== 'boolean')
  ) {
    return null;
  }
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    targetDisplayId: value['targetDisplayId'] as number | null,
    maxFps: value['maxFps'] as 30 | 60,
    layer: value['layer'] as WindowLayer,
    offlineProgress: value['offlineProgress'],
    onboardingComplete: value['onboardingComplete'] ?? false,
  };
}

export function calculateOfflineSeconds(
  lastOnlineAt: string,
  now = Date.now(),
): number {
  const lastOnline = Date.parse(lastOnlineAt);
  if (!Number.isFinite(lastOnline)) return 0;
  return Math.min(
    MAX_OFFLINE_SECONDS,
    Math.max(0, (now - lastOnline) / 1000),
  );
}
