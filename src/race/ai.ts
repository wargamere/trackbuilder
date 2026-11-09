import { CarPhysics, NO_INPUT, type CarState, type DriveInput } from '../car/physics.ts';
import { standardBrake, standardGrip } from '../car/tyres.ts';
import { HANDLING } from '../config/handling.ts';
import { AI, CONDITIONS, SETUP, TRAFFIC, WEATHER, type Compound } from '../config/race.ts';
import { clamp, wrap } from '../core/math.ts';
import { edgeOffsets } from '../track/spline.ts';
import type { Track } from '../track/track.ts';
import { RacingDriver } from './driver.ts';
import { along, PitCrew } from './pitStop.ts';
import { planLapTime, racingLine, speedProfile, topSpeed, type Pace } from './racingLine.ts';
import { pickCompound, preferredCompound, suggestedSetup, trackTyreLife } from './strategy.ts';
import { RaceSession } from './session.ts';
import { aiCars, TrafficPlanner } from './traffic.ts';

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
  const d = track ? trackDifficulty(track, difficulty) : difficulty;
  const knots = AI.pace;
  const mix = (k: number) => knotAt(knots.map((p) => p[k]), d);
  return { grip: mix(0), maxSpeed: HANDLING.maxSpeed * mix(1), brake: mix(2) };
}

/** The same pace on a wet track: the same share of the grip and the brakes there are (see CONDITIONS). */
export function wetPace(p: Pace): Pace {
  return { ...p, grip: p.grip * CONDITIONS.rainGrip, brake: p.brake * CONDITIONS.rainBrake };
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
  const lap = (x: number) => planLapTime(line, speedProfile(track, line, aiPace(x)));
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

  constructor(track: Track, opts: { name: string; paint: number; difficulty: number; laps: number; slot: number; wet?: boolean; tyreWear?: boolean }) {
    const wet = !!opts.wet;
    this.name = opts.name;
    this.paint = opts.paint;
    this.difficulty = opts.difficulty;
    // Its team's setup for the track (the quickest wing there), and a speed plan that knows it.
    // (Its top speed is scaled with the wing's, so the field keeps its spread of straight-line
    // speed: with more drag every car's top end comes down, not just the quick ones'.)
    const setup = suggestedSetup(track);
    const wing = SETUP.wing[setup.wing];
    const base = aiPace(opts.difficulty, track);
    const pace = { ...base, maxSpeed: base.maxSpeed * (topSpeed(wing.drag) / topSpeed()), downforce: wing.downforce, drag: wing.drag };
    this.driver = new RacingDriver(track, opts.wet ? wetPace(pace) : pace);
    this.planner = new TrafficPlanner(this.driver, track, opts.difficulty);
    this.car = new CarPhysics(track);
    this.car.setup = setup;
    this.car.wet = wet;
    this.planWetness = wet ? 1 : 0;
    this.car.wear = !!opts.tyreWear;
    this.length = track.center.length;
    // Not everyone stops on the same lap, or picks the same tyres for a stint.
    this.pitEarly = CONDITIONS.pitEarly[opts.slot % CONDITIONS.pitEarly.length];
    this.preference = preferredCompound(opts.slot);
    if (opts.tyreWear) {
      this.car.mediumLife = trackTyreLife(track);
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
    this.crew = opts.tyreWear ? new PitCrew(track) : null;
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
  private pitPlan(st: CarState, finished: boolean, dt: number): { route: (s: number) => number; cap: number } | 'hold' | null {
    const crew = this.crew;
    if (!crew) return null;
    const C = CONDITIONS;
    const box = crew.box;
    const L = this.length;
    const start = box.s - box.length / 2;
    const end = box.s + box.length / 2;
    const line = (x: number) => this.driver.lateralAt(x);
    const smooth = (u: number) => u * u * (3 - 2 * u);
    if (this.pit === 'none') {
      const s = this.session;
      const car = this.car;
      if (finished || s.lapStart === null) return null;
      const left = (s.lapsToRun * L - s.raceDistance(st.s)) / L;
      // The weather: wets once the road is wet enough, slicks once it's dried enough (each car
      // makes its own call: some early, some late).
      const k = this.slot % WEATHER.aiToWets.length;
      const onWets = car.compound === 'wet';
      const wantWets = onWets ? car.wetness > WEATHER.aiToSlicks[k] : car.wetness > WEATHER.aiToWets[k];
      if (wantWets === onWets) {
        // Wear: in now if they'd go off before the box comes round again (give or take its own
        // margin), unless the race is all but over, or they'll last to the finish.
        const onTyres = car.tyreLapsLeft;
        if (onTyres >= 1 + this.pitEarly) return null;
        if (left < C.pitMinLaps || left <= onTyres + C.pitEndSlack) return null;
      } else if (left < C.pitMinLaps) return null;
      // Far enough ahead to brake for it gently, not so far it would pull over too soon.
      const v = Math.max(0, st.speed);
      const need = Math.max(C.pitApproach, (v * v) / (2 * C.pitDecel) + 40);
      const d = wrap(start - st.s, L);
      if (d < need || d > need + 60 || d > L / 2 - 20) return null;
      this.pit = 'in';
      this.pitFrom = d;
      this.pitWait = 0;
      this.nextTyres = pickCompound(left, car.mediumLife, wantWets ? 1 : 0, this.preference);
    }
    if (this.pit === 'in' || this.pit === 'stop') {
      const ev = crew.step(this.car, dt, this.nextTyres);
      if (ev === 'start') this.pit = 'stop';
      else if (ev === 'done') this.pit = 'out';
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

  /** Input for the next tick. `cars` are all the cars in the race (this one included). */
  drive(cars: readonly CarState[], dt: number): DriveInput {
    const st = this.car.state;
    const s = this.session;
    if (!s.canDrive) return NO_INPUT;
    const finished = s.phase === 'finished';
    const pit = this.pitPlan(st, finished, dt);
    if (pit === 'hold') return HOLD;

    // Which lane (a few dozen times a second), then ease across towards it.
    this.planIn -= dt;
    if (this.planIn <= 0) {
      this.planIn = TRAFFIC.planEvery;
      this.planner.plan(st, cars, this.lane);
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
    const cap = Math.min(this.planner.followSpeed(st, cars, this.lane, dt), pit?.cap ?? Infinity);
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
    // Stuck behind a slower car that isn't an AI (you): a push to get by, like a tow (see
    // TrafficPlanner.pushing).
    if (this.planner.pushing) this.car.draft = Math.max(this.car.draft, TRAFFIC.pushTow);
    // With a car beside us, its room: we bend our path round it rather than turn in on it.
    const keep = this.planner.keepOut(st, cars);
    // Covering the inside against you: a path of its own (and the lane follows where it is, to
    // carry on from there after). Fighting you for a place into a bend: later on the brakes.
    const route = pit?.route ?? this.planner.coverPath();
    if (route) {
      this.lane = st.lateral - this.driver.lateralAt(st.s);
      this.laneVel = 0;
    }
    const inp = this.driver.drive(st, this.lane, this.inp, { pace, cap, tow: this.car.draft, keep, late: this.planner.fighting, route, grip: this.car.gripScale / standardGrip(this.planWetness), brake: this.car.brakeScale / standardBrake(this.planWetness) });
    // Sliding (knocked, or ran wide): easing off the throttle until it gathers itself. No braking,
    // which would only surprise the car behind. (Being off its path is already taken care of:
    // the speed then comes from the path it's really on.)
    this.recover = st.slip > TRAFFIC.recoverSlip ? TRAFFIC.recoverTime : Math.max(0, this.recover - dt);
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
