import { TRACK } from '../config/track.ts';
import { wrap } from '../core/math.ts';
import { edgeOffsets } from './spline.ts';
import type { Track } from './track.ts';

/** Bit flags per centre-line sample: which edges have a kerb. */
export const KERB_LEFT = 1;
export const KERB_RIGHT = 2;
export const kerbBit = (side: 1 | -1): number => (side === 1 ? KERB_LEFT : KERB_RIGHT);

/** One continuous kerb: `count` + 1 samples from `from` on one edge (+1 left, -1 right). */
export interface KerbRun {
  side: 1 | -1;
  from: number;
  count: number;
  /** True for the kerb on the inside of a corner, at the apex. */
  apex: boolean;
}

export interface KerbLayout {
  runs: KerbRun[];
  /** Per sample: KERB_LEFT | KERB_RIGHT. */
  sides: Uint8Array;
  /** Per sample and side: distance from the centre to the kerb's inner and outer edge (0 = none there). */
  innerL: Float32Array;
  outerL: Float32Array;
  innerR: Float32Array;
  outerR: Float32Array;
}

const cache = new WeakMap<Track, KerbLayout>();

/**
 * Where the kerbs go: along the outside of every corner in `track.kerbs`
 * (with a few metres either side), and along the inside around the apex. The
 * inside kerb follows the road's real inner edge, which is pulled in at
 * hairpins, and is cut short where the corner is too tight for it (it would
 * reach the corner's centre). Nothing when the track's kerbs are off.
 */
export function kerbLayout(track: Track): KerbLayout {
  const hit = cache.get(track);
  if (hit) return hit;
  const c = track.center;
  const n = c.points.length;
  const { left, right } = edgeOffsets(c);
  const out: KerbLayout = {
    runs: [],
    sides: new Uint8Array(n),
    innerL: new Float32Array(n),
    outerL: new Float32Array(n),
    innerR: new Float32Array(n),
    outerR: new Float32Array(n),
  };
  if (track.options.kerbs !== 'none') {
    const kw = TRACK.kerbWidth;
    const mark = (run: KerbRun) => {
      for (let o = 0; o <= run.count; o++) {
        const i = wrap(run.from + o, n);
        const edge = run.side === 1 ? left[i] : right[i];
        // On the inside of a corner the kerb must stop short of the corner's centre.
        const k = c.curvature[i];
        const inside = (k > 0 && run.side === -1) || (k < 0 && run.side === 1);
        const limit = inside ? 0.95 / Math.max(1e-6, Math.abs(k)) : Infinity;
        const outer = Math.min(edge + kw, limit);
        if (outer - edge < 0.3) continue;
        out.sides[i] |= kerbBit(run.side);
        if (run.side === 1) {
          out.innerL[i] = edge - 0.15;
          out.outerL[i] = outer;
        } else {
          out.innerR[i] = edge - 0.15;
          out.outerR[i] = outer;
        }
      }
      out.runs.push(run);
    };
    for (const k of track.kerbs) {
      const outside: 1 | -1 = k.sign > 0 ? 1 : -1; // outside of a right-hander is on the left
      mark({ side: outside, from: k.start - 3, count: k.count + 5, apex: false });
      const half = Math.max(3, Math.round(k.count * 0.3));
      mark({ side: outside === 1 ? -1 : 1, from: k.apex - half, count: half * 2, apex: true });
    }
  }
  cache.set(track, out);
  return out;
}

/** Inner and outer kerb offsets at sample `i` on `side`, or null if there's no kerb there. */
export function kerbAt(k: KerbLayout, i: number, side: 1 | -1): [number, number] | null {
  if (!(k.sides[i] & kerbBit(side))) return null;
  return side === 1 ? [k.innerL[i], k.outerL[i]] : [k.innerR[i], k.outerR[i]];
}
