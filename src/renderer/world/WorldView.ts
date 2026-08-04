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
import {
  fenceConnectionKey,
  rasterizeFenceStroke,
} from '../../shared/fence';
import { FacilitySystem } from '../../shared/facility';
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
const FENCE_DWELL_MILLISECONDS = 160;
const DEFAULT_FENCES: readonly GridCell[] = [
  { x: 2, y: 1 },
  { x: 2, y: 2 },
  { x: 2, y: 3 },
  { x: 3, y: 3 },
];

interface FenceConnection {
  a: GridCell;
  b: GridCell;
}

interface FenceStroke {
  start: GridCell;
  last: GridCell;
  candidate: GridCell | null;
  candidateTimer: number | null;
  initiallyBlocked: boolean;
  moved: boolean;
}

function gridCellKey(cell: GridCell): string {
  return `${cell.x},${cell.y}`;
}

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
  private readonly facilities: FacilitySystem;
  private readonly rabbit: RabbitModel;
  private readonly rabbitView: RabbitView;
  private readonly debugBackdrop = new Graphics({ label: 'debug-backdrop' });
  private readonly navigationDebug = new Graphics({ label: 'path-debug' });
  private readonly fencePreview = new Graphics({ label: 'fence-preview' });
  private readonly fenceConnections = new Map<string, FenceConnection>();
  private readonly fencePosts = new Map<string, GridCell>();
  private fenceViews: Graphics[] = [];
  private facilityViews: Container[] = [];
  private facilitySignature = '';
  private fenceStroke: FenceStroke | null = null;
  private readonly simulationClock = new FixedStepClock();
  private mode: WindowMode = 'life';
  private simulationSteps = 0;
  private facilityRenderElapsed = 0;
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
    this.previewLayer.addChild(this.fencePreview);

    this.drawGround();
    this.navigation = new NavigationGrid({
      columns: this.columns,
      rows: this.rows,
      blocked: DEFAULT_FENCES.filter(
        (cell) => cell.x < this.columns && cell.y < this.rows,
      ),
    });
    for (const cell of DEFAULT_FENCES) {
      if (cell.x < this.columns && cell.y < this.rows) {
        this.fencePosts.set(gridCellKey(cell), { ...cell });
      }
    }
    for (let index = 1; index < DEFAULT_FENCES.length; index += 1) {
      const previous = DEFAULT_FENCES[index - 1];
      const current = DEFAULT_FENCES[index];
      if (
        previous &&
        current &&
        this.fencePosts.has(gridCellKey(previous)) &&
        this.fencePosts.has(gridCellKey(current))
      ) {
        this.addFenceConnection(previous, current);
      }
    }
    this.facilities = new FacilitySystem(this.navigation, [
      {
        id: 'food_bowl_01',
        kind: 'foodBowl',
        cell: { x: 0, y: 1 },
        capacity: 100,
      },
      {
        id: 'water_bowl_01',
        kind: 'waterBowl',
        cell: { x: Math.max(1, this.columns - 2), y: this.rows - 1 },
        capacity: 30,
      },
      {
        id: 'water_bowl_02',
        kind: 'waterBowl',
        cell: { x: this.columns - 1, y: 0 },
        capacity: 100,
      },
    ]);
    this.rabbit = new RabbitModel({
      columns: this.columns,
      rows: this.rows,
      navigation: this.navigation,
      facilities: this.facilities,
      initialNeeds: { hunger: 64, thirst: 69, energy: 78 },
    });
    this.rabbitView = new RabbitView();
    this.objectLayer.addChild(this.rabbitView.root);
    this.drawFences();
    this.drawFacilities();
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
    if (mode !== 'build') {
      this.clearFenceCandidate();
      this.fenceStroke = null;
    }
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

  beginFenceStrokeAtViewport(viewport: Point): boolean {
    if (this.mode !== 'build') return false;
    const cell = this.viewportToGridCell(viewport);
    if (!cell || this.isRabbitCell(cell)) return false;

    const initiallyBlocked = this.fencePosts.has(gridCellKey(cell));
    if (!initiallyBlocked && !this.navigation.isWalkable(cell)) return false;
    if (!initiallyBlocked) {
      this.navigation.setBlocked(cell, true);
      this.fencePosts.set(gridCellKey(cell), { ...cell });
    }
    this.fenceStroke = {
      start: cell,
      last: cell,
      candidate: null,
      candidateTimer: null,
      initiallyBlocked,
      moved: false,
    };
    this.drawFences();
    return true;
  }

  extendFenceStrokeAtViewport(viewport: Point): boolean {
    if (this.mode !== 'build' || !this.fenceStroke) return false;
    const target = this.viewportToGridCell(viewport);
    if (
      !target ||
      this.isRabbitCell(target) ||
      (target.x === this.fenceStroke.last.x &&
        target.y === this.fenceStroke.last.y)
    ) {
      this.clearFenceCandidate();
      return false;
    }
    if (
      this.fenceStroke.candidate?.x === target.x &&
      this.fenceStroke.candidate.y === target.y
    ) {
      return false;
    }

    this.clearFenceCandidate();
    this.fenceStroke.candidate = target;
    this.drawFenceCandidatePreview();
    this.scheduleFenceCandidate();
    return true;
  }

  endFenceStroke(): void {
    if (!this.fenceStroke) return;
    this.clearFenceCandidate();
    if (!this.fenceStroke.moved && this.fenceStroke.initiallyBlocked) {
      this.removeFencePost(this.fenceStroke.start);
      this.drawFences();
      this.drawNavigationDebug();
    }
    this.fenceStroke = null;
  }

  private scheduleFenceCandidate(): void {
    if (!this.fenceStroke?.candidate) return;
    this.fenceStroke.candidateTimer = window.setTimeout(() => {
      if (!this.fenceStroke) return;
      this.fenceStroke.candidateTimer = null;
      this.commitFenceCandidate();
    }, FENCE_DWELL_MILLISECONDS);
  }

  private commitFenceCandidate(): void {
    const stroke = this.fenceStroke;
    const target = stroke?.candidate;
    if (!stroke || !target) return;

    const next = rasterizeFenceStroke(stroke.last, target)[1];
    if (!next || !this.navigation.isInside(next) || this.isRabbitCell(next)) {
      this.clearFenceCandidate();
      return;
    }
    const nextIsFence = this.fencePosts.has(gridCellKey(next));
    if (!nextIsFence && !this.navigation.isWalkable(next)) {
      this.clearFenceCandidate();
      return;
    }
    if (!nextIsFence) {
      this.navigation.setBlocked(next, true);
      this.fencePosts.set(gridCellKey(next), { ...next });
    }
    this.addFenceConnection(stroke.last, next);
    stroke.last = next;
    stroke.moved = true;
    this.drawFences();
    this.drawNavigationDebug();

    if (next.x === target.x && next.y === target.y) {
      this.clearFenceCandidate();
    } else {
      this.drawFenceCandidatePreview();
      this.scheduleFenceCandidate();
    }
  }

  private clearFenceCandidate(): void {
    if (this.fenceStroke?.candidateTimer != null) {
      window.clearTimeout(this.fenceStroke.candidateTimer);
    }
    if (this.fenceStroke) {
      this.fenceStroke.candidate = null;
      this.fenceStroke.candidateTimer = null;
    }
    this.fencePreview.clear();
  }

  private drawFenceCandidatePreview(): void {
    this.fencePreview.clear();
    const stroke = this.fenceStroke;
    const target = stroke?.candidate;
    if (!stroke || !target) return;
    const next = rasterizeFenceStroke(stroke.last, target)[1];
    if (!next || !this.navigation.isInside(next)) return;
    polygon(this.fencePreview, getTileDiamond(next))
      .fill({ color: 0xffd76a, alpha: 0.22 })
      .stroke({ color: 0xffd76a, alpha: 0.9, width: 3 });
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

  private viewportToGridCell(viewport: Point): GridCell | null {
    const projected = this.viewportToGridPosition(viewport);
    const cell = { x: Math.round(projected.x), y: Math.round(projected.y) };
    return this.navigation.isInside(cell) ? cell : null;
  }

  private viewportToGridPosition(viewport: Point): Point {
    const local = {
      x: (viewport.x - this.root.position.x) / this.root.scale.x,
      y: (viewport.y - this.root.position.y) / this.root.scale.y,
    };
    return screenToGrid(local);
  }

  private isRabbitCell(cell: GridCell): boolean {
    const rabbitPosition = this.rabbit.getSnapshot().position;
    return (
      Math.round(rabbitPosition.x) === cell.x &&
      Math.round(rabbitPosition.y) === cell.y
    );
  }

  private addFenceConnection(a: GridCell, b: GridCell): void {
    const key = fenceConnectionKey(a, b);
    this.fenceConnections.set(key, { a: { ...a }, b: { ...b } });
  }

  private removeFencePost(cell: GridCell): void {
    const connectedNeighbors: GridCell[] = [];
    for (const connection of this.fenceConnections.values()) {
      if (connection.a.x === cell.x && connection.a.y === cell.y) {
        connectedNeighbors.push(connection.b);
      } else if (connection.b.x === cell.x && connection.b.y === cell.y) {
        connectedNeighbors.push(connection.a);
      }
    }

    this.fencePosts.delete(gridCellKey(cell));
    this.navigation.setBlocked(cell, false);
    for (const [key, connection] of this.fenceConnections) {
      const touchesCell =
        (connection.a.x === cell.x && connection.a.y === cell.y) ||
        (connection.b.x === cell.x && connection.b.y === cell.y);
      if (touchesCell) this.fenceConnections.delete(key);
    }

    for (const neighbor of connectedNeighbors) {
      const stillConnected = [...this.fenceConnections.values()].some(
        (connection) =>
          (connection.a.x === neighbor.x && connection.a.y === neighbor.y) ||
          (connection.b.x === neighbor.x && connection.b.y === neighbor.y),
      );
      if (!stillConnected && this.fencePosts.has(gridCellKey(neighbor))) {
        this.fencePosts.delete(gridCellKey(neighbor));
        this.navigation.setBlocked(neighbor, false);
      }
    }
  }

  private drawFences(): void {
    for (const fence of this.fenceViews) {
      fence.removeFromParent();
      fence.destroy();
    }
    this.fenceViews = [];

    for (const connection of this.fenceConnections.values()) {
      const start = gridToScreen(connection.a);
      const end = gridToScreen(connection.b);
      const rail = new Graphics({ label: 'fence-rail' });
      rail
        .moveTo(0, -18)
        .lineTo(end.x - start.x, end.y - start.y - 18)
        .moveTo(0, -9)
        .lineTo(end.x - start.x, end.y - start.y - 9)
        .stroke({ color: 0x8b5e3c, width: 5, cap: 'round' });
      rail.position.set(start.x, start.y);
      rail.zIndex =
        Math.round(
          ((connection.a.x +
            connection.a.y +
            connection.b.x +
            connection.b.y) /
            2) *
            1000,
        ) + 30;
      this.objectLayer.addChild(rail);
      this.fenceViews.push(rail);
    }

    for (const cell of this.fencePosts.values()) {
      const center = gridToScreen(cell);
      const post = new Graphics({ label: `fence-post-${cell.x}-${cell.y}` });
      post
        .moveTo(0, -31)
        .lineTo(0, 3)
        .stroke({ color: 0x65402b, width: 7, cap: 'round' })
        .circle(0, -31, 4)
        .fill({ color: 0xc08a59 });
      post.position.set(center.x, center.y);
      post.zIndex = Math.round((cell.x + cell.y) * 1000) + 50;
      this.objectLayer.addChild(post);
      this.fenceViews.push(post);
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

  private drawFacilities(): void {
    const snapshots = this.facilities.getSnapshots();
    const signature = snapshots
      .map(
        (facility) =>
          `${facility.id}:${Math.ceil(facility.capacity)}:${facility.available}`,
      )
      .join('|');
    if (signature === this.facilitySignature) return;
    this.facilitySignature = signature;

    for (const view of this.facilityViews) {
      view.removeFromParent();
      view.destroy({ children: true });
    }
    this.facilityViews = [];

    for (const facility of snapshots) {
      const view = new Container({ label: facility.id });
      const drawing = new Graphics();
      const water = facility.kind === 'waterBowl';
      const ratio = facility.capacity / facility.maxCapacity;
      drawing
        .ellipse(0, 3, 31, 12)
        .fill({ color: 0x18382e, alpha: 0.2 })
        .ellipse(0, -5, 28, 14)
        .fill({ color: facility.available ? 0xd9c4a1 : 0x9e9b92 })
        .stroke({ color: 0x795d45, width: 3 })
        .ellipse(0, -7, 21, 8)
        .fill({
          color: facility.available
            ? water
              ? 0x62b7d9
              : 0xc98245
            : 0x77766f,
          alpha: facility.available ? 0.9 : 0.45,
        });
      if (ratio < 0.35 && facility.available) {
        drawing
          .ellipse(0, -7, 12, 4)
          .fill({ color: 0xe9dcc6, alpha: 0.55 });
      }
      view.addChild(drawing);

      if (this.debug) {
        const capacity = new Text({
          text: `${water ? 'W' : 'F'} ${Math.ceil(facility.capacity)}`,
          style: {
            fill: 0x31483f,
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: 11,
            fontWeight: '700',
          },
        });
        capacity.anchor.set(0.5);
        capacity.position.set(0, -28);
        view.addChild(capacity);
      }

      const center = gridToScreen(facility.cell);
      view.position.set(center.x, center.y);
      view.zIndex = Math.round((facility.cell.x + facility.cell.y) * 1000) + 40;
      this.objectLayer.addChild(view);
      this.facilityViews.push(view);
    }
  }

  private createDebugOverlay(): Text {
    const text = new Text({
      text: '正在读取栖息地状态…',
      style: {
        fill: 0x183c2d,
        fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
        fontSize: 13,
        fontWeight: '600',
        lineHeight: 20,
      },
    });
    text.position.set(18, 16);
    this.uiLayer.addChild(this.debugBackdrop, text);
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
      const facilitySummary = this.facilities
        .getSnapshots()
        .map(
          (facility) =>
            `${facility.kind === 'foodBowl' ? '食盆' : '水盆'} ${Math.ceil(facility.capacity)}/${facility.maxCapacity}${facility.available ? '' : '（空）'}`,
        )
        .join(' · ');
      this.fpsText.text = [
        `性能  FPS ${fps} · 模拟 ${this.simulationSteps * 2}/s · ${this.app.renderer.type}`,
        `兔子  ${rabbit.state}/${rabbit.facing}${rabbit.targetFacilityId ? ` → ${rabbit.targetFacilityId}` : ''}`,
        `需求  H 饥饿 ${Math.round(rabbit.needs.hunger)} · T 口渴 ${Math.round(rabbit.needs.thirst)} · E 精力 ${Math.round(rabbit.needs.energy)}`,
        `设施  ${facilitySummary}`,
        `导航  v${rabbit.navigationVersion} · 重新寻路 ${rabbit.repathCount}`,
      ].join('\n');
      this.debugBackdrop
        .clear()
        .roundRect(
          8,
          8,
          Math.ceil(this.fpsText.width) + 20,
          Math.ceil(this.fpsText.height) + 16,
          10,
        )
        .fill({ color: 0xf4fbf6, alpha: 0.9 })
        .stroke({ color: 0xffffff, alpha: 0.72, width: 1 });
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
    this.facilityRenderElapsed += ticker.deltaMS;
    if (this.facilityRenderElapsed >= 250) {
      this.drawFacilities();
      this.facilityRenderElapsed = 0;
    }
  }
}
