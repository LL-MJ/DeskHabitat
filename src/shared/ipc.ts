import type {
  AppCommand,
  DisplayInfo,
  WindowMode,
  WindowState,
} from './window';
import type {
  AppSettings,
  SaveLoadResult,
  SaveSnapshot,
  SaveWriteResult,
} from './save';

export const IPC_CHANNELS = {
  app: {
    getVersion: 'desk-habitat:app:get-version',
  },
  window: {
    getState: 'desk-habitat:window:get-state',
    getDisplayInfo: 'desk-habitat:window:get-display-info',
    setMode: 'desk-habitat:window:set-mode',
    setPointerPassthrough: 'desk-habitat:window:set-pointer-passthrough',
  },
  save: {
    load: 'desk-habitat:save:load',
    write: 'desk-habitat:save:write',
  },
  settings: {
    load: 'desk-habitat:settings:load',
    update: 'desk-habitat:settings:update',
  },
  diagnostics: {
    log: 'desk-habitat:diagnostics:log',
  },
  events: {
    command: 'desk-habitat:events:command',
  },
  lifecycle: {
    rendererReady: 'desk-habitat:lifecycle:renderer-ready',
    saveComplete: 'desk-habitat:lifecycle:save-complete',
  },
} as const;

export interface DeskHabitatApi {
  app: {
    getVersion(): Promise<string>;
  };
  window: {
    getState(): Promise<WindowState>;
    getDisplayInfo(): Promise<DisplayInfo>;
    setMode(mode: WindowMode): Promise<WindowState>;
    setPointerPassthrough(enabled: boolean): Promise<WindowState>;
  };
  save: {
    load(): Promise<SaveLoadResult>;
    write(snapshot: SaveSnapshot): Promise<SaveWriteResult>;
  };
  settings: {
    load(): Promise<AppSettings>;
    update(
      patch: Partial<Omit<AppSettings, 'schemaVersion'>>,
    ): Promise<AppSettings>;
  };
  diagnostics: {
    log(level: 'warn' | 'error', message: string): void;
  };
  events: {
    onCommand(listener: (command: AppCommand) => void): () => void;
  };
  lifecycle: {
    rendererReady(): void;
    saveComplete(): void;
  };
}
