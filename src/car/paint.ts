import { PAINTS, type PaintId } from '../config/paint.ts';
import { settings, updateSettings } from '../core/settings.ts';

/** Paint unlock rules: finished runs, or a rewarded ad. */
export function paintUnlocked(id: PaintId): boolean {
  const p = PAINTS.find((x) => x.id === id);
  if (!p) return false;
  const s = settings();
  return s.runs >= p.runs || s.adPaints.includes(id);
}

/** The first paint that is still locked (the one a rewarded ad would unlock), or null. */
export function nextLockedPaint(): (typeof PAINTS)[number] | null {
  return PAINTS.find((p) => !paintUnlocked(p.id)) ?? null;
}

/** The selected paint's colour (falls back to the default if it's somehow locked). */
export function currentPaintHex(): number {
  const id = settings().paint;
  const p = PAINTS.find((x) => x.id === id && paintUnlocked(x.id));
  return (p ?? PAINTS[0]).hex;
}

export function selectPaint(id: PaintId): void {
  if (paintUnlocked(id)) updateSettings({ paint: id });
}

/** Counts a finished run; returns paints unlocked by it. */
export function recordFinishedRun(): PaintId[] {
  const before = PAINTS.filter((p) => paintUnlocked(p.id)).map((p) => p.id);
  updateSettings({ runs: settings().runs + 1 });
  return PAINTS.filter((p) => paintUnlocked(p.id) && !before.includes(p.id)).map((p) => p.id);
}

/** A rewarded ad finished: unlock this paint and put it on the car. */
export function unlockPaintByAd(id: PaintId): void {
  const s = settings();
  if (!s.adPaints.includes(id)) updateSettings({ adPaints: [...s.adPaints, id] });
  updateSettings({ paint: id });
}
