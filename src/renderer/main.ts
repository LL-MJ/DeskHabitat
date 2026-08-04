import 'pixi.js/unsafe-eval';
import { Application } from 'pixi.js';

import { normalizePixelRatio } from '../shared/runtime';
import type { WindowMode, WindowState } from '../shared/window';
import './styles/global.css';
import { WorldView, type BuildFeedback, type BuildTool } from './world/WorldView';

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
      ? ' · 使用左下角工具栏布置栖息地'
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
  const buildMessage = document.querySelector<HTMLElement>('#build-message');
  const showBuildFeedback = (feedback: BuildFeedback) => {
    if (buildMessage) {
      buildMessage.textContent = feedback.message;
      buildMessage.dataset['valid'] = String(feedback.valid);
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '[data-build-action="rotate"], [data-build-action="delete"]',
    )) {
      button.disabled = !feedback.selected;
    }
  };
  const activateBuildTool = (tool: BuildTool) => {
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '[data-build-tool]',
    )) {
      button.dataset['active'] = String(button.dataset['buildTool'] === tool);
    }
    showBuildFeedback(world.setBuildTool(tool));
  };
  activateBuildTool('select');
  const pointerPosition = (event: PointerEvent) => {
    const bounds = pixi.canvas.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  };
  pixi.canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const feedback = world.beginBuildInteraction(pointerPosition(event));
    showBuildFeedback(feedback);
    if (feedback.valid) {
      pixi.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  });
  pixi.canvas.addEventListener('pointermove', (event) => {
    const position = pointerPosition(event);
    const feedback =
      (event.buttons & 1) === 0
        ? world.updateBuildPointer(position)
        : world.extendBuildInteraction(position);
    showBuildFeedback(feedback);
  });
  pixi.canvas.addEventListener('pointerup', (event) => {
    showBuildFeedback(world.endBuildInteraction());
    if (pixi.canvas.hasPointerCapture(event.pointerId)) {
      pixi.canvas.releasePointerCapture(event.pointerId);
    }
  });
  pixi.canvas.addEventListener('pointercancel', () => {
    showBuildFeedback(world.cancelBuildInteraction());
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-build-tool]',
  )) {
    button.addEventListener('click', () => {
      activateBuildTool(button.dataset['buildTool'] as BuildTool);
    });
  }
  document
    .querySelector<HTMLButtonElement>('[data-build-action="rotate"]')
    ?.addEventListener('click', () => {
      showBuildFeedback(world.rotateBuildSelection());
    });
  document
    .querySelector<HTMLButtonElement>('[data-build-action="delete"]')
    ?.addEventListener('click', () => {
      showBuildFeedback(world.deleteBuildSelection());
    });
  document
    .querySelector<HTMLButtonElement>('[data-build-action="cancel"]')
    ?.addEventListener('click', () => {
      showBuildFeedback(world.cancelBuildInteraction());
    });
  window.addEventListener('keydown', (event) => {
    if (document.body.dataset['mode'] !== 'build') return;
    if (event.key === 'Delete') {
      showBuildFeedback(world.deleteBuildSelection());
    } else if (event.key === 'Escape') {
      showBuildFeedback(world.cancelBuildInteraction());
    } else if (event.key.toLowerCase() === 'r') {
      showBuildFeedback(world.rotateBuildSelection());
    }
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
