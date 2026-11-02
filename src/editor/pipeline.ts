import { INK } from '../config/track.ts';
import type { Vec2 } from '../core/math.ts';
import { buildTrack, newTrackId, type Track, type TrackDef } from '../track/track.ts';
import { SAMPLE_TRACKS } from '../track/samples.ts';
import { dedupe, evenControl, prepareControl, strokeToControl } from './smoothing.ts';
import { validateCenterline, type TrackIssue } from './validation.ts';

export type BuildResult = { ok: true; track: Track } | { ok: false; issue: TrackIssue; at?: Vec2 };

/** Raw pointer stroke (world metres) -> smoothed, validated track. */
export function trackFromStroke(raw: readonly Vec2[], name: string): BuildResult {
  const stroke = strokeToControl(dedupe(raw, INK.minStep));
  if (!stroke.ok) return stroke;
  return trackFromControl({ id: newTrackId(), name, control: prepareControl(stroke.control) });
}

/** Builds and validates a track whose control points are already prepared. */
export function trackFromControl(def: TrackDef): BuildResult {
  const track = buildTrack(def);
  const v = validateCenterline(track.center);
  return v.ok ? { ok: true, track } : v;
}

export const SAMPLE_COUNT = SAMPLE_TRACKS.length;
const sampleCache = new Map<number, Track>();

/** Built-in sample track `i`, prepared and validated once, then cached. */
export function getSampleTrack(i: number): Track {
  const idx = ((i % SAMPLE_COUNT) + SAMPLE_COUNT) % SAMPLE_COUNT;
  let t = sampleCache.get(idx);
  if (!t) {
    const def = SAMPLE_TRACKS[idx];
    const res = trackFromControl({ ...def, control: prepareControl(evenControl(def.control)) });
    if (!res.ok) throw new Error(`Sample track "${def.name}" is invalid: ${res.issue}`);
    t = res.track;
    sampleCache.set(idx, t);
  }
  return t;
}
