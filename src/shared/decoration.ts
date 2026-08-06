import type { Point } from './isometric';
import type { GridCell } from './navigation';

export const ORCHARD_DECORATION_KINDS = [
  'appleTree',
  'shelter',
  'appleBasket',
  'wildflowers',
  'stoneEdge',
] as const;

export type OrchardDecorationKind =
  (typeof ORCHARD_DECORATION_KINDS)[number];
export type DecorationRotation = 0 | 90 | 180 | 270;

export interface DecorationDefinition {
  id: string;
  kind: OrchardDecorationKind;
  position: Point;
  rotation: DecorationRotation;
  mirrored: boolean;
}

export const DEFAULT_ORCHARD_DECORATIONS: readonly DecorationDefinition[] = [
  {
    id: 'apple_tree_01',
    kind: 'appleTree',
    position: { x: 1, y: 4 },
    rotation: 0,
    mirrored: false,
  },
  {
    id: 'shelter_01',
    kind: 'shelter',
    position: { x: 5.7, y: 1.1 },
    rotation: 0,
    mirrored: false,
  },
  {
    id: 'apple_basket_01',
    kind: 'appleBasket',
    position: { x: 5, y: 1.7 },
    rotation: 0,
    mirrored: false,
  },
  {
    id: 'wildflowers_01',
    kind: 'wildflowers',
    position: { x: 0.75, y: 4.2 },
    rotation: 0,
    mirrored: false,
  },
  {
    id: 'wildflowers_02',
    kind: 'wildflowers',
    position: { x: 4.6, y: 0.45 },
    rotation: 0,
    mirrored: true,
  },
  {
    id: 'wildflowers_03',
    kind: 'wildflowers',
    position: { x: 6.65, y: 3.6 },
    rotation: 0,
    mirrored: false,
  },
  {
    id: 'stone_edge_01',
    kind: 'stoneEdge',
    position: { x: 5.55, y: 4.7 },
    rotation: 0,
    mirrored: false,
  },
  {
    id: 'stone_edge_02',
    kind: 'stoneEdge',
    position: { x: 6.5, y: 4.7 },
    rotation: 0,
    mirrored: false,
  },
];

const SAFE_INSETS: Record<OrchardDecorationKind, Point> = {
  appleTree: { x: 0, y: 0 },
  shelter: { x: 0, y: 0 },
  appleBasket: { x: 0, y: 0 },
  wildflowers: { x: 0, y: 0 },
  stoneEdge: { x: 0, y: 0 },
};

export function isOrchardDecorationKind(
  value: unknown,
): value is OrchardDecorationKind {
  return ORCHARD_DECORATION_KINDS.includes(value as OrchardDecorationKind);
}

export function isDecorationRotation(
  value: unknown,
): value is DecorationRotation {
  return [0, 90, 180, 270].includes(value as number);
}

function snapAxis(value: number, threshold: number): number {
  const nearestQuarter = Math.round(value * 4) / 4;
  return Math.abs(value - nearestQuarter) <= threshold ? nearestQuarter : value;
}

export function snapDecorationPosition(
  position: Point,
  threshold = 0.07,
): Point {
  return {
    x: snapAxis(position.x, threshold),
    y: snapAxis(position.y, threshold),
  };
}

function clampAxis(value: number, inset: number, cells: number): number {
  const maximum = cells - 1 - inset;
  if (maximum < inset) return (cells - 1) / 2;
  return Math.min(maximum, Math.max(inset, value));
}

export function constrainDecorationPosition(
  kind: OrchardDecorationKind,
  position: Point,
  columns: number,
  rows: number,
): Point {
  const snapped = snapDecorationPosition(position);
  const inset = SAFE_INSETS[kind];
  return {
    x: clampAxis(snapped.x, inset.x, columns),
    y: clampAxis(snapped.y, inset.y, rows),
  };
}

export function rotateDecoration(
  rotation: DecorationRotation,
): DecorationRotation {
  return ((rotation + 90) % 360) as DecorationRotation;
}

export function getShelterPillarCells(
  decoration: DecorationDefinition,
  columns: number,
  rows: number,
): GridCell[] {
  if (decoration.kind !== 'shelter') return [];
  const localOffsets: readonly Point[] = [
    { x: -1, y: -0.5 },
    { x: 1, y: -0.5 },
    { x: -1, y: 0.5 },
    { x: 1, y: 0.5 },
  ];
  const keys = new Set<string>();
  const cells: GridCell[] = [];
  for (const offset of localOffsets) {
    const cell = {
      x: Math.round(decoration.position.x + offset.x),
      y: Math.round(decoration.position.y + offset.y),
    };
    const key = `${cell.x},${cell.y}`;
    if (
      cell.x < 0 ||
      cell.y < 0 ||
      cell.x >= columns ||
      cell.y >= rows ||
      keys.has(key)
    ) {
      continue;
    }
    keys.add(key);
    cells.push(cell);
  }
  return cells;
}
