const MIN_PIXEL_RATIO = 1;
const MAX_PIXEL_RATIO = 2;

export function normalizePixelRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_PIXEL_RATIO;
  }

  return Math.min(MAX_PIXEL_RATIO, Math.max(MIN_PIXEL_RATIO, value));
}
