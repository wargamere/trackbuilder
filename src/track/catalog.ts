import type { TrackOptions } from '../config/track.ts';
import type { Dot } from '../core/math.ts';
import type { TrackDef } from './track.ts';

/** A built-in track as stored in src/track/data (written by scripts/buildTracks.ts). */
export interface BakedTrack {
  id: string;
  name: string;
  /** Where it is (real-world circuits). */
  place?: string;
  options: Partial<TrackOptions>;
  /** Dots as x, y pairs (m). */
  pts: number[];
  /** Dot heights (m), when it isn't flat. */
  hs?: number[];
}

/** Which list a track belongs to: the game's own tracks, real-world circuits, or yours. */
export type TrackGroup = 'builtIn' | 'world' | 'mine';

/** The track definition a baked track describes. */
export function bakedDef(b: BakedTrack): TrackDef {
  const control: Dot[] = [];
  for (let i = 0; i < b.pts.length; i += 2) {
    const h = b.hs?.[i / 2] ?? 0;
    control.push(h ? { x: b.pts[i], y: b.pts[i + 1], h } : { x: b.pts[i], y: b.pts[i + 1] });
  }
  return { id: b.id, name: b.name, control, options: b.options, builtIn: true, place: b.place };
}
