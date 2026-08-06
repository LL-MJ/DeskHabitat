import type { DeskHabitatApi } from '../shared/ipc';

declare global {
  interface Window {
    deskHabitat: DeskHabitatApi;
  }
}

export {};
