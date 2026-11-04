import { INK, type SmoothingLevel } from '../config/track.ts';
import type { Vec2 } from '../core/math.ts';
import { bakedDef, type BakedTrack, type TrackGroup } from '../track/catalog.ts';
import { CLASSIC_TRACKS } from '../track/data/classic.ts';
import { WORLD_TRACKS } from '../track/data/world.ts';
import { SAMPLE_TRACKS } from '../track/samples.ts';
import { decodeTrack } from '../track/code.ts';
import { buildTrack, contentId, newTrackId, type Track, type TrackDef } from '../track/track.ts';
import { dedupe, denseToDots, evenControl, strokeToControl } from './smoothing.ts';
import { validateCenterline, type TrackIssue } from './validation.ts';

export type BuildResult = { ok: true; track: Track } | { ok: false; issue: TrackIssue; at?: Vec2; track?: Track };

/** Raw pointer stroke (world metres) -> editable dots, or why it can't be a loop. */
export function dotsFromStroke(
  raw: readonly Vec2[],
  level: SmoothingLevel,
): { ok: true; dots: Vec2[]; autoClosed: boolean } | { ok: false; issue: TrackIssue; at?: Vec2 } {
  const stroke = strokeToControl(dedupe(raw, INK.minStep), level);
  if (!stroke.ok) return stroke;
  return { ok: true, dots: denseToDots(stroke.control, level), autoClosed: !!stroke.autoClosed };
}

/** Raw pointer stroke -> smoothed, validated track. */
export function trackFromStroke(raw: readonly Vec2[], name: string, level: SmoothingLevel = 'normal'): BuildResult {
  const d = dotsFromStroke(raw, level);
  if (!d.ok) return d;
  return trackFromControl({ id: newTrackId(), name, control: d.dots });
}

/** Builds and validates a track. On failure the built track is still returned for previewing. */
export function trackFromControl(def: TrackDef): BuildResult {
  const track = buildTrack(def);
  const v = validateCenterline(track.center);
  return v.ok ? { ok: true, track } : { ...v, track };
}

export const SAMPLE_COUNT = SAMPLE_TRACKS.length;
const sampleCache = new Map<number, Track>();

/** Built-in sample track `i`, turned into dots and validated once, then cached. */
export function getSampleTrack(i: number): Track {
  const idx = ((i % SAMPLE_COUNT) + SAMPLE_COUNT) % SAMPLE_COUNT;
  let t = sampleCache.get(idx);
  if (!t) {
    const def = SAMPLE_TRACKS[idx];
    const res = trackFromControl({ ...def, control: denseToDots(evenControl(def.control)) });
    if (!res.ok) throw new Error(`Sample track "${def.name}" is invalid: ${res.issue}`);
    t = res.track;
    sampleCache.set(idx, t);
  }
  return t;
}

/** A built-in track in the menu's and library's lists: its definition (cheap) and the track itself (built on demand). */
export interface BuiltIn {
  def: TrackDef;
  group: Exclude<TrackGroup, 'mine'>;
  track: () => Track;
}

const builtCache = new Map<string, Track>();

/** A baked built-in, validated once, then cached. */
function bakedTrack(def: TrackDef): Track {
  let t = builtCache.get(def.id);
  if (!t) {
    const res = trackFromControl(def);
    if (!res.ok) throw new Error(`Built-in track "${def.name}" is invalid: ${res.issue}`);
    t = res.track;
    builtCache.set(def.id, t);
  }
  return t;
}

let builtIns: BuiltIn[] | null = null;

/**
 * Every built-in track, in list order: the game's own (the three hand-drawn
 * samples, then the generated ones), then the real-world circuits.
 */
export function builtInTracks(): readonly BuiltIn[] {
  if (!builtIns) {
    const baked = (b: BakedTrack, group: BuiltIn['group']): BuiltIn => {
      const def = bakedDef(b);
      return { def, group, track: () => bakedTrack(def) };
    };
    builtIns = [
      ...SAMPLE_TRACKS.map((_, i): BuiltIn => ({ def: getSampleTrack(i).def, group: 'builtIn', track: () => getSampleTrack(i) })),
      ...CLASSIC_TRACKS.map((b) => baked(b, 'builtIn')),
      ...WORLD_TRACKS.map((b) => baked(b, 'world')),
    ];
  }
  return builtIns;
}

/** The built-in track with this id, or null. */
export function builtInTrack(id: string): Track | null {
  return builtInTracks().find((b) => b.def.id === id)?.track() ?? null;
}

let byContent: Map<string, BuiltIn> | null = null;

export type CodeResult = { ok: true; track: Track } | { ok: false; error: 'format' | 'checksum' | TrackIssue };

/** Track code (or a pasted link containing one) -> validated track. Built-in tracks keep their identity. */
export function trackFromCode(text: string): CodeResult {
  const d = decodeTrack(text);
  if (!d.ok) return d;
  const id = contentId(d.dots, d.options);
  byContent ??= new Map(builtInTracks().map((b) => [contentId(b.def.control, b.def.options), b]));
  const known = byContent.get(id);
  if (known) return { ok: true, track: known.track() };
  const res = trackFromControl({ id, name: d.name.trim() || 'Shared track', control: d.dots, options: d.options });
  return res.ok ? res : { ok: false, error: res.issue };
}
