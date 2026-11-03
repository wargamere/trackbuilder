import { CarPhysics, NO_INPUT, type CarState, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { AI } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import { edgeOffsets } from '../track/spline.ts';
import type { Track } from '../track/track.ts';
import { botInput } from './bot.ts';
import { RaceSession } from './session.ts';

/** Grip share and top speed (m/s) for a difficulty from 0 to 1 (see AI.pace). */
export function aiPace(difficulty: number): { aggression: number; maxSpeed: number } {
  const knots = AI.pace;
  const f = clamp(difficulty, 0, 1) * (knots.length - 1);
  const i = Math.min(knots.length - 2, Math.floor(f));
  const u = f - i;
  const [a0, v0] = knots[i];
  const [a1, v1] = knots[i + 1];
  return { aggression: a0 + (a1 - a0) * u, maxSpeed: HANDLING.maxSpeed * (v0 + (v1 - v0) * u) };
}

/**
 * Where grid slot `slot` is (0 = pole): staggered two by two behind the line,
 * pulled in towards the middle where the road is narrow (the inside of a bend).
 */
export function gridPlace(track: Track, slot: number): { s: number; lateral: number } {
  const c = track.center;
  const n = c.points.length;
  const s = -AI.gridFront - slot * AI.gridGap;
  const side = slot % 2 === 0 ? 1 : -1;
  const i = ((Math.round(s / c.spacing) % n) + n) % n;
  const { left, right } = edgeOffsets(c);
  const room = (side > 0 ? left[i] : right[i]) - HANDLING.halfWidth - 0.4;
  return { s, lateral: side * clamp(room, 0, AI.gridLateral) };
}

/** How the grid is decided (see RaceSetup.grid). */
export type GridKind = 'qualifying' | 'random' | 'pick';

/** The player's id in a grid order; AI cars are 0, 1, 2, … */
export const YOU = -1;

/**
 * Grid order (car ids by slot, pole first) for `ai` AI cars. AI cars are
 * listed fastest first and keep that order among themselves, except on a
 * random grid where everyone is shuffled. `pick` puts you in slot
 * `startSlot` (1-based). Qualifying order comes from qualifyingOrder().
 */
export function gridOrder(kind: GridKind, ai: number, startSlot: number, rand: () => number = Math.random): number[] {
  const order = Array.from({ length: ai }, (_, k) => k);
  if (kind === 'random') {
    order.push(YOU);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }
  order.splice(clamp(Math.round(startSlot) - 1, 0, ai), 0, YOU);
  return order;
}

/** Grid order from qualifying times (null = no clean lap: to the back, in id order). */
export function qualifyingOrder(times: ReadonlyMap<number, number | null>): number[] {
  return [...times.entries()]
    .sort(([ia, a], [ib, b]) => (a !== null && b !== null ? a - b : a !== null ? -1 : b !== null ? 1 : ia === YOU ? 1 : ib === YOU ? -1 : ia - ib))
    .map(([id]) => id);
}

/** Name, colour and difficulty (0..1) of each AI car, fastest first: the field spreads out below `difficulty` (%). */
export function aiField(count: number, difficulty: number, paints: readonly number[], names: readonly string[]): { name: string; paint: number; difficulty: number }[] {
  const top = difficulty / 100;
  return Array.from({ length: count }, (_, k) => ({
    name: names[k % names.length],
    paint: paints[k % paints.length],
    difficulty: Math.max(0, top - (count > 1 ? (AI.spread * k) / (count - 1) : 0)),
  }));
}

/** Signed distance along a loop of length `L` from `a` to `b`, in (-L/2, L/2]. */
const along = (a: number, b: number, L: number) => {
  let d = (b - a) % L;
  if (d > L / 2) d -= L;
  if (d <= -L / 2) d += L;
  return d;
};

/**
 * An AI opponent: its own car, lap counter and a driver. It drives the bot's
 * line at a pace set by its difficulty, moves over to pass a slower car in its
 * way (to whichever side has more room), lifts rather than ram one it can't
 * get past, and puts itself back on the road if it gets stuck.
 */
export class AiDriver {
  readonly car: CarPhysics;
  readonly session: RaceSession;
  readonly name: string;
  readonly paint: number;
  readonly difficulty: number;
  /** Where it started (m along the track; negative = behind the line). */
  readonly start: number;
  private readonly track: Track;
  private readonly pace: { aggression: number; maxSpeed: number };
  private readonly inp: DriveInput = { ...NO_INPUT };
  private lane: number;
  private laneTarget = 0;
  private stuck = 0;

  constructor(track: Track, opts: { name: string; paint: number; difficulty: number; laps: number; slot: number }) {
    this.track = track;
    this.name = opts.name;
    this.paint = opts.paint;
    this.difficulty = opts.difficulty;
    this.pace = aiPace(opts.difficulty);
    this.car = new CarPhysics(track);
    const g = gridPlace(track, opts.slot);
    this.start = g.s;
    this.car.placeAt(g.s, g.lateral);
    this.lane = g.lateral;
    this.laneTarget = g.lateral;
    this.session = new RaceSession(track.center.length, null, opts.laps, track.center.width);
  }

  /** Input for the next tick. `cars` are all the cars in the race (this one included). */
  drive(cars: readonly CarState[], dt: number): DriveInput {
    const st = this.car.state;
    const s = this.session;
    if (!s.canDrive) return NO_INPUT;
    const c = this.track.center;
    const L = c.length;
    const finished = s.phase === 'finished';

    // Traffic: the nearest car ahead in (about) our line.
    let ahead: CarState | null = null;
    let gap = Infinity;
    for (const o of cars) {
      if (o === st) continue;
      const ds = along(st.s, o.s, L);
      if (ds <= 0 || ds > AI.lookAhead || ds >= gap) continue;
      if (Math.abs(o.lateral - st.lateral) > AI.sameLine) continue;
      ahead = o;
      gap = ds;
    }
    const room = Math.max(0, c.width / 2 - 1.5);
    if (ahead && !finished && (st.speed > ahead.speed - 0.5 || gap < 8)) {
      // Pass on the side with more room; keep to the side we're on if both are as good.
      const left = clamp(ahead.lateral + AI.passOffset, -room, room);
      const right = clamp(ahead.lateral - AI.passOffset, -room, room);
      const sepL = Math.abs(left - ahead.lateral);
      const sepR = Math.abs(right - ahead.lateral);
      this.laneTarget = Math.abs(sepL - sepR) > 0.5 ? (sepL > sepR ? left : right) : Math.abs(left - st.lateral) < Math.abs(right - st.lateral) ? left : right;
    } else {
      this.laneTarget = 0;
    }
    const step = AI.laneRate * dt;
    this.lane += clamp(this.laneTarget - this.lane, -step, step);
    this.lane = clamp(this.lane, -room, room);

    const maxSpeed = finished ? Math.min(this.pace.maxSpeed, AI.coolDownSpeed) : this.pace.maxSpeed;
    const inp = botInput(st, this.track, this.pace.aggression, { lane: this.lane, maxSpeed }, this.inp);
    // Can't get by yet: lift, and brake a little if we're closing fast.
    if (ahead && gap < 7 && Math.abs(ahead.lateral - st.lateral) < 2 && st.speed > ahead.speed) {
      inp.throttle = 0;
      if (st.speed > ahead.speed + 2) inp.brake = Math.max(inp.brake, 0.4);
    }

    // Stuck against something (or spun into the grass): back onto the road.
    this.stuck = Math.abs(st.speed) < 1.5 ? this.stuck + dt : 0;
    if (this.stuck > AI.stuckSeconds) {
      this.stuck = 0;
      this.car.resetToRoad();
      this.lane = this.laneTarget = 0;
      return NO_INPUT;
    }
    return inp;
  }
}
