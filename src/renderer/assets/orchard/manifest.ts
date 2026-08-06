export interface OrchardAssetDefinition {
  file: string;
  logicalSize: { width: number; height: number };
  anchor: { x: number; y: number };
  footprint: { columns: number; rows: number };
  layer: 'ground' | 'decoration' | 'object';
  grounding?: {
    contact: { width: number; height: number; offsetY: number; alpha: number };
    cast: {
      width: number;
      height: number;
      offsetX: number;
      offsetY: number;
      alpha: number;
    };
    foreground: { width: number; height: number; alpha: number };
  };
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
    grounding: {
      contact: { width: 76, height: 13, offsetY: 10, alpha: 0.34 },
      cast: { width: 188, height: 54, offsetX: 34, offsetY: 18, alpha: 0.14 },
      foreground: { width: 86, height: 13, alpha: 0.56 },
    },
  },
  shelter: {
    file: 'shelter.png',
    logicalSize: { width: 288, height: 256 },
    anchor: { x: 0.5, y: 1 },
    footprint: { columns: 3, rows: 2 },
    layer: 'object',
    grounding: {
      contact: { width: 146, height: 18, offsetY: 10, alpha: 0.3 },
      cast: { width: 224, height: 64, offsetX: 40, offsetY: 19, alpha: 0.13 },
      foreground: { width: 150, height: 12, alpha: 0.48 },
    },
  },
  appleBasket: {
    file: 'apple-basket.png',
    logicalSize: { width: 90, height: 77 },
    anchor: { x: 0.5, y: 1 },
    footprint: { columns: 1, rows: 1 },
    layer: 'object',
    grounding: {
      contact: { width: 48, height: 9, offsetY: 9, alpha: 0.32 },
      cast: { width: 66, height: 20, offsetX: 12, offsetY: 14, alpha: 0.12 },
      foreground: { width: 52, height: 9, alpha: 0.5 },
    },
  },
  wildflowers: {
    file: 'wildflowers.png',
    logicalSize: { width: 58, height: 58 },
    anchor: { x: 0.5, y: 1 },
    footprint: { columns: 1, rows: 1 },
    layer: 'decoration',
    grounding: {
      contact: { width: 25, height: 6, offsetY: 10, alpha: 0.16 },
      cast: { width: 32, height: 10, offsetX: 5, offsetY: 12, alpha: 0.05 },
      foreground: { width: 30, height: 7, alpha: 0.32 },
    },
  },
  stoneEdge: {
    file: 'stone-edge.png',
    logicalSize: { width: 128, height: 78 },
    anchor: { x: 0.5, y: 0.86 },
    footprint: { columns: 1, rows: 1 },
    layer: 'object',
    grounding: {
      contact: { width: 70, height: 11, offsetY: 8, alpha: 0.3 },
      cast: { width: 90, height: 22, offsetX: 14, offsetY: 12, alpha: 0.1 },
      foreground: { width: 72, height: 8, alpha: 0.42 },
    },
  },
} as const satisfies Record<string, OrchardAssetDefinition>;
