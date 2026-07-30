import { contextBridge, ipcRenderer } from 'electron';

import type { DeskHabitatApi } from '../shared/ipc';

type GetVersionChannel = typeof import('../shared/ipc').IPC_CHANNELS.app.getVersion;
type RendererReadyChannel =
  typeof import('../shared/ipc').IPC_CHANNELS.lifecycle.rendererReady;

const GET_VERSION_CHANNEL: GetVersionChannel = 'desk-habitat:app:get-version';
const RENDERER_READY_CHANNEL: RendererReadyChannel =
  'desk-habitat:lifecycle:renderer-ready';

const api: DeskHabitatApi = Object.freeze({
  app: Object.freeze({
    getVersion: () => ipcRenderer.invoke(GET_VERSION_CHANNEL) as Promise<string>,
  }),
  lifecycle: Object.freeze({
    rendererReady: () => {
      ipcRenderer.send(RENDERER_READY_CHANNEL);
    },
  }),
});

contextBridge.exposeInMainWorld('deskHabitat', api);
