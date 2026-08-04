import 'pixi.js/unsafe-eval';
import { Application } from 'pixi.js';

import { normalizePixelRatio } from '../shared/runtime';
import type { WindowMode, WindowState } from '../shared/window';
import './styles/global.css';
import { WorldView } from './world/WorldView';

function renderWindowState(state: WindowState): void {
  const status = document.querySelector<HTMLElement>('#status');
  if (status === null) return;

  document.body.dataset['mode'] = state.mode;
  document.body.dataset['debugWindow'] = String(state.debugWindow);
  document.body.dataset['pointerPassthrough'] = String(
    state.pointerPassthrough,
  );

  const modeLabels: Record<WindowMode, string> = {
    life: '生活模式',
    build: '布置模式',
    paused: '已暂停',
  };
  const buildHint =
    state.mode === 'build'
      ? ' · 按住连续绘制（候选格短暂停留后确认），单击已有栅栏删除'
      : '';
  status.textContent = `${modeLabels[state.mode]} · ${state.display.label} · ${state.layer === 'overlay' ? '置顶层' : '桌面层'}${buildHint}`;

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '#mode-panel [data-mode]',
  )) {
    button.dataset['active'] = String(button.dataset['mode'] === state.mode);
  }
}

async function bootstrap(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app');
  const status = document.querySelector<HTMLElement>('#status');

  if (root === null || status === null) {
    throw new Error('DeskHabitat renderer root is missing.');
  }

  const pixi = new Application();
  await pixi.init({
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: normalizePixelRatio(window.devicePixelRatio),
  });

  pixi.canvas.setAttribute('aria-hidden', 'true');
  root.prepend(pixi.canvas);

  const [version, state] = await Promise.all([
    window.deskHabitat.app.getVersion(),
    window.deskHabitat.window.getState(),
  ]);
  const world = new WorldView(pixi, { debug: state.debugWindow });
  world.setMode(state.mode);
  document.title = `DeskHabitat ${version}`;
  renderWindowState(state);
  const pointerPosition = (event: PointerEvent) => {
    const bounds = pixi.canvas.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  };
  pixi.canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (world.beginFenceStrokeAtViewport(pointerPosition(event))) {
      pixi.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  });
  pixi.canvas.addEventListener('pointermove', (event) => {
    if ((event.buttons & 1) === 0) return;
    world.extendFenceStrokeAtViewport(pointerPosition(event));
  });
  pixi.canvas.addEventListener('pointerup', (event) => {
    world.endFenceStroke();
    if (pixi.canvas.hasPointerCapture(event.pointerId)) {
      pixi.canvas.releasePointerCapture(event.pointerId);
    }
  });
  pixi.canvas.addEventListener('pointercancel', () => {
    world.endFenceStroke();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '#mode-panel [data-mode]',
  )) {
    button.addEventListener('click', () => {
      const mode = button.dataset['mode'] as WindowMode;
      void window.deskHabitat.window.setMode(mode).then(renderWindowState);
    });
  }

  window.deskHabitat.events.onCommand((command) => {
    if (command.type === 'state-changed') {
      renderWindowState(command.state);
      world.setMode(command.state.mode);
    }
    if (command.type === 'display-changed') {
      const nextResolution = normalizePixelRatio(window.devicePixelRatio);
      if (pixi.renderer.resolution !== nextResolution) {
        pixi.renderer.resolution = nextResolution;
        pixi.renderer.resize(window.innerWidth, window.innerHeight);
      }
      world.resize(window.innerWidth, window.innerHeight);
      void window.deskHabitat.window.getState().then(renderWindowState);
    }
  });
  window.addEventListener('resize', () => {
    world.resize(window.innerWidth, window.innerHeight);
  });
  window.deskHabitat.lifecycle.rendererReady();
}

void bootstrap().catch((error: unknown) => {
  console.error('DeskHabitat renderer failed to start.', error);

  const status = document.querySelector<HTMLElement>('#status');
  if (status !== null) {
    status.textContent = 'DeskHabitat 启动失败，请查看日志。';
    status.dataset['state'] = 'error';
  }
});
