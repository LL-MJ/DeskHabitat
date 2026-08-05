import { Container, Graphics, Sprite, Text } from 'pixi.js';

import { gridToScreen } from '../../shared/isometric';
import type { RabbitFacing, RabbitSnapshot } from '../../shared/rabbit';
import type {
  RabbitTextureKey,
  RabbitTextureMap,
} from '../assets/rabbit';

const STATE_LABELS = {
  idle: '…',
  wander: '♪',
  seekFood: '⌕',
  eat: '🥕',
  seekWater: '⌕',
  drink: '💧',
  rest: 'Zz',
} as const;

const RABBIT_SPRITE_SIZE = 116;
const RABBIT_SPRITE_BASELINE_OFFSET = 2;

export class RabbitView {
  readonly root = new Container({ label: 'rabbit' });
  private readonly art = new Container({ label: 'rabbit-art' });
  private readonly shadow = new Graphics();
  private readonly drawing = new Graphics();
  private readonly sprite: Sprite | null;
  private readonly bubble: Text;
  private facing: RabbitFacing | null = null;
  private textureKey: RabbitTextureKey | null = null;
  private animationSeconds = 0;

  constructor(private readonly textures?: RabbitTextureMap) {
    this.shadow
      .ellipse(0, 2, 29, 10)
      .fill({ color: 0x315242, alpha: 0.22 });
    this.shadow.blendMode = 'multiply';
    this.sprite = textures
      ? new Sprite({ texture: textures.idle_a_south })
      : null;
    if (this.sprite) {
      this.sprite.anchor.set(0.5, 1);
      this.sprite.position.set(0, RABBIT_SPRITE_BASELINE_OFFSET);
      this.sprite.width = RABBIT_SPRITE_SIZE;
      this.sprite.height = RABBIT_SPRITE_SIZE;
      this.sprite.eventMode = 'none';
    }
    this.bubble = new Text({
      text: '…',
      style: {
        fill: 0x355146,
        fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
        fontSize: 16,
        fontWeight: '700',
      },
    });
    this.bubble.anchor.set(0.5);
    this.bubble.position.set(0, -92);
    this.art.addChild(this.shadow);
    if (this.sprite) this.art.addChild(this.sprite);
    else this.art.addChild(this.drawing);
    this.root.addChild(this.art, this.bubble);
  }

  render(snapshot: RabbitSnapshot, elapsedMilliseconds: number): void {
    if (!this.textures && this.facing !== snapshot.facing) {
      this.facing = snapshot.facing;
      this.drawRabbit(snapshot.facing);
    }

    this.animationSeconds += elapsedMilliseconds / 1000;
    const walking =
      snapshot.state === 'wander' ||
      snapshot.state === 'seekFood' ||
      snapshot.state === 'seekWater';
    const animation =
      snapshot.state === 'eat'
        ? 'eat'
        : snapshot.state === 'drink'
          ? 'drink'
          : snapshot.state === 'rest'
            ? 'rest'
            : walking
              ? 'walk'
              : 'idle';
    const animationRate =
      animation === 'walk'
        ? 6
        : animation === 'eat' || animation === 'drink'
          ? 3.5
          : animation === 'rest'
            ? 0.8
            : 1.25;
    const phase = this.animationSeconds * animationRate;
    if (this.textures && this.sprite) {
      const frame = Math.floor(phase) % 2 === 0 ? 'a' : 'b';
      const textureKey: RabbitTextureKey = `${animation}_${frame}_${snapshot.facing}`;
      if (textureKey !== this.textureKey) {
        this.textureKey = textureKey;
        this.sprite.texture = this.textures[textureKey];
      }
      this.art.position.y = 0;
      this.art.rotation = 0;
    } else {
      this.art.position.y = walking
        ? Math.abs(Math.sin(phase)) * -3
        : Math.sin(phase) * 1.5;
      this.art.rotation = walking ? Math.sin(phase) * 0.025 : 0;
    }
    this.bubble.text = STATE_LABELS[snapshot.state];
    this.bubble.alpha = snapshot.state === 'idle' ? 0.72 : 0.5;

    const screenPosition = gridToScreen(snapshot.position);
    this.root.position.set(screenPosition.x, screenPosition.y + 8);
    this.root.zIndex = Math.round(
      (snapshot.position.x + snapshot.position.y) * 1000,
    );
  }

  private drawRabbit(facing: RabbitFacing): void {
    const sideFacing = facing === 'east' || facing === 'west';
    const lookingBack = facing === 'north';
    const direction = facing === 'west' ? -1 : 1;
    const eyeAlpha = lookingBack ? 0 : 1;
    this.drawing.clear();

    this.drawing
      .ellipse(-4 * direction, -27, 25, 28)
      .fill({ color: 0xe8ddd0 })
      .stroke({ color: 0x8e8176, width: 2 });
    this.drawing
      .ellipse(sideFacing ? 8 * direction : -9, -61, 8, 25)
      .fill({ color: 0xeadfd3 })
      .stroke({ color: 0x8e8176, width: 2 });
    this.drawing
      .ellipse(sideFacing ? -4 * direction : 9, -63, 8, 27)
      .fill({ color: 0xf0e6dc })
      .stroke({ color: 0x8e8176, width: 2 });
    this.drawing
      .ellipse(sideFacing ? 8 * direction : -9, -63, 3, 15)
      .fill({ color: 0xd7a9ac, alpha: 0.75 });
    this.drawing
      .ellipse(sideFacing ? -4 * direction : 9, -65, 3, 17)
      .fill({ color: 0xd7a9ac, alpha: 0.75 });
    this.drawing
      .circle(sideFacing ? 15 * direction : 0, -38, 18)
      .fill({ color: lookingBack ? 0xded2c5 : 0xf4ece3 })
      .stroke({ color: 0x8e8176, width: 2 });
    this.drawing
      .circle(sideFacing ? 21 * direction : -7, -42, 2.4)
      .fill({ color: 0x273d35, alpha: eyeAlpha });
    if (!sideFacing) {
      this.drawing.circle(7, -42, 2.4).fill({
        color: 0x273d35,
        alpha: eyeAlpha,
      });
    }
    this.drawing
      .circle(sideFacing ? 32 * direction : 0, -34, 2.5)
      .fill({ color: 0xc8878b, alpha: eyeAlpha });
    this.drawing
      .circle(-27 * direction, -26, 9)
      .fill({ color: 0xf5eee7 })
      .stroke({ color: 0x8e8176, width: 1.5 });
  }
}
