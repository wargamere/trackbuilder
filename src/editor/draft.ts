import { DEFAULT_OPTIONS, OPTION_CHOICES, THEME_IDS, TRACK, WORLD, type TrackOptions } from '../config/track.ts';
import type { Dot } from '../core/math.ts';
import { loadJSON, saveJSON } from '../platform/storage.ts';
import { PLACED_KINDS, type TrackExtras } from '../track/extras.ts';

export interface EditorDraft {
  dots: Dot[];
  closed: boolean;
  name: string;
  options: TrackOptions;
  /** Placed scenery, bump kerbs and painted run-off. */
  extras?: TrackExtras;
  savedAt: number;
}

/** Only well-formed placed things and paint come back from a draft. */
function safeExtras(raw: unknown): TrackExtras | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as TrackExtras;
  const out: TrackExtras = {};
  if (Array.isArray(r.placed)) {
    const placed = r.placed
      .filter((p) => p && PLACED_KINDS.includes(p.kind) && [p.x, p.y, p.rot].every(Number.isFinite) && Math.abs(p.x) <= WORLD.width && Math.abs(p.y) <= WORLD.height)
      .slice(0, 500)
      .map((p) => ({ kind: p.kind, x: p.x, y: p.y, rot: p.rot }));
    if (placed.length) out.placed = placed;
  }
  if (Array.isArray(r.paint) && r.paint.length <= 100000 && r.paint.every((v) => Number.isInteger(v) && v >= 0)) out.paint = [...r.paint];
  return out.placed || out.paint ? out : undefined;
}
const KEY = 'editor.draft.v1';

/** Drafts may contain an unfinished or invalid layout. Only safe, bounded data is restored. */
export function readDraft(): EditorDraft | null {
  const d = loadJSON<Partial<EditorDraft> | null>(KEY, null);
  if (!d || !Array.isArray(d.dots) || d.dots.length < 1 || d.dots.length > 2000 || typeof d.closed !== 'boolean' || typeof d.name !== 'string' || !Number.isFinite(d.savedAt)) return null;
  if (d.dots.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > WORLD.width / 2 || Math.abs(p.y) > WORLD.height / 2 || (p.h !== undefined && (!Number.isFinite(p.h) || p.h < 0 || p.h > TRACK.maxHeight)) || (p.b !== undefined && (!Number.isFinite(p.b) || p.b < 0 || p.b > 35)))) return null;
  const raw = d.options;
  if (!raw || typeof raw !== 'object') return null;
  const options = { ...DEFAULT_OPTIONS };
  for (const k of Object.keys(OPTION_CHOICES) as (keyof typeof OPTION_CHOICES)[]) {
    if ((OPTION_CHOICES[k] as readonly unknown[]).includes(raw[k])) Object.assign(options, { [k]: raw[k] });
  }
  if (Number.isFinite(raw.width)) options.width = Math.max(TRACK.minWidth, Math.min(TRACK.maxWidth, Math.round(raw.width * 2) / 2));
  if ([0, 1, 2].includes(raw.banking)) options.banking = raw.banking;
  if (THEME_IDS.includes(raw.theme)) options.theme = raw.theme;
  if (Number.isFinite(raw.barrierGap)) options.barrierGap = Math.max(0, Math.min(TRACK.maxBarrierGap, Math.round(raw.barrierGap)));
  if (typeof raw.walls === 'boolean') options.walls = raw.walls;
  const extras = safeExtras(d.extras);
  return { dots: d.dots.map((p) => ({ ...p })), closed: d.closed && d.dots.length >= 3, name: d.name.slice(0, 32), options, ...(extras ? { extras } : {}), savedAt: d.savedAt! };
}

export function writeDraft(draft: Omit<EditorDraft, 'savedAt'>): void {
  if (!draft.dots.length) return; // a fresh page should not erase the last useful draft
  saveJSON(KEY, { ...draft, savedAt: Date.now() });
}
