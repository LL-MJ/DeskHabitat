import {
  Application,
  Container,
  Graphics,
  Text,
  type Ticker,
} from 'pixi.js';

import {
  calculateWorldBounds,
  DEFAULT_PROJECTION,
  fitWorldToViewport,
  getTileDiamond,
  gridToScreen,
  screenToGrid,
  type Point,
} from '../../shared/isometric';
import { NavigationGrid, type GridCell } from '../../shared/navigation';
import { RabbitModel } from '../../shared/rabbit';
import { FixedStepClock } from '../../shared/simulation';
import type { WindowMode } from '../../shared/window';
import { RabbitView } from './RabbitView';

export interface WorldViewOptions {
  columns?: number;
  rows?: number;
  debug?: boolean;
}

const GROUND_COLORS = [0x78a96f, 0x83b578] as const;
const GRID_COLOR = 0x315943;
const DEFAULT_FENCES: readonly GridCell[] = [
  { x: 2, y: 1 },
  { x: 2, y: 2 },
  { x: 2, y: 3 },
  { x: 3, y: 3 },
];

function polygon(graphics: Graphics, points: readonly Point[]): Graphics {
  const [first, ...rest] = points;
  if (!first) return graphics;

  graphics.moveTo(first.x, first.y);
  for (const point of rest) graphics.lineTo(point.x, point.y);
  return graphics.closePath();
}

export class WorldView {
  readonly root = new Container({ label: 'world-root' });
  readonly shadowLayer = new Container({ label: 'ground-shadow' });
  readonly groundLayer = new Container({ label: 'ground' });
  readonly decorationLayer = new Container({ label: 'ground-decoration' });
  readonly objectLayer = new Container({ label: 'world-objects' });
  readonly effectLayer = new Container({ label: 'effects' });
  readonly previewLayer = new Container({ label: 'build-preview' });
  readonly debugLayer = new Container({ label: 'world-debug' });
  readonly uiLayer = new Container({ label: 'ui-debug' });

  private readonly columns: number;
  private readonly rows: number;
  private readonly debug: boolean;
  private readonly fpsText: Text | null;
  private readonly navigation: NavigationGrid;
  private readonly rabbit: RabbitModel;
  private readonly rabbitView: RabbitView;
  private readonly navigationDebug = new Graphics({ label: 'path-debug' });
  private fenceViews: Graphics[] = [];
  private readonly simulationClock = new FixedStepClock();
  private mode: WindowMode = 'life';
  private simulationSteps = 0;
  private elapsedMilliseconds = 0;
  private renderedFrames = 0;

  constructor(
    private readonly app: Application,
    options: WorldViewOptions = {},
  ) {
    this.columns = options.columns ?? 8;
    this.rows = options.rows ?? 6;
    this.debug = options.debug ?? false;
    this.objectLayer.sortableChildren = true;
    this.root.addChild(
      this.shadowLayer,
      this.groundLayer,
      this.decorationLayer,
      this.objectLayer,
      this.effectLayer,
      this.previewLayer,
      this.debugLayer,
    );
    this.app.stage.addChild(this.root, this.uiLayer);

    this.drawGround();
    this.navigation = new NavigationGrid({
      columns: this.columns,
      rows: this.rows,
      blocked: DEFAULT_FENCES.filter(
        (cell) => cell.x < this.columns && cell.y < this.rows,
      ),
    });
    this.rabbit = new RabbitModel({
      columns: this.columns,
      rows: this.rows,
      navigation: this.navigation,
    });
    this.rabbitView = new RabbitView();
    this.objectLayer.addChild(this.rabbitView.root);
    this.drawFences();
    this.rabbitView.render(this.rabbit.getSnapshot(), 0);
    if (this.debug) this.debugLayer.addChild(this.navigationDebug);
    this.fpsText = this.debug ? this.createDebugOverlay() : null;
    this.app.ticker.add(this.updateSimulation, this);
    this.app.ticker.add(this.updateDebugOverlay, this);
    this.resize(window.innerWidth, window.innerHeight);
  }

  setMode(mode: WindowMode): void {
    this.mode = mode;
    this.app.ticker.maxFPS = mode === 'build' ? 60 : 30;
    if (mode !== 'life') this.simulationClock.reset();
  }

  resize(width: number, height: number): void {
    const bounds = calculateWorldBounds(
      { columns: this.columns, rows: this.rows },
      DEFAULT_PROJECTION,
    );
    const transform = fitWorldToViewport(bounds, { width, height });
    this.root.position.set(transform.x, transform.y);
    this.root.scale.set(transform.scale);
  }

  toggleFenceAtViewport(viewport: Point): boolean {
    if (this.mode !== 'build') return false;

    const local = {
      x: (viewport.x - this.root.position.x) / this.root.scale.x,
      y: (viewport.y - this.root.position.y) / this.root.scale.y,
    };
    const projected = screenToGrid(local);
    const cell = { x: Math.round(projected.x), y: Math.round(projected.y) };
    if (!this.navigation.isInside(cell)) return false;

    const rabbitPosition = this.rabbit.getSnapshot().position;
    if (
      Math.round(rabbitPosition.x) === cell.x &&
      Math.round(rabbitPosition.y) === cell.y &&
      this.navigation.isWalkable(cell)
    ) {
      return false;
    }

    this.navigation.toggleBlocked(cell);
    this.drawFences();
    this.drawNavigationDebug();
    return true;
  }

  private drawGround(): void {
    const shadow = new Graphics();
    const footprint = [
      getTileDiamond({ x: 0, y: 0 })[0],
      getTileDiamond({ x: this.columns - 1, y: 0 })[1],
      getTileDiamond({ x: this.columns - 1, y: this.rows - 1 })[2],
      getTileDiamond({ x: 0, y: this.rows - 1 })[3],
    ];
    polygon(shadow, footprint)
      .fill({ color: 0x193c2c, alpha: 0.2 })
      .stroke({ color: 0x244d37, alpha: 0.15, width: 8 });
    shadow.position.y = 14;
    this.shadowLayer.addChild(shadow);

    const ground = new Graphics();
    for (let gridY = 0; gridY < this.rows; gridY += 1) {
      for (let gridX = 0; gridX < this.columns; gridX += 1) {
        polygon(ground, getTileDiamond({ x: gridX, y: gridY }))
          .fill({ color: GROUND_COLORS[(gridX + gridY) % 2]! })
          .stroke({ color: 0x527f5c, alpha: 0.42, width: 1 });
      }
    }
    this.groundLayer.addChild(ground);

    if (this.debug) this.drawDebugGrid();
  }

  private drawDebugGrid(): void {
    const grid = new Graphics();
    for (let gridY = 0; gridY < this.rows; gridY += 1) {
      for (let gridX = 0; gridX < this.columns; gridX += 1) {
        polygon(grid, getTileDiamond({ x: gridX, y: gridY })).stroke({
          color: GRID_COLOR,
          alpha: 0.72,
          width: 1.5,
        });

        const center = gridToScreen({ x: gridX, y: gridY });
        const label = new Text({
          text: `${gridX},${gridY}`,
          style: {
            fill: 0x244c38,
            fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
            fontSize: 11,
            fontWeight: '600',
          },
        });
        label.anchor.set(0.5);
        label.position.set(center.x, center.y);
        this.debugLayer.addChild(label);
      }
    }
    this.debugLayer.addChildAt(grid, 0);
  }

  private drawFences(): void {
    for (const fence of this.fenceViews) {
      fence.removeFromParent();
      fence.destroy();
    }
    this.fenceViews = [];

    const blocked = this.navigation.getBlockedCells();
    const blockedKeys = new Set(blocked.map((cell) => `${cell.x},${cell.y}`));
    for (const cell of blocked) {
      const center = gridToScreen(cell);
      const fence = new Graphics({ label: `fence-${cell.x}-${cell.y}` });
      const connections = [
        { x: cell.x + 1, y: cell.y },
        { x: cell.x, y: cell.y + 1 },
        { x: cell.x - 1, y: cell.y },
        { x: cell.x, y: cell.y - 1 },
      ].filter((neighbor) => blockedKeys.has(`${neighbor.x},${neighbor.y}`));

      if (connections.length === 0) {
        fence
          .moveTo(-28, -17)
          .lineTo(28, -17)
          .moveTo(-24, -8)
          .lineTo(24, -8)
          .stroke({ color: 0x8b5e3c, width: 5, cap: 'round' });
      } else {
        for (const neighbor of connections) {
          const neighborCenter = gridToScreen(neighbor);
          const delta = {
            x: neighborCenter.x - center.x,
            y: neighborCenter.y - center.y,
          };
          fence
            .moveTo(0, -18)
            .lineTo(delta.x, delta.y - 18)
            .moveTo(0, -9)
            .lineTo(delta.x, delta.y - 9)
            .stroke({ color: 0x8b5e3c, width: 5, cap: 'round' });
        }
      }

      fence
        .moveTo(0, -31)
        .lineTo(0, 3)
        .stroke({ color: 0x65402b, width: 7, cap: 'round' })
        .circle(0, -31, 4)
        .fill({ color: 0xc08a59 });
      fence.position.set(center.x, center.y);
      fence.zIndex = Math.round((cell.x + cell.y) * 1000) + 50;
      this.objectLayer.addChild(fence);
      this.fenceViews.push(fence);
    }
  }

  private drawNavigationDebug(): void {
    if (!this.debug) return;
    this.navigationDebug.clear();
    const rabbit = this.rabbit.getSnapshot();
    const points = [rabbit.position, ...rabbit.path].map((cell) =>
      gridToScreen(cell),
    );
    const first = points[0];
    if (!first) return;
    this.navigationDebug.moveTo(first.x, first.y);
    for (const point of points.slice(1)) {
      this.navigationDebug.lineTo(point.x, point.y);
    }
    this.navigationDebug.stroke({
      color: 0xfff1a8,
      alpha: 0.92,
      width: 4,
    });
    for (const point of points.slice(1)) {
      this.navigationDebug.circle(point.x, point.y, 5).fill({
        color: 0xffd45c,
        alpha: 0.9,
      });
    }
  }

  private createDebugOverlay(): Text {
    const text = new Text({
      text: 'FPS --',
      style: {
        fill: 0x183c2d,
        fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
        fontSize: 13,
        fontWeight: '600',
      },
    });
    text.position.set(16, 16);
    this.uiLayer.addChild(text);
    return text;
  }

  private updateDebugOverlay(ticker: Ticker): void {
    if (!this.fpsText) return;
    this.elapsedMilliseconds += ticker.deltaMS;
    this.renderedFrames += 1;

    if (this.elapsedMilliseconds >= 500) {
      const fps = Math.round(
        (this.renderedFrames * 1000) / this.elapsedMilliseconds,
      );
      const rabbit = this.rabbit.getSnapshot();
      this.fpsText.text = `FPS ${fps} · SIM ${this.simulationSteps * 2}/s · NAV v${rabbit.navigationVersion}/R${rabbit.repathCount} · ${this.columns}×${this.rows} · Rabbit ${rabbit.state}/${rabbit.facing} · ${this.app.renderer.type}`;
      this.elapsedMilliseconds = 0;
      this.renderedFrames = 0;
      this.simulationSteps = 0;
    }
  }

  private updateSimulation(ticker: Ticker): void {
    if (this.mode !== 'life') return;

    this.simulationSteps += this.simulationClock.advance(
      ticker.deltaMS,
      (stepSeconds) => this.rabbit.step(stepSeconds),
    );
    this.rabbitView.render(this.rabbit.getSnapshot(), ticker.deltaMS);
    this.drawNavigationDebug();
  }
}
