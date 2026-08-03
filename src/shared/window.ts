export const WINDOW_MODES = ['life', 'build', 'paused'] as const;

export type WindowMode = (typeof WINDOW_MODES)[number];
export type WindowLayer = 'overlay' | 'desktop';

export interface DisplayInfo {
  id: number;
  label: string;
  scaleFactor: number;
  bounds: Rectangle;
  workArea: Rectangle;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  mode: WindowMode;
  layer: WindowLayer;
  pointerPassthrough: boolean;
  display: DisplayInfo;
  debugWindow: boolean;
}

export type AppCommand =
  | { type: 'state-changed'; state: WindowState }
  | { type: 'display-changed'; display: DisplayInfo };

export function isWindowMode(value: unknown): value is WindowMode {
  return typeof value === 'string' && WINDOW_MODES.includes(value as WindowMode);
}

export function defaultPointerPassthrough(mode: WindowMode): boolean {
  return mode !== 'build';
}
