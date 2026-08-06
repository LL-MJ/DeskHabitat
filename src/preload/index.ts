import { contextBridge, ipcRenderer } from 'electron';

import type { DeskHabitatApi } from '../shared/ipc';
import type { AppSettings, SaveSnapshot } from '../shared/save';
import type { AppCommand, WindowMode } from '../shared/window';

type GetVersionChannel = typeof import('../shared/ipc').IPC_CHANNELS.app.getVersion;
type RendererReadyChannel =
  typeof import('../shared/ipc').IPC_CHANNELS.lifecycle.rendererReady;

const GET_VERSION_CHANNEL: GetVersionChannel = 'desk-habitat:app:get-version';
const RENDERER_READY_CHANNEL: RendererReadyChannel =
  'desk-habitat:lifecycle:renderer-ready';
const SAVE_COMPLETE_CHANNEL = 'desk-habitat:lifecycle:save-complete';
const GET_STATE_CHANNEL = 'desk-habitat:window:get-state';
const GET_DISPLAY_INFO_CHANNEL = 'desk-habitat:window:get-display-info';
const SET_MODE_CHANNEL = 'desk-habitat:window:set-mode';
const SET_POINTER_PASSTHROUGH_CHANNEL =
  'desk-habitat:window:set-pointer-passthrough';
const COMMAND_CHANNEL = 'desk-habitat:events:command';
const LOAD_SAVE_CHANNEL = 'desk-habitat:save:load';
const WRITE_SAVE_CHANNEL = 'desk-habitat:save:write';
const LOAD_SETTINGS_CHANNEL = 'desk-habitat:settings:load';
const UPDATE_SETTINGS_CHANNEL = 'desk-habitat:settings:update';
const DIAGNOSTICS_LOG_CHANNEL = 'desk-habitat:diagnostics:log';

const api: DeskHabitatApi = Object.freeze({
  app: Object.freeze({
    getVersion: () => ipcRenderer.invoke(GET_VERSION_CHANNEL) as Promise<string>,
  }),
  window: Object.freeze({
    getState: () => ipcRenderer.invoke(GET_STATE_CHANNEL),
    getDisplayInfo: () => ipcRenderer.invoke(GET_DISPLAY_INFO_CHANNEL),
    setMode: (mode: WindowMode) => ipcRenderer.invoke(SET_MODE_CHANNEL, mode),
    setPointerPassthrough: (enabled: boolean) =>
      ipcRenderer.invoke(SET_POINTER_PASSTHROUGH_CHANNEL, enabled),
  }),
  save: Object.freeze({
    load: () => ipcRenderer.invoke(LOAD_SAVE_CHANNEL),
    write: (snapshot: SaveSnapshot) =>
      ipcRenderer.invoke(WRITE_SAVE_CHANNEL, snapshot),
  }),
  settings: Object.freeze({
    load: () => ipcRenderer.invoke(LOAD_SETTINGS_CHANNEL),
    update: (patch: Partial<Omit<AppSettings, 'schemaVersion'>>) =>
      ipcRenderer.invoke(UPDATE_SETTINGS_CHANNEL, patch),
  }),
  diagnostics: Object.freeze({
    log: (level: 'warn' | 'error', message: string) => {
      ipcRenderer.send(DIAGNOSTICS_LOG_CHANNEL, level, message);
    },
  }),
  events: Object.freeze({
    onCommand: (listener: (command: AppCommand) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, command: AppCommand) => {
        listener(command);
      };

      ipcRenderer.on(COMMAND_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(COMMAND_CHANNEL, handler);
      };
    },
  }),
  lifecycle: Object.freeze({
    rendererReady: () => {
      ipcRenderer.send(RENDERER_READY_CHANNEL);
    },
    saveComplete: () => {
      ipcRenderer.send(SAVE_COMPLETE_CHANNEL);
    },
  }),
});

contextBridge.exposeInMainWorld('deskHabitat', api);
