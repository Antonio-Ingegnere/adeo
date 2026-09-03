// Pure helpers for persisting and restoring the main window's geometry.
//
// Split out of main.ts so the position/size validation can be unit-tested without
// booting Electron: `parseWindowBounds` only does type/shape validation (safe to
// call before the app 'ready' event), and `clampWindowBoundsToDisplays` does the
// display-aware clamping using screen work areas supplied by the caller.

/** Mirrors the BrowserWindow minWidth/minHeight literals in main.ts createWindow(). */
export const MIN_WINDOW_WIDTH = 600;
export const MIN_WINDOW_HEIGHT = 480;
/** First-run defaults; mirror the literals passed to new BrowserWindow in main.ts. */
export const DEFAULT_WINDOW_WIDTH = 800;
export const DEFAULT_WINDOW_HEIGHT = 600;

// Guards against absurd persisted sizes (corrupt file, a since-removed 8K monitor).
const MAX_WINDOW_DIMENSION = 20000;
// The saved rect must share at least this many pixels with some display work area
// on BOTH axes, otherwise its position is treated as off-screen and corrected.
const MIN_VISIBLE_OVERLAP = 96;

export type WindowBounds = {
  width: number;
  height: number;
  /** null means "no saved position" -> let the OS place the window (centered). */
  x: number | null;
  y: number | null;
  maximized: boolean;
};

export type DisplayWorkArea = { x: number; y: number; width: number; height: number };

const asInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

const clampWidth = (n: number): number =>
  Math.min(Math.max(n, MIN_WINDOW_WIDTH), MAX_WINDOW_DIMENSION);
const clampHeight = (n: number): number =>
  Math.min(Math.max(n, MIN_WINDOW_HEIGHT), MAX_WINDOW_DIMENSION);

/**
 * Structural + type validation only, no display awareness. Anything that is not a
 * plain object with finite numeric width/height collapses to null (== first run).
 * A missing or non-finite x/y is preserved as null so the OS centers the window.
 * Safe to call at module load, before Electron's 'ready' event.
 */
export const parseWindowBounds = (value: unknown): WindowBounds | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const width = asInt(raw.width);
  const height = asInt(raw.height);
  if (width === null || height === null) return null;

  const maximized = raw.maximized === true;
  const x = asInt(raw.x);
  const y = asInt(raw.y);

  const size = { width: clampWidth(width), height: clampHeight(height), maximized };
  if (x === null || y === null) return { ...size, x: null, y: null };
  return { ...size, x, y };
};

const validWorkAreas = (workAreas: DisplayWorkArea[]): DisplayWorkArea[] =>
  (Array.isArray(workAreas) ? workAreas : []).filter(
    (a) =>
      a &&
      Number.isFinite(a.x) &&
      Number.isFinite(a.y) &&
      Number.isFinite(a.width) &&
      Number.isFinite(a.height) &&
      a.width > 0 &&
      a.height > 0,
  );

/**
 * Clamp parsed bounds against the currently connected displays so the window can
 * never restore fully (or almost fully) off-screen:
 *   - no saved position               -> size only, OS centers it
 *   - no usable display info           -> size only, OS centers it
 *   - rect visibly overlaps a display  -> kept as-is
 *   - rect is off-screen              -> moved onto the nearest display work area,
 *                                          shrunk to fit if it is larger than it
 */
export const clampWindowBoundsToDisplays = (
  bounds: WindowBounds | null,
  workAreas: DisplayWorkArea[],
): WindowBounds | null => {
  if (!bounds) return null;
  const { width, height, maximized } = bounds;

  if (bounds.x === null || bounds.y === null) {
    return { width, height, x: null, y: null, maximized };
  }

  const areas = validWorkAreas(workAreas);
  if (areas.length === 0) {
    return { width, height, x: null, y: null, maximized };
  }

  const x = bounds.x;
  const y = bounds.y;
  const visiblyOverlaps = (a: DisplayWorkArea): boolean => {
    const overlapX = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);
    const overlapY = Math.min(y + height, a.y + a.height) - Math.max(y, a.y);
    return overlapX >= MIN_VISIBLE_OVERLAP && overlapY >= MIN_VISIBLE_OVERLAP;
  };
  if (areas.some(visiblyOverlaps)) {
    return { width, height, x, y, maximized };
  }

  // Off-screen: relocate onto the display whose center is nearest the saved center.
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  let target = areas[0];
  let bestDistance = Infinity;
  for (const a of areas) {
    const distance =
      (a.x + a.width / 2 - centerX) ** 2 + (a.y + a.height / 2 - centerY) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      target = a;
    }
  }
  const fitWidth = Math.min(width, target.width);
  const fitHeight = Math.min(height, target.height);
  const clampedX = Math.max(target.x, Math.min(x, target.x + target.width - fitWidth));
  const clampedY = Math.max(target.y, Math.min(y, target.y + target.height - fitHeight));
  return { width: fitWidth, height: fitHeight, x: clampedX, y: clampedY, maximized };
};

/** Convenience for tests: parse then clamp in one call. */
export const sanitizeWindowBounds = (
  value: unknown,
  workAreas: DisplayWorkArea[],
): WindowBounds | null => clampWindowBoundsToDisplays(parseWindowBounds(value), workAreas);
