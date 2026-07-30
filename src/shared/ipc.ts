export const IPC_CHANNELS = {
  app: {
    getVersion: 'desk-habitat:app:get-version',
  },
  lifecycle: {
    rendererReady: 'desk-habitat:lifecycle:renderer-ready',
  },
} as const;

export interface DeskHabitatApi {
  app: {
    getVersion(): Promise<string>;
  };
  lifecycle: {
    rendererReady(): void;
  };
}
