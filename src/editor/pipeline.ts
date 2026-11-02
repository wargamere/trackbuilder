import { INK, type SmoothingLevel } from '../config/track.ts';
import type { Vec2 } from '../core/math.ts';
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

export type CodeResult = { ok: true; track: Track } | { ok: false; error: 'format' | 'checksum' | TrackIssue };

/** Track code (or a pasted link containing one) -> validated track. Built-in samples keep their identity. */
export function trackFromCode(text: string): CodeResult {
  const d = decodeTrack(text);
  if (!d.ok) return d;
  const id = contentId(d.dots);
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const s = getSampleTrack(i);
    if (contentId(s.def.control) === id) return { ok: true, track: s };
  }
  const res = trackFromControl({ id, name: d.name.trim() || 'Shared track', control: d.dots });
  return res.ok ? res : { ok: false, error: res.issue };
}
