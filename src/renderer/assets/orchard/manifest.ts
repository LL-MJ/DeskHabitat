export interface OrchardAssetDefinition {
  file: string;
  logicalSize: { width: number; height: number };
  anchor: { x: number; y: number };
  footprint: { columns: number; rows: number };
  layer: 'ground' | 'decoration' | 'object';
}

export const ORCHARD_ASSETS = {
  grassTile: {
    file: 'grass-tile.png',
    logicalSize: { width: 128, height: 64 },
    anchor: { x: 0.5, y: 0.5 },
    footprint: { columns: 1, rows: 1 },
    layer: 'ground',
  },
  appleTree: {
    file: 'apple-tree.png',
    logicalSize: { width: 256, height: 232 },
    anchor: { x: 0.5, y: 1 },
    footprint: { columns: 2, rows: 2 },
    layer: 'object',
  },
  shelter: {
    file: 'shelter.png',
    logicalSize: { width: 288, height: 256 },
    anchor: { x: 0.5, y: 1 },
    footprint: { columns: 3, rows: 2 },
    layer: 'object',
  },
  appleBasket: {
    file: 'apple-basket.png',
    logicalSize: { width: 90, height: 77 },
    anchor: { x: 0.5, y: 1 },
    footprint: { columns: 1, rows: 1 },
    layer: 'object',
  },
  wildflowers: {
    file: 'wildflowers.png',
    logicalSize: { width: 96, height: 96 },
    anchor: { x: 0.5, y: 1 },
    footprint: { columns: 1, rows: 1 },
    layer: 'decoration',
  },
  stoneEdge: {
    file: 'stone-edge.png',
    logicalSize: { width: 128, height: 78 },
    anchor: { x: 0.5, y: 0.86 },
    footprint: { columns: 1, rows: 1 },
    layer: 'object',
  },
} as const satisfies Record<string, OrchardAssetDefinition>;
