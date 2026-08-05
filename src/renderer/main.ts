import 'pixi.js/unsafe-eval';
import { Application } from 'pixi.js';

import { normalizePixelRatio } from '../shared/runtime';
import { calculateOfflineSeconds } from '../shared/save';
import type { WindowMode, WindowState } from '../shared/window';
import { loadOrchardTextures } from './assets/orchard';
import { loadRabbitTextures } from './assets/rabbit';
import './styles/global.css';
import { WorldView, type BuildFeedback, type BuildTool } from './world/WorldView';

function describeError(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

window.addEventListener('error', (event) => {
  window.deskHabitat.diagnostics.log('error', describeError(event.error ?? event.message));
});
window.addEventListener('unhandledrejection', (event) => {
  window.deskHabitat.diagnostics.log('error', describeError(event.reason));
});

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

  const [orchardTextures, rabbitTextures] = await Promise.all([
    loadOrchardTextures(),
    loadRabbitTextures(),
  ]);

  const [version, state, saveLoad, settings] = await Promise.all([
    window.deskHabitat.app.getVersion(),
    window.deskHabitat.window.getState(),
    window.deskHabitat.save.load(),
    window.deskHabitat.settings.load(),
  ]);
  if (saveLoad.warning) {
    console.warn(saveLoad.warning);
    window.deskHabitat.diagnostics.log('warn', saveLoad.warning);
  }

  let saveTimer: number | null = null;
  let saveDirty = false;
  let saveQueue = Promise.resolve();
  const saveNow = (): Promise<void> => {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = null;
    const snapshot = world.createSaveSnapshot();
    saveDirty = false;
    saveQueue = saveQueue
      .then(async () => {
        await window.deskHabitat.save.write(snapshot);
      })
      .catch((error: unknown) => {
        saveDirty = true;
        console.error('DeskHabitat failed to save.', error);
      });
    return saveQueue;
  };
  const scheduleSave = (): void => {
    saveDirty = true;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveNow(), 2_000);
  };
  const offlineSeconds =
    settings.offlineProgress && saveLoad.envelope
      ? calculateOfflineSeconds(saveLoad.envelope.data.lastOnlineAt)
      : 0;
  const world = new WorldView(pixi, {
    debug: state.debugWindow,
    orchardTextures,
    rabbitTextures,
    ...(saveLoad.envelope
      ? { initialSnapshot: saveLoad.envelope.data }
      : {}),
    offlineSeconds,
    onDirty: scheduleSave,
    maxFps: settings.maxFps,
  });
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
    const mirrorButton = document.querySelector<HTMLButtonElement>(
      '[data-build-action="mirror"]',
    );
    if (mirrorButton) mirrorButton.disabled = !feedback.mirrorable;
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
    .querySelector<HTMLButtonElement>('[data-build-action="mirror"]')
    ?.addEventListener('click', () => {
      showBuildFeedback(world.mirrorBuildSelection());
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
    } else if (event.key.toLowerCase() === 'm') {
      showBuildFeedback(world.mirrorBuildSelection());
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

  const refreshDisplay = (): void => {
    const nextResolution = normalizePixelRatio(window.devicePixelRatio);
    if (pixi.renderer.resolution !== nextResolution) {
      pixi.renderer.resolution = nextResolution;
      pixi.renderer.resize(window.innerWidth, window.innerHeight);
    }
    world.resize(window.innerWidth, window.innerHeight);
  };
  const unsubscribeCommand = window.deskHabitat.events.onCommand((command) => {
    if (command.type === 'state-changed') {
      renderWindowState(command.state);
      world.setMode(command.state.mode);
    }
    if (command.type === 'display-changed') {
      refreshDisplay();
      void window.deskHabitat.window.getState().then(renderWindowState);
    }
    if (command.type === 'system-resumed') {
      world.resetTiming();
      refreshDisplay();
    }
    if (command.type === 'performance-settings-changed') {
      world.setMaxFps(command.maxFps);
    }
    if (command.type === 'save-requested') {
      void saveNow().finally(() => {
        window.deskHabitat.lifecycle.saveComplete();
      });
    }
  });
  window.addEventListener('resize', () => {
    world.resize(window.innerWidth, window.innerHeight);
  });
  const periodicSaveTimer = window.setInterval(() => {
    void saveNow();
  }, 60_000);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    window.clearInterval(periodicSaveTimer);
    unsubscribeCommand();
    world.dispose();
    pixi.destroy({ removeView: true }, { children: true });
  };
  window.addEventListener('beforeunload', () => {
    if (saveDirty) void saveNow();
    dispose();
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
