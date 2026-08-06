import { Assets, Rectangle, Texture } from 'pixi.js';

export type OrchardTextureKey =
  | 'grassTile'
  | 'appleTree'
  | 'shelter'
  | 'appleBasket'
  | 'wildflowers'
  | 'stoneEdge'
  | 'soilEdge'
  | 'fallenApple';

export type OrchardTextureMap = Record<OrchardTextureKey, Texture>;

const ORCHARD_TEXTURE_URLS: Record<OrchardTextureKey, string> = {
  grassTile: './assets/orchard/grass-tile.png',
  appleTree: './assets/orchard/apple-tree.png',
  shelter: './assets/orchard/shelter.png',
  appleBasket: './assets/orchard/apple-basket.png',
  wildflowers: './assets/orchard/wildflowers.png',
  stoneEdge: './assets/orchard/stone-edge.png',
  soilEdge: './assets/orchard/soil-edge.png',
  fallenApple: './assets/orchard/fallen-apple.png',
};

const ORCHARD_TEXTURE_FRAMES: Partial<
  Record<OrchardTextureKey, Rectangle>
> = {
  soilEdge: new Rectangle(0, 307, 1983, 177),
  fallenApple: new Rectangle(488, 457, 279, 305),
};

export async function loadOrchardTextures(): Promise<OrchardTextureMap> {
  const entries = await Promise.all(
    Object.entries(ORCHARD_TEXTURE_URLS).map(async ([key, url]) => {
      const textureKey = key as OrchardTextureKey;
      const texture = await Assets.load<Texture>(url);
      const frame = ORCHARD_TEXTURE_FRAMES[textureKey];
      return [
        textureKey,
        frame ? new Texture({ source: texture.source, frame }) : texture,
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as OrchardTextureMap;
}
