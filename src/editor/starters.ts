import { DEFAULT_OPTIONS, type TrackOptions } from '../config/track.ts';
import type { Dot } from '../core/math.ts';
import { rng } from '../core/random.ts';
import { bakedDef } from '../track/catalog.ts';
import { CLASSIC_TRACKS } from '../track/data/classic.ts';
import type { TrackDef } from '../track/track.ts';
import { getSampleTrack } from './pipeline.ts';
import { reverseDots } from './smoothing.ts';

export type StarterId = 'oval' | 'club' | 'flow' | 'technical';
export const STARTERS: { id: StarterId; name: string; hint: string }[] = [
  { id: 'oval', name: 'Easy oval', hint: 'Wide turns. Find your flow.' },
  { id: 'club', name: 'Club circuit', hint: 'Your first proper raceway.' },
  { id: 'flow', name: 'Flow state', hint: 'Sweeping bends and hills.' },
  { id: 'technical', name: 'Corner club', hint: 'A little more to master.' },
];

/** Editable copies: never mutate a built-in or inherit its record identity. */
export function starterTrack(id: StarterId): TrackDef {
  let control: Dot[];
  let options: TrackOptions = { ...DEFAULT_OPTIONS, runoff: 'tarmac', pits: false };
  if (id === 'oval') {
    control = Array.from({ length: 16 }, (_, i) => {
      const a = i * Math.PI / 8;
      return { x: Math.round(225 * Math.cos(a) * 2) / 2, y: Math.round(115 * Math.sin(a) * 2) / 2 };
    });
    options.width = 15;
  } else {
    const def = id === 'club' ? getSampleTrack(0).def : bakedDef(CLASSIC_TRACKS[id === 'flow' ? 0 : 1]);
    control = def.control.map((p) => ({ ...p }));
    options = { ...options, ...def.options };
  }
  return { id: 'editing', name: STARTERS.find((s) => s.id === id)!.name, control, options };
}

/** Seeded surprise layouts from the tested catalog, mirrored and reversed for variety. */
export function surpriseTrack(seed: number): TrackDef {
  const random = rng(seed);
  const def = bakedDef(CLASSIC_TRACKS[Math.floor(random() * CLASSIC_TRACKS.length)]);
  const mirror = random() > 0.5 ? -1 : 1;
  let control = def.control.map((p) => ({ ...p, x: p.x * mirror }));
  if (random() > 0.5) control = reverseDots(control);
  return { ...def, id: 'editing', builtIn: false, name: `${def.name} Remix`, control, options: { ...DEFAULT_OPTIONS, ...def.options } };
}
