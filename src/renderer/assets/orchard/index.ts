import { Assets, type Texture } from 'pixi.js';

export type OrchardTextureKey =
  | 'grassTile'
  | 'appleTree'
  | 'shelter'
  | 'appleBasket'
  | 'wildflowers'
  | 'stoneEdge';

export type OrchardTextureMap = Record<OrchardTextureKey, Texture>;

const ORCHARD_TEXTURE_URLS: Record<OrchardTextureKey, string> = {
  grassTile: './assets/orchard/grass-tile.png',
  appleTree: './assets/orchard/apple-tree.png',
  shelter: './assets/orchard/shelter.png',
  appleBasket: './assets/orchard/apple-basket.png',
  wildflowers: './assets/orchard/wildflowers.png',
  stoneEdge: './assets/orchard/stone-edge.png',
};

export async function loadOrchardTextures(): Promise<OrchardTextureMap> {
  const entries = await Promise.all(
    Object.entries(ORCHARD_TEXTURE_URLS).map(async ([key, url]) => [
      key,
      await Assets.load<Texture>(url),
    ] as const),
  );
  return Object.fromEntries(entries) as OrchardTextureMap;
}
