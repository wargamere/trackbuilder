import { CarPhysics, NO_INPUT, STANDARD_CAR, type CarPerformance, type CarState, type DriveInput } from '../car/physics.ts';
import { standardBrake, standardGrip } from '../car/tyres.ts';
import { HANDLING } from '../config/handling.ts';
import { AI, CONDITIONS, DAMAGE, FLAGS, PIT_LANE, TRAFFIC, WEATHER, type Compound } from '../config/race.ts';
import { clamp, wrap } from '../core/math.ts';
import { outerAt, type PitLane } from '../track/pitLane.ts';
import { edgeOffsets } from '../track/spline.ts';
import type { Track } from '../track/track.ts';
import { RacingDriver } from './driver.ts';
import { along, PitCrew } from './pitStop.ts';
import { carPace, planLapTime, racingLine, roadPace, speedProfile, type Pace } from './racingLine.ts';
import { pickCompound, preferredCompound, suggestedSetup, trackTyreLife } from './strategy.ts';
import { RaceSession } from './session.ts';
import { aiCars, TrafficPlanner } from './traffic.ts';
import type { RacecraftAction } from './racecraft.ts';

/** Linear interpolation in `knots` (evenly spaced over 0..1) at `f`. */
function knotAt(knots: readonly number[], f: number): number {
  const x = clamp(f, 0, 1) * (knots.length - 1);
  const i = Math.min(knots.length - 2, Math.floor(x));
  return knots[i] + (knots[i + 1] - knots[i]) * (x - i);
}

/**
 * How hard an AI with a difficulty from 0 to 1 drives (see AI.pace). With a
 * `track`, the pace is tuned to it so the lap is AI.lapRatio × the 100 % lap
 * there (see trackDifficulty()).
 */
export function aiPace(difficulty: number, track?: Track): Pace {
  const d = track ? trackDifficulty(track, Math.min(1, difficulty)) : Math.min(1, difficulty);
  const knots = AI.pace;
  const mix = (k: number) => knotAt(knots.map((p) => p[k]), d);
  return { grip: mix(0), maxSpeed: HANDLING.maxSpeed * mix(1), brake: mix(2) + expertShare(difficulty) * AI.expert.brake };
}

/** 0 at 100% and below; 1 at 110%. Hardware, unlike speed targets alone,
 * makes the extra difficulty physically achievable through fast corners. */
const expertShare = (difficulty: number) => clamp((difficulty - 1) / (AI.maxDifficulty / 100 - 1), 0, 1);
export function aiPerformance(difficulty: number, hardware: Readonly<CarPerformance> = STANDARD_CAR): Readonly<CarPerformance> {
  const x = expertShare(difficulty);
  return x === 0 ? hardware : { grip: hardware.grip * (1 + AI.expert.grip * x), pull: hardware.pull * (1 + AI.expert.pull * x), top: hardware.top * (1 + AI.expert.top * x) };
}

/** The same pace on a wet track: the same share of the grip and the brakes there are (see CONDITIONS). */
export function wetPace(p: Pace): Pace {
  return { ...p, grip: p.grip * CONDITIONS.rainGrip, brake: p.brake * CONDITIONS.rainBrake };
}

/** The way into or out of the pit box: a path across the road (m left of the centre at s), the most it may go, and whether the path leaves the road (the pit lane). */
interface PitPlan {
  route: (s: number) => number;
  cap: number;
  offRoad?: boolean;
}

/** Holding the car still (in the pit box): no throttle, and the handbrake rather than the brake, which would reverse. */
const HOLD: Readonly<DriveInput> = { throttle: 0, brake: 0, steer: 0, handbrake: true };

const tuned = new WeakMap<Track, Map<number, number>>();

/**
 * The raw difficulty (into AI.pace) that gives `difficulty`'s lap on `track`:
 * the one whose planned lap is AI.lapRatio × the 100 % lap there. Without
 * this a track that's flat out most of the way (where grip hardly matters)
 * would make every difficulty nearly as fast as 100 %, and a twisty one would
 * spread them out more. Worked out once per track and difficulty.
 */
export function trackDifficulty(track: Track, difficulty: number): number {
  const d = clamp(difficulty, 0, 1);
  if (d >= 1) return 1;
  let m = tuned.get(track);
  if (!m) tuned.set(track, (m = new Map()));
  const key = Math.round(d * 1000);
  const known = m.get(key);
  if (known !== undefined) return known;
  const line = racingLine(track);
  const lap = (x: number) => planLapTime(line, speedProfile(track, line, roadPace(aiPace(x), track)));
  const want = lap(1) * knotAt(AI.lapRatio, d);
  // Slower with a lower raw difficulty: find where the lap is the one we want.
  let lo = 0;
  let hi = 1;
  if (lap(0) <= want) hi = 0;
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    if (lap(mid) > want) lo = mid;
    else hi = mid;
  }
  m.set(key, hi);
  return hi;
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
 * In the rain it drives the same share of the (lower) grip; with tyre wear it
 * is quicker or slower with the kind of tyres it's on, slows as they wear,
 * and stops in the pit box for new ones before they go off (unless they'll
 * last to the finish), choosing the kind for what's left of the race.
 */
export class AiDriver {
  readonly car: CarPhysics;
  readonly session: RaceSession;
  readonly name: string;
  readonly paint: number;
  readonly difficulty: number;
  /** Where it started (m along the track; negative = behind the line), and its grid slot. */
  readonly start: number;
  private readonly slot: number;
  private readonly driver: RacingDriver;
  private readonly planner: TrafficPlanner;
  private readonly inp: DriveInput = { ...NO_INPUT };
  /** How far off the racing line it is driving now (+ = left). */
  private lane = 0;
  /** How fast `lane` is changing (m/s). */
  private laneVel = 0;
  private planIn = 0;
  private firstPlan = true;
  private stuck = 0;
  /** Seconds left taking it easy after a slide or a knock. */
  private recover = 0;
  /** With tyre wear: its pit crew, where it is in a stop, how close to their going off it stops (laps early; see CONDITIONS.pitEarly), the tyres it prefers and the ones it'll fit next. */
  readonly crew: PitCrew | null;
  private pit: 'none' | 'in' | 'stop' | 'out' = 'none';
  private readonly pitEarly: number;
  private readonly preference: Compound;
  private nextTyres: Compound = 'medium';
  /** How far before the box it set off for it (m), and how long it has been stopped short of it or beside it (s). */
  private pitFrom = 0;
  private pitWait = 0;
  private readonly length: number;
  /** The road its speed plan was made for: dry (0) or soaked (1). As the road gets wetter or drier it drives by the grip and brakes there are against that. */
  private readonly planWetness: number;

  /** Called in to stop this lap whatever its tyres, for these (cleared once it has stopped). */
  boxCall: Compound | null = null;
  /** Race control: the most it may go (the safety car), and yellow flags where it is. */
  raceCap = Infinity;
  yellow = false;
  /** Current committed racecraft decision, exposed for replay/debugging. */
  get racecraft(): RacecraftAction { return this.planner.action; }

  /**
   * `slot`: its place on the grid; `box`: whose pit box it uses (see pitBox:
   * 0 is yours; by default slot + 1).
   */
  constructor(track: Track, opts: { name: string; paint: number; difficulty: number; laps: number; slot: number; box?: number; wet?: boolean; tyreWear?: boolean; damage?: boolean; mediumLife?: number; tune?: Readonly<CarPerformance> }) {
    const wet = !!opts.wet;
    this.name = opts.name;
    this.paint = opts.paint;
    this.difficulty = opts.difficulty;
    // Its team's setup for the track (the quickest wing there), and a speed plan that knows it.
    // (Its top speed is scaled with the wing's, so the field keeps its spread of straight-line
    // speed: with more drag every car's top end comes down, not just the quick ones'.)
    const setup = suggestedSetup(track);
    const tune = aiPerformance(opts.difficulty, opts.tune);
    const base = aiPace(opts.difficulty, track);
    const pace = roadPace(carPace(base, setup, tune), track);
    this.driver = new RacingDriver(track, opts.wet ? wetPace(pace) : pace);
    this.planner = new TrafficPlanner(this.driver, track, opts.difficulty);
    this.car = new CarPhysics(track);
    this.car.tune = tune;
    this.car.setup = setup;
    this.car.wet = wet;
    this.planWetness = wet ? 1 : 0;
    this.car.wear = !!opts.tyreWear;
    this.car.damageOn = !!opts.damage;
    this.length = track.center.length;
    // Not everyone stops on the same lap, or picks the same tyres for a stint.
    this.pitEarly = CONDITIONS.pitEarly[opts.slot % CONDITIONS.pitEarly.length];
    this.preference = preferredCompound(opts.slot);
    if (opts.tyreWear) {
      // (How long the tyres last: the track's own figure, unless the race says otherwise.)
      this.car.mediumLife = opts.mediumLife ?? trackTyreLife(track);
      // The quickest tyres that last the race, else its own choice.
      this.car.newTyres(pickCompound(opts.laps, this.car.mediumLife, wet ? 1 : 0, this.preference));
    }
    aiCars.set(this.car.state, opts.difficulty);
    const g = gridPlace(track, opts.slot);
    this.start = g.s;
    this.slot = opts.slot;
    this.car.placeAt(g.s, g.lateral);
    // Off the grid it keeps its slot's offset from the line until the planner sees room to move over.
    this.lane = g.lateral - this.driver.lateralAt(g.s);
    this.planner.choice = { offset: this.lane };
    this.session = new RaceSession(track.center.length, null, opts.laps, track.center.width);
    // (A pit crew for new tyres, or for repairs.)
    this.crew = opts.tyreWear || opts.damage ? new PitCrew(track, opts.box ?? opts.slot + 1) : null;
    this.crew?.reset(this.car.state);
  }

  /** In the middle of a pit stop (going in, stopped, or coming out). */
  get pitting(): boolean {
    return this.pit !== 'none';
  }

  /**
   * Pit stops: whether to go in now (tyres worn, enough of the race left, and
   * the box far enough ahead to pull over and brake for it), then the way
   * into the box and the speed to stop in it, the stop itself, and the way
   * back out onto the line. Null when it isn't stopping; 'hold' while the
   * crew works on the car.
   */
  private pitPlan(st: CarState, finished: boolean, dt: number): PitPlan | 'hold' | null {
    const crew = this.crew;
    if (!crew) return null;
    if (this.car.pitLane) return this.lanePlan(st, finished, dt, crew, this.car.pitLane);
    const C = CONDITIONS;
    const box = crew.box;
    const L = this.length;
    const start = box.s - box.length / 2;
    const end = box.s + box.length / 2;
    const line = (x: number) => this.driver.lateralAt(x);
    const smooth = (u: number) => u * u * (3 - 2 * u);
    if (this.pit === 'none') {
      const fit = this.stopWanted(st, finished);
      if (!fit) return null;
      // Far enough ahead to brake for it gently, not so far it would pull over too soon.
      const v = Math.max(0, st.speed);
      const need = Math.max(C.pitApproach, (v * v) / (2 * C.pitDecel) + 40);
      const d = wrap(start - st.s, L);
      if (d < need || d > need + 60 || d > L / 2 - 20) return null;
      this.pit = 'in';
      this.pitFrom = d;
      this.pitWait = 0;
      this.nextTyres = fit;
    }
    if (this.pit === 'in' || this.pit === 'stop') {
      const ev = crew.step(this.car, dt, this.nextTyres);
      if (ev === 'start') this.pit = 'stop';
      else if (ev === 'done') {
        this.pit = 'out';
        this.boxCall = null;
      }
    }
    if (this.pit === 'stop') return 'hold';
    if (this.pit === 'in') {
      // Overshot it: try again next lap.
      if (along(end, st.s, L) > 1) {
        this.pit = 'none';
        return null;
      }
      // Stopped (just short of it, or beside it, held off by a car): it holds still (the brakes
      // would reverse it) and, if that isn't in the box, gives up after a moment.
      const toStop = along(st.s, box.s - 0.5, L);
      if (toStop < 4 && st.speed < C.stopSpeed) {
        this.pitWait += dt;
        if (this.pitWait < 1.5) return 'hold';
        this.pit = 'none';
        return null;
      }
      // Across to the box over the approach, there 20 m before it; brake to stop just short of its middle.
      const into = (x: number) => {
        const u = clamp(1 - (along(x, start, L) - 20) / Math.max(20, this.pitFrom - 20), 0, 1);
        return line(x) + (crew.box.lateral - line(x)) * smooth(u);
      };
      return { route: into, cap: toStop > 0 ? Math.sqrt(2 * C.pitDecel * toStop) : 0 };
    }
    // Out of the box and back onto the line.
    const out = along(end, st.s, L);
    if (out > C.pitExit) {
      this.pit = 'none';
      return null;
    }
    const exit = (x: number) => box.lateral + (line(x) - box.lateral) * smooth(clamp(along(end, x, L) / C.pitExit, 0, 1));
    return { route: exit, cap: Infinity };
  }

  /**
   * Whether to stop this lap, and if so the tyres to fit: tyres about to go
   * off (unless the race is all but over or they'll last it), the weather
   * changing (wets or slicks), or bad damage.
   */
  private stopWanted(st: CarState, finished: boolean): Compound | null {
    const C = CONDITIONS;
    const s = this.session;
    const car = this.car;
    const L = this.length;
    if (finished || s.lapStart === null) return null;
    if (this.boxCall) return this.boxCall;
    const left = (s.lapsToRun * L - s.raceDistance(st.s)) / L;
    // The weather: wets once the road is wet enough, slicks once it's dried enough (each car
    // makes its own call: some early, some late).
    const k = this.slot % WEATHER.aiToWets.length;
    const onWets = car.compound === 'wet';
    const wantWets = car.wear && (onWets ? car.wetness > WEATHER.aiToSlicks[k] : car.wetness > WEATHER.aiToWets[k]);
    // Badly damaged: in for repairs (unless the race is all but over).
    const repairs = car.damageOn && car.damage >= DAMAGE.aiPitAt;
    if (repairs) {
      if (left < C.pitMinLaps) return null;
    } else if (!car.wear) return null;
    else if (wantWets === onWets) {
      // Wear: in now if they'd go off before the box comes round again (give or take its own
      // margin), unless the race is all but over, or they'll last to the finish.
      const onTyres = car.tyreLapsLeft;
      if (onTyres >= 1 + this.pitEarly) return null;
      if (left < C.pitMinLaps || left <= onTyres + C.pitEndSlack) return null;
    } else if (left < C.pitMinLaps) return null;
    return car.wear ? pickCompound(left, car.mediumLife, wantWets ? 1 : 0, this.preference) : car.compound;
  }

  /**
   * A stop through the pit lane: over to the road's edge before it, braking
   * to be down to the limit at the line; along the fast lane, into its box and
   * stopped in it; then out to the fast lane, held to the limit to the end of
   * the pit wall, and back onto the line over the exit ramp. Once in the lane
   * it never gives up (it can't get back to the track until the exit): held
   * up by a car stopped in its box, it waits behind it; pushed past its box,
   * it drives on out and tries again next lap.
   */
  private lanePlan(st: CarState, finished: boolean, dt: number, crew: PitCrew, lane: PitLane): PitPlan | 'hold' | null {
    const C = CONDITIONS;
    const P = PIT_LANE;
    const L = this.length;
    const side = lane.side;
    // Distances from the entry (negative before it), and where things are along the lane.
    const rel = (x: number) => wrap(x - lane.entry + L / 2, L) - L / 2;
    const span = lane.exit - lane.entry;
    const wallFrom = lane.wallFrom - lane.entry;
    const wallTo = lane.wallTo - lane.entry;
    const boxAt = crew.box.s - lane.entry;
    const smooth = (u: number) => {
      const v = clamp(u, 0, 1);
      return v * v * (3 - 2 * v);
    };
    const line = (x: number) => this.driver.lateralAt(x);
    const half = HANDLING.halfWidth;
    const edge = lane.edge - half - 0.3;
    // (Never closer than this to the lane's outer edge, however the path goes.)
    const within = (x: number, m: number) => Math.min(m, (outerAt(lane, x) ?? lane.wall) - half - 0.6);
    const r = rel(st.s);
    if (this.pit === 'none') {
      const fit = this.stopWanted(st, finished);
      if (!fit) return null;
      // Far enough ahead of the entry to move over and brake to the limit by the line.
      const v = Math.max(0, st.speed);
      const brake = (v * v - P.limit * P.limit) / (2 * C.pitDecel);
      const need = Math.max(90, brake - (wallFrom - P.brakeMargin) + 70);
      const d = -r;
      if (d < need || d > need + 60) return null;
      this.pit = 'in';
      this.pitFrom = d;
      this.pitWait = 0;
      this.nextTyres = fit;
    }
    if (this.pit === 'in' || this.pit === 'stop') {
      const ev = crew.step(this.car, dt, this.nextTyres);
      if (ev === 'start') this.pit = 'stop';
      else if (ev === 'done') {
        this.pit = 'out';
        this.boxCall = null;
      }
    }
    if (this.pit === 'stop') return 'hold';
    // Down to the limit by the line (a little before it), and in the lane held to it.
    const limitCap = r < wallFrom ? Math.sqrt(P.limit * P.limit + 2 * C.pitDecel * Math.max(0, wallFrom - P.brakeMargin - r)) : P.limit;
    if (this.pit === 'in') {
      // Pushed past its box without stopping: on out, and again next lap.
      if (r > boxAt + 2 && r < span + 40) this.pit = 'out';
      else {
        const approach = clamp(this.pitFrom - 20, 40, 160);
        const toStop = boxAt - r - 0.5;
        const into = (x: number) => {
          const q = rel(x);
          if (q < 0) return line(x) + (edge * side - line(x)) * smooth((q + approach) / approach);
          let m = edge + (lane.fast - edge) * smooth(q / (wallFrom - 3));
          m += (lane.box - lane.fast) * smooth((q - (boxAt - 20)) / 14);
          return within(x, m) * side;
        };
        return { route: into, cap: Math.min(limitCap, toStop > 0 ? Math.sqrt(2 * C.pitDecel * toStop) : 0), offRoad: true };
      }
    }
    // Out of the box to the fast lane, along it to the end of the pit wall, then back onto the line.
    if (r > span + 15 || r < -20) {
      this.pit = 'none';
      return null;
    }
    const back = wallTo + 3;
    const out = (x: number) => {
      const q = rel(x);
      let m = lane.box + (lane.fast - lane.box) * smooth((q - boxAt - 1) / 14);
      m += (line(x) * side - lane.fast) * smooth((q - back) / (span + 15 - back));
      return (q <= span ? within(x, m) : m) * side;
    };
    return { route: out, cap: r < wallTo ? P.limit : Infinity, offRoad: true };
  }

  /** Input for the next tick. `cars` are all the cars in the race (this one included). */
  drive(cars: readonly CarState[], dt: number): DriveInput {
    const st = this.car.state;
    const s = this.session;
    if (!s.canDrive) {
      // The first decision, made in the last moments of the countdown, one car a tick (the
      // cars stand still on the grid meanwhile): all of them at once at the start made the
      // frame the lights go out on a long one. It's ready the moment the car can go.
      const left = Math.round(s.goTime / dt) - s.tick;
      if (this.firstPlan && s.phase === 'countdown' && left === 1 + (this.slot % AI.firstPlanSpread)) {
        this.planner.tacticsEnabled = !this.yellow && !Number.isFinite(this.raceCap);
        this.planner.plan(st, cars, this.lane);
        this.firstPlan = false;
        // Its next decision then comes when it would have, had it made this one at the start.
        const ticks = Math.floor(TRAFFIC.planEvery / dt) + 1;
        this.planIn = (ticks - .5 + this.slot % ticks) * dt + dt;
      }
      return NO_INPUT;
    }
    // Retired (broken down): it's out of the race, stopped where it is (the car itself sees to that).
    if (s.retired) return NO_INPUT;
    const finished = s.phase === 'finished';
    const pit = this.pitPlan(st, finished, dt);
    if (pit === 'hold') return HOLD;

    // Which lane (a few dozen times a second), then ease across towards it.
    this.planIn -= dt;
    if (this.planIn <= 0) {
      this.planIn = TRAFFIC.planEvery;
      this.planner.tacticsEnabled = !pit && !finished && !this.yellow && !Number.isFinite(this.raceCap);
      this.planner.plan(st, cars, this.lane);
      if (this.firstPlan) {
        // Everyone reacts to the start immediately. After that, distribute
        // expensive forecasts across ticks while keeping their normal cadence.
        const ticks = Math.floor(TRAFFIC.planEvery / dt) + 1;
        this.planIn = (ticks - .5 + this.slot % ticks) * dt;
        this.firstPlan = false;
      }
    }
    // Move across smoothly: ease into the move and out of it (a kink at speed would unsettle
    // the car), at most laneRate sideways.
    const want = this.planner.choice.offset;
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
    // Well away from its lane (held off it to keep room from a car, going by one, or knocked):
    // the lane is where it is, so it eases back from there rather than swinging straight across.
    const off = st.lateral - this.driver.lateralAt(st.s);
    if (Math.abs(off - this.lane) > AI.laneSync) {
      this.lane = off - Math.sign(off - this.lane) * AI.laneSync;
      this.laneVel = 0;
    }

    // Speed: the plan, held back to keep a gap behind the car in our way.
    // (And held to the safety car's pace.)
    const cap = Math.min(this.planner.followSpeed(st, cars, this.lane, dt), pit?.cap ?? Infinity, this.raceCap);
    // After the finish it carries on a little slower (not parked on the line for others to hit);
    // letting a quicker car by, it eases off (but not in the middle of a tight bend).
    let pace = finished ? AI.afterFinishPace : this.planner.lettingBy && !this.planner.inBend ? TRAFFIC.letByEase : 1;
    // Off the line at the start, the field strings out a little (each slot back a touch
    // slower for the first stretch), so the pack isn't three wide into the first bend.
    const run = s.raceDistance(st.s);
    this.planner.started = run >= TRAFFIC.letByFrom;
    if (run < AI.startStretch) pace *= 1 - AI.startSpread * this.slot;
    // Close to another car, a touch of caution.
    if (this.planner.crowded) pace *= 1 - TRAFFIC.crowdEase;
    // Yellow flags: ease off.
    if (this.yellow) pace *= FLAGS.yellowPace;
    // Stuck behind a slower car that isn't an AI (you): a push to get by, like a tow (see
    // TrafficPlanner.pushing).
    if (this.planner.pushing) this.car.draft = Math.max(this.car.draft, TRAFFIC.pushTow);
    // With a car beside us, its room: we bend our path round it rather than turn in on it.
    // (Not on the way through the pit lane: its path is its own.)
    const keep = pit?.offRoad ? null : this.planner.keepOut(st, cars);
    // Covering the inside against you: a path of its own (and the lane follows where it is, to
    // carry on from there after). Fighting you for a place into a bend: later on the brakes.
    const route = pit?.route ?? this.planner.coverPath();
    if (route) {
      this.lane = st.lateral - this.driver.lateralAt(st.s);
      this.laneVel = 0;
    }
    const inp = this.driver.drive(st, this.lane, this.inp, { pace, cap, tow: this.car.draft, keep, late: this.planner.fighting, route, offRoad: !!pit?.offRoad, grip: (this.car.gripScale * this.car.damageGrip) / standardGrip(this.planWetness), brake: this.car.brakeScale / standardBrake(this.planWetness) });
    // Sliding (knocked, or ran wide): easing off the throttle until it gathers itself. No braking,
    // which would only surprise the car behind. (Being off its path is already taken care of:
    // the speed then comes from the path it's really on.)
    // A small slip angle is normal through a fast chicane. The old fixed 3 m/s
    // threshold repeatedly cut the throttle during a controlled direction change.
    // Still catch a real slide, leaving the path or running off the road promptly.
    const pathLat = route ? route(st.s) : this.driver.lateralAt(st.s, this.lane);
    const i = Math.max(0, st.trackIndex), line = this.driver.line;
    const atEdge = !pit?.offRoad && (st.lateral < line.lo[i] || st.lateral > line.hi[i]);
    const sliding = st.slip > TRAFFIC.recoverSlip && (st.slip > Math.abs(st.speed) * TRAFFIC.recoverSlipRatio || Math.abs(st.lateral - pathLat) > TRAFFIC.recoverOffLine || atEdge || st.offTrack);
    this.recover = sliding ? TRAFFIC.recoverTime : Math.max(0, this.recover - dt);
    // (Backing out of a side-by-side it can't win is in the cap: a touch slower than the other
    // car.) Letting a quicker car by, once it's pulled out beside us: lift a little, even while
    // accelerating.
    if (this.recover > 0) inp.throttle = Math.min(inp.throttle, TRAFFIC.recoverThrottle);
    else if (this.planner.liftForPass) inp.throttle = Math.min(inp.throttle, TRAFFIC.letByThrottle);
    // Closing much too fast on it anyway (it braked hard, or spun): brake now.
    const need = this.planner.brakeNeed;
    if (need > TRAFFIC.emergencyDecel) {
      inp.throttle = 0;
      inp.brake = Math.max(inp.brake, clamp(need / (HANDLING.brakeDecel * 0.9), 0.3, 1));
    }

    // Stuck against something (or spun into the grass): back onto the road, once nobody is
    // coming up behind (it would be put right in front of them).
    this.stuck = Math.abs(st.speed) < 1.5 && !pit ? this.stuck + dt : 0;
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
