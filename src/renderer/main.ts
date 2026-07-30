import 'pixi.js/unsafe-eval';
import { Application } from 'pixi.js';

import { normalizePixelRatio } from '../shared/runtime';
import './styles/global.css';

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

  const version = await window.deskHabitat.app.getVersion();
  status.textContent = `DeskHabitat ${version} · 项目骨架已就绪`;
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
