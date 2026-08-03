import type {
  AppCommand,
  DisplayInfo,
  WindowMode,
  WindowState,
} from './window';

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
  events: {
    command: 'desk-habitat:events:command',
  },
  lifecycle: {
    rendererReady: 'desk-habitat:lifecycle:renderer-ready',
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
  events: {
    onCommand(listener: (command: AppCommand) => void): () => void;
  };
  lifecycle: {
    rendererReady(): void;
  };
}
