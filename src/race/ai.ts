import { CarPhysics, NO_INPUT, type CarState, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { AI, TRAFFIC } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import { edgeOffsets } from '../track/spline.ts';
import type { Track } from '../track/track.ts';
import { RacingDriver } from './driver.ts';
import type { Pace } from './racingLine.ts';
import { RaceSession } from './session.ts';
import { aiCars, TrafficPlanner } from './traffic.ts';

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

/**
 * An AI opponent: its own car, lap counter and a driver. It drives the racing
 * line at a pace set by its difficulty and races the cars around it through a
 * TrafficPlanner: it picks a lane to pass in (or holds its own), never turns
 * into a car alongside, keeps a safe gap behind a car it can't pass yet, and
 * puts itself back on the road if it gets stuck (once nobody is coming).
 */
export class AiDriver {
  readonly car: CarPhysics;
  readonly session: RaceSession;
  readonly name: string;
  readonly paint: number;
  readonly difficulty: number;
  /** Where it started (m along the track; negative = behind the line). */
  readonly start: number;
  private readonly driver: RacingDriver;
  private readonly planner: TrafficPlanner;
  private readonly inp: DriveInput = { ...NO_INPUT };
  /** How far off the racing line it is driving now (+ = left). */
  private lane = 0;
  /** How fast `lane` is changing (m/s). */
  private laneVel = 0;
  private planIn = 0;
  private stuck = 0;
  /** Seconds left taking it easy after a slide or a knock. */
  private recover = 0;

  constructor(track: Track, opts: { name: string; paint: number; difficulty: number; laps: number; slot: number }) {
    this.name = opts.name;
    this.paint = opts.paint;
    this.difficulty = opts.difficulty;
    this.driver = new RacingDriver(track, aiPace(opts.difficulty));
    this.planner = new TrafficPlanner(this.driver, track, opts.difficulty);
    this.car = new CarPhysics(track);
    aiCars.set(this.car.state, opts.difficulty);
    const g = gridPlace(track, opts.slot);
    this.start = g.s;
    this.car.placeAt(g.s, g.lateral);
    // Off the grid it keeps its slot's offset from the line until the planner sees room to move over.
    this.lane = g.lateral - this.driver.lateralAt(g.s);
    this.planner.choice = { offset: this.lane };
    this.session = new RaceSession(track.center.length, null, opts.laps, track.center.width);
  }

  /** Input for the next tick. `cars` are all the cars in the race (this one included). */
  drive(cars: readonly CarState[], dt: number): DriveInput {
    const st = this.car.state;
    const s = this.session;
    if (!s.canDrive) return NO_INPUT;
    const finished = s.phase === 'finished';

    // Which lane (a few dozen times a second), then ease across towards it.
    this.planIn -= dt;
    if (this.planIn <= 0) {
      this.planIn = TRAFFIC.planEvery;
      this.planner.plan(st, cars, this.lane);
    }
    const want = this.planner.choice.offset;
    // Move across smoothly: ease into the move and out of it (a kink at speed would unsettle
    // the car), at most laneRate sideways.
    const T = TRAFFIC;
    const accel = clamp(T.laneStiff * (want - this.lane) - 2 * Math.sqrt(T.laneStiff) * this.laneVel, -T.laneAccel, T.laneAccel);
    this.laneVel = clamp(this.laneVel + accel * dt, -T.laneRate, T.laneRate);
    this.lane += this.laneVel * dt;
    // Stay within the room beside the line whatever the lane says.
    const kept = this.driver.lateralAt(st.s, this.lane) - this.driver.lateralAt(st.s);
    if (Math.abs(kept - this.lane) > 1e-6) {
      this.lane = kept;
      this.laneVel = 0;
    }

    // Speed: the plan, held back to keep a gap behind the car in our way.
    const cap = this.planner.followSpeed(st, cars, this.lane, dt);
    // After the finish it carries on a little slower (not parked on the line for others to hit);
    // letting a quicker car by, it eases off a touch.
    const pace = finished ? AI.afterFinishPace : this.planner.lettingBy ? TRAFFIC.letByEase : 1;
    const inp = this.driver.drive(st, this.lane, this.inp, pace, cap);
    // Sliding (knocked, or ran wide): off the throttle until it gathers itself. No braking,
    // which would only surprise the car behind. (Being off its path is already taken care of:
    // the speed then comes from the path it's really on.)
    this.recover = st.slip > TRAFFIC.recoverSlip ? TRAFFIC.recoverTime : Math.max(0, this.recover - dt);
    // Backing out of a side-by-side it can't win: coast, don't brake. Letting a quicker car
    // by, once it's pulled out beside us: lift a little, even while accelerating.
    if (this.recover > 0 || this.planner.yielding) inp.throttle = 0;
    else if (this.planner.liftForPass) inp.throttle = Math.min(inp.throttle, TRAFFIC.letByThrottle);
    // Closing much too fast on it anyway (it braked hard, or spun): brake now.
    const need = this.planner.brakeNeed;
    if (need > TRAFFIC.emergencyDecel) {
      inp.throttle = 0;
      inp.brake = Math.max(inp.brake, clamp(need / (HANDLING.brakeDecel * 0.9), 0.3, 1));
    }

    // Stuck against something (or spun into the grass): back onto the road, once nobody is
    // coming up behind (it would be put right in front of them).
    this.stuck = Math.abs(st.speed) < 1.5 ? this.stuck + dt : 0;
    if (this.stuck > AI.stuckSeconds && !this.planner.carComing(st, cars)) {
      this.stuck = 0;
      this.car.resetToRoad();
      this.lane = 0;
      this.laneVel = 0;
      this.planner.choice = { offset: 0 };
      return NO_INPUT;
    }
    return inp;
  }
}
