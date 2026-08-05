import { Assets, type Texture } from 'pixi.js';

import type { RabbitFacing } from '../../../shared/rabbit';

export type RabbitAnimation = 'idle' | 'walk' | 'eat' | 'drink' | 'rest';
export type RabbitFrame = 'a' | 'b';
export type RabbitTextureKey =
  `${RabbitAnimation}_${RabbitFrame}_${RabbitFacing}`;
export type RabbitTextureMap = Record<RabbitTextureKey, Texture>;

const FACINGS: readonly RabbitFacing[] = [
  'north',
  'east',
  'south',
  'west',
];
const ANIMATIONS: readonly RabbitAnimation[] = [
  'idle',
  'walk',
  'eat',
  'drink',
  'rest',
];
const FRAMES: readonly RabbitFrame[] = ['a', 'b'];

export async function loadRabbitTextures(): Promise<RabbitTextureMap> {
  const entries = await Promise.all(
    ANIMATIONS.flatMap((animation) =>
      FRAMES.flatMap((frame) =>
        FACINGS.map(async (facing) => {
          const key: RabbitTextureKey = `${animation}_${frame}_${facing}`;
          const url = `./assets/rabbit/rabbit-${animation}_${frame}-${facing}.png`;
          return [key, await Assets.load<Texture>(url)] as const;
        }),
      ),
    ),
  );
  return Object.fromEntries(entries) as RabbitTextureMap;
}
