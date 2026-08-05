import {
  Application,
  BlurFilter,
  Container,
  Graphics,
  Sprite,
  Text,
  type Ticker,
} from 'pixi.js';

import {
  constrainDecorationPosition,
  DEFAULT_ORCHARD_DECORATIONS,
  isOrchardDecorationKind,
  rotateDecoration,
  type DecorationDefinition,
  type OrchardDecorationKind,
} from '../../shared/decoration';
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
import {
  FacilitySystem,
  type FacilityDefinition,
} from '../../shared/facility';
import { NavigationGrid, type GridCell } from '../../shared/navigation';
import { RabbitModel } from '../../shared/rabbit';
import type { SaveSnapshot } from '../../shared/save';
import { FixedStepClock } from '../../shared/simulation';
import type { WindowMode } from '../../shared/window';
import type { OrchardTextureMap } from '../assets/orchard';
import { ORCHARD_ASSETS } from '../assets/orchard/manifest';
import { RabbitView } from './RabbitView';

export interface WorldViewOptions {
  columns?: number;
  rows?: number;
  debug?: boolean;
  initialSnapshot?: SaveSnapshot;
  offlineSeconds?: number;
  onDirty?: () => void;
  maxFps?: 30 | 60;
  orchardTextures?: OrchardTextureMap;
}

const GROUND_COLORS = [0x78a96f, 0x83b578] as const;
const ORCHARD_TILE_TINTS = [0xffffff, 0xf4f0dc, 0xe8f0dc] as const;
const GRID_COLOR = 0x315943;
const FENCE_DWELL_MILLISECONDS = 160;
const DECORATION_DISPLAY_NAMES: Record<OrchardDecorationKind, string> = {
  appleTree: '果树',
  shelter: '小屋',
  appleBasket: '苹果篮',
  wildflowers: '花丛',
  stoneEdge: '石块',
};
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

export type DecorationBuildTool = OrchardDecorationKind;
export type BuildTool =
  | 'select'
  | 'fence'
  | 'foodBowl'
  | 'waterBowl'
  | DecorationBuildTool;

export interface BuildFeedback {
  message: string;
  valid: boolean;
  selected: boolean;
  mirrorable: boolean;
}

type BuildSelection =
  | { type: 'facility'; id: string; cell: GridCell }
  | { type: 'fence'; cell: GridCell }
  | { type: 'decoration'; id: string };

interface DecorationView {
  sprite: Sprite;
  selectionGlow: Sprite;
  castShadow: Sprite;
  contactShadow: Graphics;
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
  readonly castShadowLayer = new Container({ label: 'cast-shadows' });
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
  private readonly buildObjectPreview = new Graphics({
    label: 'build-object-preview',
  });
  private readonly selectionInfo = new Container({
    label: 'selection-info',
  });
  private readonly selectionInfoBackground = new Graphics();
  private readonly selectionInfoText = new Text({
    text: '',
    style: {
      fill: 0x29443a,
      fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
      fontSize: 13,
      fontWeight: '600',
    },
  });
  private readonly fenceConnections = new Map<string, FenceConnection>();
  private readonly fencePosts = new Map<string, GridCell>();
  private readonly decorations = new Map<string, DecorationDefinition>();
  private readonly decorationViews = new Map<string, DecorationView>();
  private fenceViews: Graphics[] = [];
  private facilityViews: Container[] = [];
  private facilitySignature = '';
  private fenceStroke: FenceStroke | null = null;
  private buildTool: BuildTool = 'select';
  private buildSelection: BuildSelection | null = null;
  private buildHoverCell: GridCell | null = null;
  private buildHoverPosition: Point | null = null;
  private draggedFacilityId: string | null = null;
  private draggedDecorationId: string | null = null;
  private decorationDragOrigin: Point | null = null;
  private decorationDragPointerOffset: Point | null = null;
  private facilityIdCounter = 3;
  private decorationIdCounter = 1;
  private readonly simulationClock = new FixedStepClock();
  private mode: WindowMode = 'life';
  private simulationSteps = 0;
  private facilityRenderElapsed = 0;
  private gameTimeSeconds = 0;
  private readonly worldId: string;
  private readonly onDirty: (() => void) | null;
  private readonly orchardTextures: OrchardTextureMap | undefined;
  private maxLifeFps: 30 | 60;
  private elapsedMilliseconds = 0;
  private renderedFrames = 0;

  constructor(
    private readonly app: Application,
    options: WorldViewOptions = {},
  ) {
    const saved = options.initialSnapshot;
    this.columns = saved?.columns ?? options.columns ?? 8;
    this.rows = saved?.rows ?? options.rows ?? 6;
    this.debug = options.debug ?? false;
    this.worldId = saved?.worldId ?? 'default-habitat';
    this.gameTimeSeconds = saved?.gameTimeSeconds ?? 0;
    this.onDirty = options.onDirty ?? null;
    this.orchardTextures = options.orchardTextures;
    this.maxLifeFps = options.maxFps ?? 30;
    this.objectLayer.sortableChildren = true;
    this.decorationLayer.sortableChildren = true;
    this.castShadowLayer.sortableChildren = true;
    this.castShadowLayer.filters = [
      new BlurFilter({ strength: 2.2, quality: 2 }),
    ];
    this.root.addChild(
      this.shadowLayer,
      this.groundLayer,
      this.castShadowLayer,
      this.decorationLayer,
      this.objectLayer,
      this.effectLayer,
      this.previewLayer,
      this.debugLayer,
    );
    this.app.stage.addChild(this.root, this.uiLayer);
    this.previewLayer.addChild(this.fencePreview);
    this.previewLayer.addChild(this.buildObjectPreview);
    this.selectionInfo.addChild(
      this.selectionInfoBackground,
      this.selectionInfoText,
    );
    this.previewLayer.addChild(this.selectionInfo);
    this.selectionInfo.visible = false;

    this.drawGround();
    const initialDecorations =
      saved?.decorations ?? DEFAULT_ORCHARD_DECORATIONS;
    for (const decoration of initialDecorations) {
      const position = constrainDecorationPosition(
        decoration.kind,
        decoration.position,
        this.columns,
        this.rows,
      );
      this.decorations.set(decoration.id, {
        ...decoration,
        position,
      });
    }
    this.decorationIdCounter = Math.max(
      1,
      ...[...this.decorations.keys()].map((id) => {
        const suffix = /_(\d+)$/.exec(id)?.[1];
        return suffix ? Number(suffix) + 1 : 1;
      }),
    );
    this.drawOrchardDecorations();
    const initialFencePosts = saved?.fencePosts ?? DEFAULT_FENCES;
    this.navigation = new NavigationGrid({
      columns: this.columns,
      rows: this.rows,
      blocked: initialFencePosts.filter(
        (cell) => cell.x < this.columns && cell.y < this.rows,
      ),
    });
    for (const cell of initialFencePosts) {
      if (cell.x < this.columns && cell.y < this.rows) {
        this.fencePosts.set(gridCellKey(cell), { ...cell });
      }
    }
    const initialConnections =
      saved?.fenceConnections ??
      DEFAULT_FENCES.slice(1).map((cell, index) => ({
        a: DEFAULT_FENCES[index]!,
        b: cell,
      }));
    for (const connection of initialConnections) {
      const previous = connection.a;
      const current = connection.b;
      if (
        previous &&
        current &&
        this.fencePosts.has(gridCellKey(previous)) &&
        this.fencePosts.has(gridCellKey(current))
      ) {
        this.addFenceConnection(previous, current);
      }
    }
    const initialFacilities: readonly FacilityDefinition[] = saved?.facilities ?? [
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
    ];
    this.facilities = new FacilitySystem(this.navigation, initialFacilities);
    this.facilityIdCounter = Math.max(
      3,
      ...this.facilities.getSnapshots().map((facility) => {
        const suffix = /_(\d+)$/.exec(facility.id)?.[1];
        return suffix ? Number(suffix) + 1 : 3;
      }),
    );
    this.rabbit = new RabbitModel({
      columns: this.columns,
      rows: this.rows,
      navigation: this.navigation,
      facilities: this.facilities,
      initialNeeds: saved?.rabbit.needs ?? {
        hunger: 64,
        thirst: 69,
        energy: 78,
      },
      ...(saved
        ? {
            initialPosition: saved.rabbit.position,
            initialFacing: saved.rabbit.facing,
            initialState: saved.rabbit.state,
          }
        : {}),
    });
    this.rabbit.applyOfflineProgress(options.offlineSeconds ?? 0);
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
    this.app.ticker.maxFPS = mode === 'build' ? 60 : this.maxLifeFps;
    if (mode !== 'life') this.simulationClock.reset();
    if (mode !== 'build') {
      this.clearFenceCandidate();
      this.fenceStroke = null;
      this.draggedFacilityId = null;
      this.draggedDecorationId = null;
      this.decorationDragOrigin = null;
      this.decorationDragPointerOffset = null;
      this.buildHoverCell = null;
      this.buildHoverPosition = null;
    }
    this.drawBuildObjectPreview();
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

  resetTiming(): void {
    this.simulationClock.reset();
    this.elapsedMilliseconds = 0;
    this.renderedFrames = 0;
  }

  setMaxFps(maxFps: 30 | 60): void {
    this.maxLifeFps = maxFps;
    if (this.mode !== 'build') this.app.ticker.maxFPS = maxFps;
  }

  dispose(): void {
    this.clearFenceCandidate();
    this.app.ticker.remove(this.updateSimulation, this);
    this.app.ticker.remove(this.updateDebugOverlay, this);
  }

  createSaveSnapshot(): SaveSnapshot {
    const rabbit = this.rabbit.getSnapshot();
    return {
      worldId: this.worldId,
      columns: this.columns,
      rows: this.rows,
      rabbit: {
        position: { ...rabbit.position },
        needs: { ...rabbit.needs },
        state: rabbit.state,
        facing: rabbit.facing,
      },
      facilities: this.facilities.getSnapshots().map((facility) => ({
        id: facility.id,
        kind: facility.kind,
        cell: { ...facility.cell },
        capacity: facility.capacity,
        maxCapacity: facility.maxCapacity,
        rotation: facility.rotation,
      })),
      fencePosts: [...this.fencePosts.values()].map((cell) => ({ ...cell })),
      fenceConnections: [...this.fenceConnections.values()].map(
        (connection) => ({
          a: { ...connection.a },
          b: { ...connection.b },
        }),
      ),
      decorations: [...this.decorations.values()].map((decoration) => ({
        ...decoration,
        position: { ...decoration.position },
      })),
      gameTimeSeconds: this.gameTimeSeconds,
      lastOnlineAt: new Date().toISOString(),
    };
  }

  setBuildTool(tool: BuildTool): BuildFeedback {
    this.buildTool = tool;
    this.draggedFacilityId = null;
    this.draggedDecorationId = null;
    this.decorationDragOrigin = null;
    this.decorationDragPointerOffset = null;
    this.buildHoverPosition = null;
    this.clearFenceCandidate();
    this.fenceStroke = null;
    this.drawBuildObjectPreview();
    const labels: Partial<Record<BuildTool, string>> = {
      select: '选择对象后可拖动、旋转或删除',
      fence: '按住鼠标连续绘制栅栏',
      foodBowl: '移动到合法格并单击放置食盆',
      waterBowl: '移动到合法格并单击放置水盆',
    };
    const decorationLabels: Record<OrchardDecorationKind, string> = {
      appleTree: '移动到希望的位置放置果树',
      shelter: '移动到希望的位置放置小屋',
      appleBasket: '移动到希望的位置放置苹果篮',
      wildflowers: '移动到希望的位置放置花丛',
      stoneEdge: '移动到希望的位置放置石块',
    };
    const label = isOrchardDecorationKind(tool)
      ? decorationLabels[tool]
      : labels[tool] ?? '选择布置工具';
    return this.buildFeedback(label, true);
  }

  updateBuildPointer(viewport: Point): BuildFeedback {
    if (this.mode !== 'build') return this.buildFeedback('当前不在布置模式', false);
    const projected = this.viewportToGridPosition(viewport);
    const decorationKind = isOrchardDecorationKind(this.buildTool)
      ? this.buildTool
      : null;
    if (this.draggedDecorationId) {
      const decoration = this.decorations.get(this.draggedDecorationId);
      if (decoration) {
        const pointerOffset = this.decorationDragPointerOffset ?? { x: 0, y: 0 };
        decoration.position = constrainDecorationPosition(
          decoration.kind,
          {
            x: projected.x + pointerOffset.x,
            y: projected.y + pointerOffset.y,
          },
          this.columns,
          this.rows,
        );
        this.buildHoverPosition = { ...decoration.position };
        this.updateDecorationView(decoration.id);
        this.drawBuildObjectPreview();
        return this.buildFeedback('松开确认位置', true);
      }
    }
    if (decorationKind) {
      if (!this.isDecorationPointerInside(projected)) {
        this.buildHoverPosition = null;
        this.drawBuildObjectPreview();
        return this.buildFeedback('超出可布置区域', false);
      }
      this.buildHoverPosition = constrainDecorationPosition(
        decorationKind,
        projected,
        this.columns,
        this.rows,
      );
      this.buildHoverCell = this.viewportToGridCell(viewport);
      this.drawBuildObjectPreview();
      return this.buildFeedback('单击放置装饰物', true);
    }
    this.buildHoverPosition = null;
    this.buildHoverCell = this.viewportToGridCell(viewport);
    this.drawBuildObjectPreview();
    if (!this.buildHoverCell) return this.buildFeedback('超出可布置区域', false);
    if (this.buildTool === 'foodBowl' || this.buildTool === 'waterBowl') {
      const valid = this.canPlaceFacility(this.buildHoverCell);
      return this.buildFeedback(valid ? '单击确认放置' : '该位置不可放置设施', valid);
    }
    if (this.draggedFacilityId) {
      const valid = this.canPlaceFacility(
        this.buildHoverCell,
        this.draggedFacilityId,
      );
      return this.buildFeedback(valid ? '松开确认移动' : '该位置不可移动', valid);
    }
    return this.buildFeedback('选择对象或工具开始布置', true);
  }

  beginBuildInteraction(viewport: Point): BuildFeedback {
    if (this.mode !== 'build') return this.buildFeedback('当前不在布置模式', false);
    const projected = this.viewportToGridPosition(viewport);
    this.buildHoverPosition = null;
    this.buildHoverCell = this.viewportToGridCell(viewport);
    if (this.buildTool === 'fence') {
      const valid = this.beginFenceStrokeAtViewport(viewport);
      return this.buildFeedback(
        valid ? '正在绘制栅栏' : '不能从该位置开始绘制',
        valid,
      );
    }
    if (isOrchardDecorationKind(this.buildTool)) {
      if (!this.isDecorationPointerInside(projected)) {
        return this.buildFeedback('超出可布置区域', false);
      }
      const position = constrainDecorationPosition(
        this.buildTool,
        projected,
        this.columns,
        this.rows,
      );
      return this.placeDecoration(this.buildTool, position);
    }
    if (this.buildTool === 'select') {
      const decoration = this.findDecorationAtViewport(viewport);
      if (decoration) {
        this.buildSelection = { type: 'decoration', id: decoration.id };
        this.draggedFacilityId = null;
        this.draggedDecorationId = decoration.id;
        this.decorationDragOrigin = { ...decoration.position };
        this.decorationDragPointerOffset = {
          x: decoration.position.x - projected.x,
          y: decoration.position.y - projected.y,
        };
        this.buildHoverPosition = { ...decoration.position };
        this.drawBuildObjectPreview();
        return this.buildFeedback(
          `已选择：${DECORATION_DISPLAY_NAMES[decoration.kind]}`,
          true,
        );
      }
    }
    if (!this.buildHoverCell) return this.buildFeedback('超出可布置区域', false);
    if (this.buildTool === 'foodBowl' || this.buildTool === 'waterBowl') {
      return this.placeFacility(this.buildTool, this.buildHoverCell);
    }

    const facility = this.facilities.getAt(this.buildHoverCell);
    if (facility) {
      this.buildSelection = {
        type: 'facility',
        id: facility.id,
        cell: { ...facility.cell },
      };
      this.draggedFacilityId = facility.id;
      this.drawBuildObjectPreview();
      return this.buildFeedback(`已选择 ${facility.id}`, true);
    }
    if (this.fencePosts.has(gridCellKey(this.buildHoverCell))) {
      this.buildSelection = { type: 'fence', cell: { ...this.buildHoverCell } };
      this.draggedFacilityId = null;
      this.drawBuildObjectPreview();
      return this.buildFeedback('已选择栅栏柱', true);
    }
    this.buildSelection = null;
    this.draggedFacilityId = null;
    this.drawBuildObjectPreview();
    return this.buildFeedback('未选中对象', false);
  }

  extendBuildInteraction(viewport: Point): BuildFeedback {
    if (this.buildTool === 'fence') {
      this.extendFenceStrokeAtViewport(viewport);
      return this.buildFeedback('正在绘制栅栏', true);
    }
    return this.updateBuildPointer(viewport);
  }

  endBuildInteraction(): BuildFeedback {
    if (this.buildTool === 'fence') {
      this.endFenceStroke();
      return this.buildFeedback('栅栏绘制完成', true);
    }
    if (this.draggedDecorationId) {
      const id = this.draggedDecorationId;
      const decoration = this.decorations.get(id);
      const origin = this.decorationDragOrigin;
      this.draggedDecorationId = null;
      this.decorationDragOrigin = null;
      this.decorationDragPointerOffset = null;
      this.buildHoverPosition = decoration ? { ...decoration.position } : null;
      this.drawBuildObjectPreview();
      if (
        decoration &&
        origin &&
        (decoration.position.x !== origin.x || decoration.position.y !== origin.y)
      ) {
        this.markDirty();
        return this.buildFeedback('装饰物已移动', true);
      }
      return this.buildFeedback(
        decoration
          ? `已选择：${DECORATION_DISPLAY_NAMES[decoration.kind]}`
          : `已选择 ${id}`,
        true,
      );
    }
    if (this.draggedFacilityId && this.buildHoverCell) {
      const id = this.draggedFacilityId;
      const beforeMove = this.facilities.getSnapshot(id);
      const valid = this.canPlaceFacility(this.buildHoverCell, id);
      this.draggedFacilityId = null;
      if (!valid) {
        this.drawBuildObjectPreview();
        return this.buildFeedback('移动已取消：目标位置非法', false);
      }
      if (
        beforeMove &&
        beforeMove.cell.x === this.buildHoverCell.x &&
        beforeMove.cell.y === this.buildHoverCell.y
      ) {
        this.drawBuildObjectPreview();
        return this.buildFeedback(`已选择 ${id}`, true);
      }
      this.facilities.move(id, this.buildHoverCell);
      const facility = this.facilities.getSnapshot(id);
      if (facility) {
        this.buildSelection = {
          type: 'facility',
          id,
          cell: { ...facility.cell },
        };
      }
      this.facilitySignature = '';
      this.drawFacilities();
      this.drawBuildObjectPreview();
      this.markDirty();
      return this.buildFeedback('设施已移动', true);
    }
    this.draggedFacilityId = null;
    return this.buildFeedback('操作完成', true);
  }

  rotateBuildSelection(): BuildFeedback {
    if (this.buildSelection?.type === 'decoration') {
      const decoration = this.decorations.get(this.buildSelection.id);
      if (!decoration) return this.buildFeedback('装饰物不存在', false);
      decoration.rotation = rotateDecoration(decoration.rotation);
      this.updateDecorationView(decoration.id);
      this.markDirty();
      return this.buildFeedback('装饰物已旋转', true);
    }
    if (this.buildSelection?.type !== 'facility') {
      return this.buildFeedback('请先选择一个设施', false);
    }
    this.facilities.rotate(this.buildSelection.id);
    this.facilitySignature = '';
    this.drawFacilities();
    this.markDirty();
    return this.buildFeedback('设施已旋转 90°', true);
  }

  mirrorBuildSelection(): BuildFeedback {
    if (this.buildSelection?.type !== 'decoration') {
      return this.buildFeedback('请先选择一个装饰物', false);
    }
    const decoration = this.decorations.get(this.buildSelection.id);
    if (!decoration) return this.buildFeedback('装饰物不存在', false);
    decoration.mirrored = !decoration.mirrored;
    this.updateDecorationView(decoration.id);
    this.markDirty();
    return this.buildFeedback('装饰物已镜像', true);
  }

  deleteBuildSelection(): BuildFeedback {
    if (!this.buildSelection) return this.buildFeedback('没有可删除的对象', false);
    if (this.buildSelection.type === 'facility') {
      this.facilities.remove(this.buildSelection.id);
      this.facilitySignature = '';
      this.drawFacilities();
    } else if (this.buildSelection.type === 'decoration') {
      this.decorations.delete(this.buildSelection.id);
      this.drawOrchardDecorations();
    } else {
      this.removeFencePost(this.buildSelection.cell);
      this.drawFences();
      this.drawNavigationDebug();
    }
    this.buildSelection = null;
    this.draggedFacilityId = null;
    this.draggedDecorationId = null;
    this.decorationDragOrigin = null;
    this.decorationDragPointerOffset = null;
    this.buildHoverPosition = null;
    this.drawBuildObjectPreview();
    this.markDirty();
    return this.buildFeedback('对象已删除', true);
  }

  cancelBuildInteraction(): BuildFeedback {
    if (this.draggedDecorationId && this.decorationDragOrigin) {
      const decoration = this.decorations.get(this.draggedDecorationId);
      if (decoration) {
        decoration.position = { ...this.decorationDragOrigin };
        this.updateDecorationView(decoration.id);
      }
    }
    this.clearFenceCandidate();
    this.fenceStroke = null;
    this.draggedFacilityId = null;
    this.draggedDecorationId = null;
    this.decorationDragOrigin = null;
    this.decorationDragPointerOffset = null;
    this.buildHoverCell = null;
    this.buildHoverPosition = null;
    this.drawBuildObjectPreview();
    return this.buildFeedback('已取消当前操作', true);
  }

  beginFenceStrokeAtViewport(viewport: Point): boolean {
    if (this.mode !== 'build') return false;
    const cell = this.viewportToGridCell(viewport);
    if (!cell || this.isRabbitCell(cell)) return false;

    const initiallyBlocked = this.fencePosts.has(gridCellKey(cell));
    if (!initiallyBlocked && !this.canPlaceFencePost(cell)) return false;
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
    this.markDirty();
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
    if (!nextIsFence && !this.canPlaceFencePost(next)) {
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

    const orchardTexture = this.orchardTextures?.grassTile;
    if (orchardTexture) {
      for (let gridY = 0; gridY < this.rows; gridY += 1) {
        for (let gridX = 0; gridX < this.columns; gridX += 1) {
          const tile = new Sprite({ texture: orchardTexture });
          const center = gridToScreen({ x: gridX, y: gridY });
          tile.anchor.set(0.5);
          tile.position.set(center.x, center.y);
          tile.width = ORCHARD_ASSETS.grassTile.logicalSize.width;
          tile.height = ORCHARD_ASSETS.grassTile.logicalSize.height;
          tile.tint = ORCHARD_TILE_TINTS[(gridX * 2 + gridY) % 3]!;
          tile.eventMode = 'none';
          this.groundLayer.addChild(tile);
        }
      }
    } else {
      const ground = new Graphics();
      for (let gridY = 0; gridY < this.rows; gridY += 1) {
        for (let gridX = 0; gridX < this.columns; gridX += 1) {
          polygon(ground, getTileDiamond({ x: gridX, y: gridY }))
            .fill({ color: GROUND_COLORS[(gridX + gridY) % 2]! })
            .stroke({ color: 0x527f5c, alpha: 0.42, width: 1 });
        }
      }
      this.groundLayer.addChild(ground);
    }

    if (this.debug) this.drawDebugGrid();
  }

  private drawOrchardDecorations(): void {
    const textures = this.orchardTextures;
    if (!textures) return;

    for (const view of this.decorationViews.values()) {
      view.sprite.removeFromParent();
      view.selectionGlow.removeFromParent();
      view.castShadow.removeFromParent();
      view.contactShadow.removeFromParent();
      view.sprite.destroy();
      view.selectionGlow.destroy();
      view.castShadow.destroy();
      view.contactShadow.destroy();
    }
    this.decorationViews.clear();

    for (const decoration of this.decorations.values()) {
      const sprite = new Sprite({ texture: textures[decoration.kind] });
      const selectionGlow = new Sprite({ texture: textures[decoration.kind] });
      const castShadow = new Sprite({ texture: textures[decoration.kind] });
      const contactShadow = new Graphics();
      sprite.eventMode = 'none';
      selectionGlow.eventMode = 'none';
      castShadow.eventMode = 'none';
      contactShadow.eventMode = 'none';

      const layer = ORCHARD_ASSETS[decoration.kind].layer;
      (layer === 'decoration' ? this.decorationLayer : this.objectLayer).addChild(
        selectionGlow,
        sprite,
      );
      this.castShadowLayer.addChild(castShadow, contactShadow);
      this.decorationViews.set(decoration.id, {
        sprite,
        selectionGlow,
        castShadow,
        contactShadow,
      });
      this.updateDecorationView(decoration.id);
    }
  }

  private updateDecorationView(id: string): void {
    const decoration = this.decorations.get(id);
    const view = this.decorationViews.get(id);
    if (!decoration || !view) return;

    const asset = ORCHARD_ASSETS[decoration.kind];
    const center = gridToScreen(decoration.position);
    const horizontalFlip =
      (decoration.rotation === 90 || decoration.rotation === 270) !==
      decoration.mirrored;
    const zIndex = Math.round(
      (decoration.position.x + decoration.position.y) * 1000,
    );

    view.sprite.anchor.set(asset.anchor.x, asset.anchor.y);
    view.sprite.position.set(center.x, center.y + 12);
    view.sprite.width = asset.logicalSize.width;
    view.sprite.height = asset.logicalSize.height;
    view.sprite.scale.x = Math.abs(view.sprite.scale.x) * (horizontalFlip ? -1 : 1);
    view.sprite.alpha = decoration.kind === 'wildflowers' ? 0.9 : 1;
    view.sprite.zIndex = zIndex + 6;

    view.selectionGlow.anchor.set(asset.anchor.x, asset.anchor.y);
    view.selectionGlow.position.copyFrom(view.sprite.position);
    view.selectionGlow.width = asset.logicalSize.width * 1.055;
    view.selectionGlow.height = asset.logicalSize.height * 1.055;
    view.selectionGlow.scale.x =
      Math.abs(view.selectionGlow.scale.x) * (horizontalFlip ? -1 : 1);
    view.selectionGlow.tint = 0xffdc78;
    view.selectionGlow.alpha = 0.9;
    view.selectionGlow.blendMode = 'screen';
    view.selectionGlow.zIndex = zIndex + 5;
    view.selectionGlow.visible =
      this.mode === 'build' &&
      this.buildSelection?.type === 'decoration' &&
      this.buildSelection.id === id;

    view.castShadow.anchor.set(0.5, 1);
    view.castShadow.position.set(
      center.x + asset.logicalSize.width * 0.11,
      center.y + 18,
    );
    view.castShadow.width = asset.logicalSize.width * 0.82;
    view.castShadow.height = Math.max(18, asset.logicalSize.height * 0.28);
    view.castShadow.scale.x =
      Math.abs(view.castShadow.scale.x) * (horizontalFlip ? -1 : 1);
    view.castShadow.skew.x = -0.48;
    view.castShadow.tint = 0x33483b;
    view.castShadow.alpha = decoration.kind === 'wildflowers' ? 0.08 : 0.15;
    view.castShadow.blendMode = 'multiply';
    view.castShadow.zIndex = zIndex;

    const contactWidth = Math.max(18, asset.logicalSize.width * 0.24);
    const contactHeight = Math.max(7, contactWidth * 0.23);
    view.contactShadow.clear();
    view.contactShadow
      .ellipse(center.x, center.y + 11, contactWidth, contactHeight)
      .fill({ color: 0x385344, alpha: decoration.kind === 'wildflowers' ? 0.1 : 0.24 });
    view.contactShadow.blendMode = 'multiply';
    view.contactShadow.zIndex = zIndex + 1;
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

  private buildFeedback(message: string, valid: boolean): BuildFeedback {
    return {
      message,
      valid,
      selected: this.buildSelection !== null,
      mirrorable: this.buildSelection?.type === 'decoration',
    };
  }

  private markDirty(): void {
    this.onDirty?.();
  }

  private placeFacility(
    kind: 'foodBowl' | 'waterBowl',
    cell: GridCell,
  ): BuildFeedback {
    if (!this.canPlaceFacility(cell)) {
      return this.buildFeedback('该位置重叠、越界或没有可用入口', false);
    }
    const prefix = kind === 'foodBowl' ? 'food_bowl' : 'water_bowl';
    const id = `${prefix}_${String(this.facilityIdCounter).padStart(2, '0')}`;
    this.facilityIdCounter += 1;
    const facility = this.facilities.place({ id, kind, cell });
    this.buildSelection = {
      type: 'facility',
      id,
      cell: { ...facility.cell },
    };
    this.facilitySignature = '';
    this.drawFacilities();
    this.drawBuildObjectPreview();
    this.markDirty();
    return this.buildFeedback(`${kind === 'foodBowl' ? '食盆' : '水盆'}已放置`, true);
  }

  private placeDecoration(
    kind: OrchardDecorationKind,
    position: Point,
  ): BuildFeedback {
    const id = `${kind}_${String(this.decorationIdCounter).padStart(2, '0')}`;
    this.decorationIdCounter += 1;
    const decoration: DecorationDefinition = {
      id,
      kind,
      position: { ...position },
      rotation: 0,
      mirrored: false,
    };
    this.decorations.set(id, decoration);
    this.buildSelection = { type: 'decoration', id };
    this.buildHoverPosition = { ...position };
    this.drawOrchardDecorations();
    this.drawBuildObjectPreview();
    this.markDirty();
    return this.buildFeedback('装饰物已放置', true);
  }

  private canPlaceFacility(cell: GridCell, movingId?: string): boolean {
    if (!this.navigation.isInside(cell) || this.isRabbitCell(cell)) return false;
    const movingFacility = movingId
      ? this.facilities.getSnapshot(movingId)
      : null;
    const sameCell = Boolean(
      movingFacility &&
        movingFacility.cell.x === cell.x &&
        movingFacility.cell.y === cell.y,
    );
    if (!sameCell && !this.navigation.isWalkable(cell)) return false;

    const entranceDirections = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ];
    return entranceDirections.some((direction) => {
      const entrance = { x: cell.x + direction.x, y: cell.y + direction.y };
      if (!this.navigation.isInside(entrance)) return false;
      if (
        movingFacility &&
        movingFacility.cell.x === entrance.x &&
        movingFacility.cell.y === entrance.y
      ) {
        return true;
      }
      return this.navigation.isWalkable(entrance);
    });
  }

  private canPlaceFencePost(cell: GridCell): boolean {
    if (!this.navigation.isWalkable(cell) || this.isRabbitCell(cell)) return false;
    const directions = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ];
    for (const facility of this.facilities.getSnapshots()) {
      const touchesFacility =
        Math.abs(facility.cell.x - cell.x) +
          Math.abs(facility.cell.y - cell.y) ===
        1;
      if (!touchesFacility) continue;
      const alternativeEntrance = directions.some((direction) => {
        const entrance = {
          x: facility.cell.x + direction.x,
          y: facility.cell.y + direction.y,
        };
        return (
          (entrance.x !== cell.x || entrance.y !== cell.y) &&
          this.navigation.isWalkable(entrance)
        );
      });
      if (!alternativeEntrance) return false;
    }
    return true;
  }

  private drawBuildObjectPreview(): void {
    this.buildObjectPreview.clear();
    this.updateDecorationSelectionFeedback();
    if (this.mode !== 'build') return;

    if (this.buildSelection?.type === 'decoration') {
      const decoration = this.decorations.get(this.buildSelection.id);
      if (decoration) {
        polygon(
          this.buildObjectPreview,
          getTileDiamond(decoration.position),
        ).stroke({ color: 0x4d87d9, alpha: 0.95, width: 4 });
      }
    } else if (this.buildSelection) {
      polygon(
        this.buildObjectPreview,
        getTileDiamond(this.buildSelection.cell),
      ).stroke({ color: 0x4d87d9, alpha: 0.95, width: 4 });
    }

    const placingDecoration = isOrchardDecorationKind(this.buildTool);
    if (
      this.buildHoverPosition &&
      (placingDecoration || this.draggedDecorationId)
    ) {
      const draggedDecoration = this.draggedDecorationId
        ? this.decorations.get(this.draggedDecorationId)
        : null;
      const previewKind = placingDecoration
        ? this.buildTool
        : draggedDecoration?.kind;
      if (!previewKind || !isOrchardDecorationKind(previewKind)) return;
      polygon(
        this.buildObjectPreview,
        getTileDiamond(this.buildHoverPosition),
      )
        .fill({ color: 0x5bc47a, alpha: 0.16 })
        .stroke({ color: 0x5bc47a, alpha: 0.9, width: 3 });
      return;
    }

    const placingFacility =
      this.buildTool === 'foodBowl' || this.buildTool === 'waterBowl';
    if (!this.buildHoverCell || (!placingFacility && !this.draggedFacilityId)) {
      return;
    }
    const valid = this.canPlaceFacility(
      this.buildHoverCell,
      this.draggedFacilityId ?? undefined,
    );
    const color = valid ? 0x5bc47a : 0xd45b5b;
    polygon(this.buildObjectPreview, getTileDiamond(this.buildHoverCell))
      .fill({ color, alpha: 0.2 })
      .stroke({ color, alpha: 0.95, width: 4 });
    const center = gridToScreen(this.buildHoverCell);
    this.buildObjectPreview
      .ellipse(center.x, center.y - 7, 26, 12)
      .fill({ color, alpha: 0.32 });
  }

  private updateDecorationSelectionFeedback(): void {
    const selectedId =
      this.mode === 'build' && this.buildSelection?.type === 'decoration'
        ? this.buildSelection.id
        : null;
    for (const [id, view] of this.decorationViews) {
      view.selectionGlow.visible = id === selectedId;
    }

    const decoration = selectedId ? this.decorations.get(selectedId) : null;
    if (!decoration) {
      this.selectionInfo.visible = false;
      return;
    }

    const asset = ORCHARD_ASSETS[decoration.kind];
    const center = gridToScreen(decoration.position);
    this.selectionInfoText.text = `${DECORATION_DISPLAY_NAMES[decoration.kind]} · ${decoration.id}`;
    this.selectionInfoText.position.set(10, 6);
    const width = Math.ceil(this.selectionInfoText.width) + 20;
    const height = Math.ceil(this.selectionInfoText.height) + 12;
    this.selectionInfoBackground.clear();
    this.selectionInfoBackground
      .roundRect(0, 0, width, height, 8)
      .fill({ color: 0xfffbdf, alpha: 0.96 })
      .stroke({ color: 0xe1af42, alpha: 0.9, width: 2 });
    this.selectionInfo.position.set(
      center.x - width / 2,
      center.y + 2 - asset.logicalSize.height,
    );
    this.selectionInfo.visible = true;
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

  private isDecorationPointerInside(position: Point): boolean {
    return (
      position.x >= -0.5 &&
      position.x <= this.columns - 0.5 &&
      position.y >= -0.5 &&
      position.y <= this.rows - 0.5
    );
  }

  private findDecorationAtViewport(
    viewport: Point,
  ): DecorationDefinition | null {
    const ordered = [...this.decorationViews.entries()].sort(
      ([, a], [, b]) => b.sprite.zIndex - a.sprite.zIndex,
    );
    for (const [id, view] of ordered) {
      if (view.sprite.getBounds().containsPoint(viewport.x, viewport.y)) {
        return this.decorations.get(id) ?? null;
      }
    }
    return null;
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
      const rotationRadians = (facility.rotation * Math.PI) / 180;
      drawing
        .moveTo(0, -7)
        .lineTo(
          Math.cos(rotationRadians) * 15,
          -7 + Math.sin(rotationRadians) * 6,
        )
        .stroke({ color: 0xffffff, alpha: 0.72, width: 2.5 });
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
      (stepSeconds) => {
        this.rabbit.step(stepSeconds);
        this.gameTimeSeconds += stepSeconds;
      },
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
