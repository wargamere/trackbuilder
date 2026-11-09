import type { CarPhysics, CarState } from '../car/physics.ts';
import { CONDITIONS, DAMAGE, type Compound } from '../config/race.ts';
import { wrap } from '../core/math.ts';
import { pitLayout } from '../track/pits.ts';
import { edgeOffsets } from '../track/spline.ts';
import type { Track } from '../track/track.ts';

/**
 * The pit box: a marked bay at the road's edge on the start straight (in
 * front of the middle garage when the track has pits). Stop in it and the
 * crew fits new tyres. It's on the track itself, so a car in it is in the
 * way of the cars coming past, as in a real pit lane only quicker.
 */
export interface PitBox {
  /** Track position of its middle (m from the start line, 0..length). */
  s: number;
  length: number;
  /** Its middle across the road (m left of the centre line), and its width (m). */
  lateral: number;
  width: number;
  /** +1 = on the left of the direction of travel, -1 = the right. */
  side: 1 | -1;
}

const boxes = new WeakMap<Track, PitBox>();

/** The track's pit box (worked out once per track). */
export function pitBox(track: Track): PitBox {
  const known = boxes.get(track);
  if (known) return known;
  const C = CONDITIONS;
  const c = track.center;
  const L = c.length;
  const n = c.points.length;
  const pits = pitLayout(track);
  const side = pits?.side ?? -1;
  // In front of a garage, the one nearest the middle that keeps the box off the start line
  // (and the grid behind it); with no pits, a little way past the line.
  const clear = C.boxLength / 2 + 6;
  const doors = (pits?.doors ?? []).filter((d) => d >= clear);
  const mid = pits ? (pits.from + pits.to) / 2 : 0;
  const door = doors.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
  const s = wrap(door ?? C.boxDefaultS, L);
  // Against the road's edge where it's narrowest along the box.
  const { left, right } = edgeOffsets(c);
  let edge = Infinity;
  for (let x = s - C.boxLength / 2; x <= s + C.boxLength / 2 + 0.01; x += c.spacing) {
    const i = wrap(Math.round(x / c.spacing), n);
    edge = Math.min(edge, side > 0 ? left[i] : right[i]);
  }
  const lateral = side * Math.max(0, edge - C.boxInset - C.boxWidth / 2);
  const box: PitBox = { s, length: C.boxLength, lateral, width: C.boxWidth, side };
  boxes.set(track, box);
  return box;
}

/** Signed distance (m) from track position `from` forward to `to`, wrapped into -L/2..L/2. */
export function along(from: number, to: number, L: number): number {
  let d = (to - from) % L;
  if (d > L / 2) d -= L;
  if (d <= -L / 2) d += L;
  return d;
}

/** The car is in the box: its middle within the marked bay (a little leeway across). */
export function inBox(box: PitBox, L: number, st: CarState): boolean {
  return Math.abs(along(box.s, st.s, L)) <= box.length / 2 - 1.5 && Math.abs(st.lateral - box.lateral) <= box.width / 2 + 0.3;
}

export type PitEvent = 'start' | 'done' | null;

/**
 * One car's pit stops. Stop in the box (slower than CONDITIONS.stopSpeed)
 * and the crew holds the car while it fits new tyres (CONDITIONS.service s,
 * with tyre wear on) and mends any damage (DAMAGE.repairTime s more per unit),
 * of the kind asked for when it's done;
 * then it's free to go. Leave the box before the next stop can start (no
 * second stop by standing there, and none for a car that starts in it).
 */
export class PitCrew {
  readonly box: PitBox;
  private readonly length: number;
  /** Seconds of the stop left (0 = not stopped). */
  service = 0;
  /** Stops made this run. */
  stops = 0;
  /** Ready for a stop: the car has been outside the box since the last one. */
  private armed = false;

  constructor(track: Track) {
    this.box = pitBox(track);
    this.length = track.center.length;
  }

  /** A new run, with the car at `st`. */
  reset(st: CarState): void {
    this.service = 0;
    this.stops = 0;
    this.armed = !inBox(this.box, this.length, st);
  }

  /** True while the crew is holding the car (its input should be the brakes). */
  get busy(): boolean {
    return this.service > 0;
  }

  /** One physics tick for `car` (after it has moved): starts, counts down and ends a stop, fitting `fit` (the same kind by default). */
  step(car: CarPhysics, dt: number, fit: Compound = car.compound): PitEvent {
    const st = car.state;
    if (this.service > 0) {
      this.service = Math.max(0, this.service - dt);
      if (this.service > 0) return null;
      if (car.wear) car.newTyres(fit);
      car.repair();
      this.stops++;
      return 'done';
    }
    const inside = inBox(this.box, this.length, st);
    if (!inside) {
      this.armed = true;
      return null;
    }
    if (this.armed && Math.abs(st.speed) < CONDITIONS.stopSpeed) {
      this.armed = false;
      // New tyres, and the damage mended (longer the more there is).
      this.service = CONDITIONS.service + (car.damageOn ? DAMAGE.repairTime * car.damage : 0);
      return 'start';
    }
    return null;
  }
}
