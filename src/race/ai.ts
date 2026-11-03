import { CarPhysics, NO_INPUT, type CarState, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { AI, CONTACT } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import { edgeOffsets } from '../track/spline.ts';
import type { Track } from '../track/track.ts';
import { RacingDriver } from './driver.ts';
import type { Pace } from './racingLine.ts';
import { RaceSession } from './session.ts';

/** How hard an AI with a difficulty from 0 to 1 drives (see AI.pace). */
export function aiPace(difficulty: number): Pace {
  const knots = AI.pace;
  const f = clamp(difficulty, 0, 1) * (knots.length - 1);
  const i = Math.min(knots.length - 2, Math.floor(f));
  const u = f - i;
  const mix = (k: number) => knots[i][k] + (knots[i + 1][k] - knots[i][k]) * u;
  return { grip: mix(0), maxSpeed: HANDLING.maxSpeed * mix(1), brake: mix(2) };
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
 * An AI opponent: its own car, lap counter and a driver. It drives the racing
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
  private readonly driver: RacingDriver;
  private readonly inp: DriveInput = { ...NO_INPUT };
  /** How far off the racing line it is driving (to pass), and where it's heading. */
  private lane = 0;
  private laneTarget = 0;
  /** Passing: on which side of the line (+1 left, -1 right, 0 = not passing), and for how much longer. */
  private passSide = 0;
  private passTimer = 0;
  /** How long a car ahead has held us well below our pace. */
  private heldUpFor = 0;
  private stuck = 0;

  constructor(track: Track, opts: { name: string; paint: number; difficulty: number; laps: number; slot: number }) {
    this.track = track;
    this.name = opts.name;
    this.paint = opts.paint;
    this.difficulty = opts.difficulty;
    this.driver = new RacingDriver(track, aiPace(opts.difficulty));
    this.car = new CarPhysics(track);
    const g = gridPlace(track, opts.slot);
    this.start = g.s;
    this.car.placeAt(g.s, g.lateral);
    // Off the grid slot, it eases over onto the line.
    this.lane = g.lateral - this.driver.lateralAt(g.s);
    this.session = new RaceSession(track.center.length, null, opts.laps, track.center.width);
  }

  /** Is the racing line gentle over the next stretch (fit to start a pass on)? */
  private gentleAhead(s: number): boolean {
    const c = this.track.center;
    for (let d = 0; d <= AI.passClearAhead; d += c.spacing) {
      if (Math.abs(this.driver.curvatureAt(s + d)) > AI.passMaxCurvature) return false;
    }
    return true;
  }

  /** Input for the next tick. `cars` are all the cars in the race (this one included). */
  drive(cars: readonly CarState[], dt: number): DriveInput {
    const st = this.car.state;
    const s = this.session;
    if (!s.canDrive) return NO_INPUT;
    const c = this.track.center;
    const L = c.length;
    const finished = s.phase === 'finished';

    // Traffic: the nearest car ahead that is in our way: beside where we are now, or beside
    // where we mean to be by the time we'd catch it (our paths may converge across the road).
    let ahead: CarState | null = null;
    let gap = Infinity;
    for (const o of cars) {
      if (o === st || Math.abs(o.y - st.y) > CONTACT.heightGap) continue;
      const ds = along(st.s, o.s, L);
      if (ds <= 0 || ds > AI.lookAhead || ds >= gap) continue;
      const catchIn = Math.min(3, Math.max(0, ds - 2 * CONTACT.halfLength) / Math.max(0.5, st.speed - o.speed));
      const meet = o.s + Math.max(0, o.speed) * catchIn;
      const inWay = (lat: number) => Math.abs(o.lateral - lat) < AI.sameLine;
      if (!inWay(st.lateral) && !inWay(this.driver.lateralAt(o.s, this.lane)) && !inWay(this.driver.lateralAt(meet, this.lane))) continue;
      ahead = o;
      gap = ds;
    }
    // Passing. Only a car that's clearly slower (we're catching it fast, or it has held us
    // well below our own pace for a while), and only starting where the line ahead is
    // gentle, not into a corner. The pass runs beside the racing line (so it bends like the
    // line does) on the side where the car ahead leaves more room, and we keep to that side
    // while anyone is alongside, so we never swing back into a car we're passing.
    const closing = ahead ? st.speed - ahead.speed : 0;
    const heldUp = !!ahead && gap < AI.heldUpGap && this.driver.speedAt(st.s) - st.speed > AI.heldUpBy;
    this.heldUpFor = heldUp ? this.heldUpFor + dt : 0;
    const wantPass = !!ahead && !finished && (closing > AI.passClosing || this.heldUpFor > AI.heldUpSeconds);
    if (ahead && wantPass && (this.passTimer > 0 || this.gentleAhead(st.s))) {
      if (this.passSide === 0) {
        const roomLeft = this.driver.lateralAt(ahead.s, 99) - ahead.lateral;
        const roomRight = ahead.lateral - this.driver.lateralAt(ahead.s, -99);
        this.passSide = roomLeft >= roomRight ? 1 : -1;
      }
      this.passTimer = AI.passHold;
    } else if (this.passTimer > 0) {
      const alongside = cars.some((o) => o !== st && Math.abs(along(st.s, o.s, L)) < 2 * CONTACT.halfLength + 2 && Math.abs(o.lateral - st.lateral) < AI.passOffset + 1.5 && Math.abs(o.y - st.y) < CONTACT.heightGap);
      if (!alongside) this.passTimer -= dt;
      if (this.passTimer <= 0) this.passSide = 0;
    }
    this.laneTarget = this.passTimer > 0 ? this.passSide * AI.passOffset : 0;
    const step = AI.laneRate * dt;
    this.lane += clamp(this.laneTarget - this.lane, -step, step);

    // After the finish it carries on a little slower (not parked on the line for others to hit).
    const inp = this.driver.drive(st, this.lane, this.inp, finished ? AI.afterFinishPace : 1);
    // Closing on the car in our way: slow down to its speed before we'd touch it. Lift when
    // that needs a gentle slowdown, brake for a firmer one. Following at its speed needs nothing.
    if (ahead) {
      const closingNow = st.speed - ahead.speed;
      const gapLeft = Math.max(0.3, gap - 2 * CONTACT.halfLength - AI.followGap);
      const need = closingNow > 0.1 ? (closingNow * closingNow) / (2 * gapLeft) : 0;
      if (need > AI.liftDecel) inp.throttle = 0;
      if (need > AI.brakeDecel) inp.brake = Math.max(inp.brake, clamp(need / (HANDLING.brakeDecel * 0.9), 0.25, 1));
    }

    // Stuck against something (or spun into the grass): back onto the road.
    this.stuck = Math.abs(st.speed) < 1.5 ? this.stuck + dt : 0;
    if (this.stuck > AI.stuckSeconds) {
      this.stuck = 0;
      this.car.resetToRoad();
      this.lane = this.laneTarget = 0;
      this.passSide = 0;
      this.passTimer = 0;
      return NO_INPUT;
    }
    return inp;
  }
}
