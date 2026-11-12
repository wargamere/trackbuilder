import type { CarState } from '../car/physics.ts';
import { towStrength } from '../car/slipstream.ts';
import { CONTACT, TRAFFIC } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import { leftOf } from '../track/spline.ts';
import type { Track } from '../track/track.ts';
import type { Corridor, RacingDriver } from './driver.ts';
import { Racecraft, type RacecraftAction } from './racecraft.ts';

/**
 * Cars driven by AiDriver, and their difficulty (0..1). They keep to a lane
 * beside the racing line, so that's how to predict them; and a slower AI lets
 * a clearly quicker one by.
 */
export const aiCars = new WeakMap<CarState, number>();

/** Each AI car's planner (so a car letting another by can tell it which side to pass on). */
const planners = new WeakMap<CarState, TrafficPlanner>();

/** Signed distance along a loop of length `L` from `a` to `b`, in (-L/2, L/2]. */
export const along = (a: number, b: number, L: number): number => {
  let d = (b - a) % L;
  if (d > L / 2) d -= L;
  if (d <= -L / 2) d += L;
  return d;
};

/** How far across the road a car can move in `t` seconds, easing into the move (TRAFFIC.laneAccel) up to TRAFFIC.laneRate. */
export function laneReach(t: number): number {
  const a = TRAFFIC.laneAccel;
  const r = TRAFFIC.laneRate;
  const tr = r / a;
  return t < tr ? 0.5 * a * t * t : r * t - (r * r) / (2 * a);
}

/**
 * A nearby car as the planner sees it: along-track gap, lateral, offset from
 * the racing line, speed, sideways speed across the road (and against the
 * line: how fast it's drifting off the line), and whether it's an AI (which
 * holds its offset from the line) or not (the player: assumed to follow the
 * observed movement across the road, easing off over a second and staying
 * on the road rather than assuming it will follow the ideal line).
 */
interface Near {
  ds: number;
  lat: number;
  off: number;
  v: number;
  vlat: number;
  /** Sideways speed against the line's own sweep across the road there. */
  drift: number;
  ai: boolean;
  /** Its difficulty, for an AI. */
  pace: number | null;
  car: CarState;
}

/**
 * The lane the planner picked: an offset from the racing line (m, + = left).
 * With `pass`, it's getting past a car that isn't an AI (which won't keep to
 * a lane beside the line): the line, but never closer than the room for a car
 * to that car's `side` (+1: we go by on its left).
 */
export interface LaneChoice {
  offset: number;
  pass?: { car: CarState; side: number };
  /** A committed corner tactic, also used when predicting collisions and following gaps. */
  route?: (s: number) => number;
}

/**
 * Racing in traffic, in the track's own frame (distance along it, offset
 * across it). Some 30 times a second each AI looks at the lanes it could
 * drive (parallel to the racing line, from well left of it to well right)
 * and plays the next few seconds forward for itself and every car near it,
 * each along its speed plan (a lane off the line is slower through the
 * bends) and keeping its offset from the line. A lane that would turn it
 * into a car alongside is out. Otherwise a lane costs the time it would
 * lose: stuck behind a slower car it can't get past in it, held up a moment
 * before it's clear of one, and being off the line. It takes the cheapest,
 * and only switches for a clear gain, so it doesn't dither. Because every AI
 * does this, a car being passed won't turn in on the car passing it.
 *
 * And a help for overtaking: a slower AI that has had a clearly quicker one
 * close behind it for a while steps off the line to one side, lifts a
 * little and lets it by on the other (see letByTarget()).
 */
export class TrafficPlanner {
  private readonly racecraft: Racecraft;
  /** Race control and pit strategy suspend tactical moves. */
  tacticsEnabled = true;
  get action(): RacecraftAction { return this.defending ? 'defend-inside' : this.racecraft.action; }
  private readonly driver: RacingDriver;
  private readonly track: Track;
  private readonly L: number;
  private readonly near: Near[] = [];
  /** Current choice of lane. */
  choice: LaneChoice = { offset: 0 };
  /** Set by followSpeed(): the slowdown (m/s²) needed not to hit the car in our way. */
  brakeNeed = 0;
  /** Seconds left committed to the lane picked (a pass under way). */
  private committed = 0;
  /** Letting a quicker car by: how long it has been stuck behind us, how long we keep aside, and to which side. */
  private letByWait = 0;
  private letByFor = 0;
  private letBySide = 1;
  /** The field is under way (past the start, strung out): set by the driver. */
  started = false;
  /** The car we're letting by, and the lane we're keeping to meanwhile. */
  private letByCar: CarState | null = null;
  private letByLane = 0;

  /** Moving aside for a quicker car (and the move was safe). */
  get lettingBy(): boolean {
    return this.letByFor > 0 && this.aside;
  }
  private aside = false;
  /** Letting a quicker car by, and it's clear of us across the road (so we can lift without it running into us). */
  get liftForPass(): boolean {
    return this.lettingBy && this.passerClear && !this.inBend;
  }
  /** In, or right at, a tight bend (set by plan()). */
  inBend = false;
  /** Held up behind a slower car that isn't an AI: for how long (s), the push left (s) and the wait till the next. */
  private heldFor = 0;
  private pushFor = 0;
  private pushWait = 0;
  /**
   * Pushing to get past a slower car that isn't an AI (you), having been held
   * up behind it: the car gets a tow's worth of extra pace (TRAFFIC.pushTow)
   * for a few seconds, enough to draw alongside on a straight.
   */
  get pushing(): boolean {
    return this.pushFor > 0;
  }

  /** Another AI is close by (set by plan()). */
  crowded = false;
  /**
   * Fighting a car that isn't an AI (you) for a place into a bend: alongside,
   * or just behind and on the inside (set by plan()). It goes later on the
   * brakes then.
   */
  fighting = false;
  /**
   * Defending against a car that isn't an AI close behind: the side of the
   * road (+1 left) of the inside of the bend we're covering, 0 if not; where
   * that ends (the apex, m along the track), and the car.
   */
  private defendSide = 0;
  private defendEnd = 0;
  private defendCar: CarState | null = null;
  /** The lane (offset from the line) that covers it at the braking point. */
  private defendOffset = 0;
  /** Where the move began (m along), our offset from the line then, and the braking point (m along). */
  private defendFrom = 0;
  private defendOff0 = 0;
  private defendBrake = 0;
  /** The apex of the bend we last defended (one move per bend). */
  private defendedApex = NaN;


  /** Covering the inside of the bend coming up against you (it moves across a little quicker then). */
  get defending(): boolean {
    return this.defendSide !== 0;
  }
  /** Extra room across the road wanted in the bend we're in (m) (set by plan()). */
  private bendRoom = 0;

  private passerClear = false;
  /** The car beside us that every lane would squeeze into (set by cost()). */
  private squeezer: Near | null = null;
  /** Backing out of a side-by-side we can't win: for how much longer. */
  private yieldFor = 0;
  private yieldTo: CarState | null = null;

  /** Backing out of a side-by-side (dropping in a little slower than the car we give way to). */
  get yielding(): boolean {
    return this.yieldFor > 0;
  }

  /** This car's own difficulty (a slower AI lets a quicker one by). */
  private readonly pace: number;

  constructor(driver: RacingDriver, track: Track, pace = 1) {
    this.driver = driver;
    this.track = track;
    this.L = track.center.length;
    this.pace = pace;
    this.racecraft = new Racecraft(driver, this.L, pace);
  }

  /** Collects the cars near `me` (same level, from a little behind to well ahead). */
  private gather(me: CarState, cars: readonly CarState[]): void {
    this.near.length = 0;
    for (const o of cars) {
      if (o === me || Math.abs(o.y - me.y) > CONTACT.heightGap) continue;
      const ds = along(me.s, o.s, this.L);
      if (ds < -TRAFFIC.behind || ds > TRAFFIC.ahead) continue;
      this.near.push(this.toNear(o, ds));
    }
  }

  /** Car `o`, `ds` ahead of us along the track, as the planner sees it. */
  private toNear(o: CarState, ds: number): Near {
    const l = leftOf(this.track.center.tangents[Math.max(0, o.trackIndex)]);
    const v = Math.max(0, o.speed);
    const vlat = o.vx * l.x + o.vz * l.y;
    const sweep = ((this.driver.lateralAt(o.s + 1) - this.driver.lateralAt(o.s - 1)) / 2) * v;
    return { ds, lat: o.lateral, off: o.lateral - this.driver.lateralAt(o.s), v, vlat, drift: vlat - sweep, ai: aiCars.has(o), pace: aiCars.get(o) ?? null, car: o };
  }

  /** Going on as we mean to in lane `c` (from offset `off0` now), would we run into the back of car `o` soon? */
  private wouldHit(me: CarState, c: LaneChoice, off0: number, o: Near, reachS: number, reachL: number): boolean {
    return this.meet(me, c, off0, o, TRAFFIC.horizon, reachS, reachL).held > 0;
  }

  /** Where car `o` will be across the road `t` seconds ahead, at `s` along the track. */
  private theirLat(o: Near, s: number, t: number): number {
    if (o.ai) {
      const route = planners.get(o.car)?.choice.route;
      if (route) {
        const wanted = route(s), reach = laneReach(t);
        return clamp(wanted, o.lat - reach, o.lat + reach);
      }
      // It keeps its offset from the line, on the road; one already off the road stays where it is.
      const lat = this.driver.lateralAt(s, o.off);
      return o.lat > lat + 0.5 && o.lat > this.driver.lateralAt(s, 99) ? o.lat : o.lat < lat - 0.5 && o.lat < this.driver.lateralAt(s, -99) ? o.lat : lat;
    }
    // Predict the player's observed road-relative movement. Assuming that a player will
    // sweep back onto our ideal line invents collisions and makes us surrender an outside lane.
    const tau = TRAFFIC.driftEase;
    const observed = o.lat + o.vlat * tau * (1 - Math.exp(-t / tau));
    // Outside an established duel retain the long-horizon line-following forecast used
    // for approaching traffic; the committed rival is observed rather than assigned that line.
    const sNow = this.driver.lateralAt(s - o.v * t);
    const forecast = o.lat + (this.driver.lateralAt(s) - sNow) + o.drift * tau * (1 - Math.exp(-t / tau));
    const lat = this.racecraft.target === o.car ? observed : forecast;
    return Math.max(Math.min(o.lat, this.driver.lateralAt(s, -99)), Math.min(Math.max(o.lat, this.driver.lateralAt(s, 99)), lat));
  }

  /** My lateral `t` seconds ahead in lane `c`, at `s`, moving from `off0` (my offset now) at the lane-change rate. */
  private myLat(c: LaneChoice, s: number, off0: number, t: number): number {
    const r = laneReach(t);
    if (c.route) {
      const lat0 = this.driver.lateralAt(s, off0);
      return clamp(c.route(s), lat0 - r, lat0 + r);
    }
    const off = off0 + Math.max(-r, Math.min(r, c.offset - off0));
    const lat = this.driver.lateralAt(s, off);
    if (!c.pass) return lat;
    // Passing: kept clear of the car, as far over as we can get by then.
    const o = this.near.find((n) => n.car === c.pass!.car);
    if (!o) return lat;
    const bound = this.theirLat(o, s, t) + c.pass.side * this.passRoom();
    const want = c.pass.side > 0 ? Math.max(lat, bound) : Math.min(lat, bound);
    const lat0 = this.driver.lateralAt(s, off0);
    return Math.max(this.driver.lateralAt(s, -99), Math.min(this.driver.lateralAt(s, 99), Math.max(lat0 - r, Math.min(lat0 + r, want))));
  }

  /** Room across the road (m, centre to centre) to keep from a car we're passing that isn't an AI. */
  private passRoom(): number {
    return 2 * CONTACT.halfWidth + TRAFFIC.passGap + this.bendRoom;
  }

  /**
   * Room across the road (m, centre to centre) that counts as clear of car
   * `o` for drawing alongside it: its width and ours, `margin` × the margin,
   * and in a bend more (tails swing out), except passing in a let-by.
   */
  private sideRoom(me: CarState, o: { ai: boolean; car: CarState }, margin: number): number {
    return 2 * CONTACT.halfWidth + TRAFFIC.marginSide * margin + (o.ai && this.cooperating(me, o.car) ? 0 : this.bendRoom);
  }

  /**
   * Cost of lane `c` (seconds it would lose), or Infinity if it would turn us
   * into a car alongside. `v` is the speed we'd like (for the cars beside and
   * behind), `off0` our offset from the line now.
   */
  private cost(me: CarState, c: LaneChoice, v: number, off0: number, ignore: CarState | null = null): number {
    const dt = TRAFFIC.step;
    const reachS = 2 * CONTACT.halfLength + TRAFFIC.marginAlong;
    let cost = 0;
    // Off the line: the time its lane loses over the stretch ahead, against the line.
    // (A pass round a car that isn't an AI: wherever that puts us a moment from now.)
    const sOff = me.s + TRAFFIC.roomLook;
    const offset = c.pass || c.route ? this.myLat(c, sOff, off0, 1) - this.driver.lateralAt(sOff) : c.offset;
    if (Math.abs(offset) > 0.3) cost += this.driver.laneTimeLost(me.s, offset, TRAFFIC.laneLook);
    cost += TRAFFIC.offLineCost * Math.min(6, Math.abs(offset));
    // Play it forward.
    let worst = 0;
    for (const o of this.near) {
      if (o.car === ignore) continue;
      const reachL = this.sideRoom(me, o, 1);
      if (o.ds >= reachS) {
        worst = Math.max(worst, this.aheadCost(me, c, off0, o, reachS, reachL));
        continue;
      }
      // Beside us, or behind: never move closer to it while it's alongside (or about to be);
      // moving away, or keeping our distance, is fine (but being this close still counts
      // against a lane).
      const gapNow = Math.abs(me.lateral - o.lat);
      // You right behind us, in line: you're following, not alongside. Nothing to make room for
      // (moving aside would only be scared of you, and let you by).
      if (!o.ai && o.ds < 0 && gapNow < 2 * CONTACT.halfWidth) continue;
      // A car behind: judged against the speed we're really doing (not the one we'd like), and
      // drawing up on us faster if it's in our slipstream.
      const vMe = o.ds < 0 ? Math.max(0, me.speed) : v;
      const vO = o.ds < 0 ? o.v * (1 + TRAFFIC.towGain * towStrength(-o.ds - 2 * CONTACT.halfLength, gapNow, o.v)) : o.v;
      for (let t = 0; t <= TRAFFIC.sideTime + 1e-9; t += dt) {
        const ds = o.ds + (vO - vMe) * t;
        if (Math.abs(ds) >= reachS) continue;
        const sMe = me.s + vMe * t;
        const side = Math.abs(this.myLat(c, sMe, off0, t) - this.theirLat(o, sMe + ds, t));
        if (side >= reachL) continue;
        if (side < gapNow - 0.05) {
          if (!this.squeezer || Math.abs(o.ds) < Math.abs(this.squeezer.ds)) this.squeezer = o;
          return Infinity;
        }
        cost += TRAFFIC.closeCost;
        break;
      }
    }
    return cost + worst;
  }

  /**
   * Plays the next `horizon` seconds forward for us in lane `c` (from offset
   * `off0` now) and car `o` ahead, both along their speed plans: ours in that
   * lane (getting up to it from the speed we're doing), and it at the pace
   * it's going now against ours. We close on it until we're right behind; if
   * we aren't clear of it across the road by then, we're held at its pace
   * until we are. Says whether we reached it, for how long we'd be held,
   * whether we got alongside (clear of it), and whether we'd still be held at
   * the end or squeezed into it alongside.
   */
  private meet(me: CarState, c: LaneChoice, off0: number, o: Near, horizon: number, reachS: number, reachL: number) {
    const dt = TRAFFIC.step;
    // Its pace against ours on the line.
    const r = Math.min(1.5, o.v / Math.max(3, this.driver.speedAt(me.s + o.ds)));
    let sMe = me.s;
    let sO = me.s + o.ds;
    let vMe = Math.max(0, me.speed);
    const out = { r, reached: false, held: 0, alongside: false, stuck: false };
    for (let t = 0; t <= horizon + 1e-9; t += dt) {
      const vO = r * this.driver.speedAt(sO);
      if (sO - sMe < reachS) {
        out.reached = true;
        const clear = Math.abs(this.myLat(c, sMe, off0, t) - this.theirLat(o, sO, t)) >= reachL;
        if (!clear) {
          out.stuck = true;
          // Squeezed into it alongside: we'd have to back out.
          if (out.alongside) return out;
          out.held += dt;
          vMe = vO;
          sMe += vO * dt;
          sO += vO * dt;
          continue;
        }
        out.alongside = true;
      }
      out.stuck = false;
      // In its slipstream we'd go quicker than our plan (that's how a pass is set up).
      const lat = this.myLat(c, sMe, off0, t);
      const tow = towStrength(sO - sMe - 2 * CONTACT.halfLength, Math.abs(lat - this.theirLat(o, sO, t)), vMe);
      const laneNow = c.pass || c.route ? lat - this.driver.lateralAt(sMe) : c.offset;
      vMe = Math.min(this.driver.laneSpeedAt(sMe, laneNow) * (1 + TRAFFIC.towGain * Math.max(tow, this.pushing ? TRAFFIC.pushTow : 0)), vMe + TRAFFIC.pickUp * dt);
      sMe += vMe * dt;
      sO += vO * dt;
      if (sO - sMe < -reachS) break;
    }
    return out;
  }

  /**
   * What car `o` ahead costs lane `c` (see meet()): getting past it (or
   * alongside) in time costs the time held; not getting past it means being
   * stuck behind it for a good while (TRAFFIC.stuckFor), losing however much
   * slower it's going than we would; never reaching it costs nothing.
   */
  private aheadCost(me: CarState, c: LaneChoice, off0: number, o: Near, reachS: number, reachL: number): number {
    const m = this.meet(me, c, off0, o, TRAFFIC.passHorizon, reachS, reachL);
    if (!m.reached) return 0;
    const slower = Math.max(0, 1 - m.r);
    if (m.stuck || !m.alongside) return TRAFFIC.stuckFor * slower + TRAFFIC.closeCost;
    return m.held * slower + TRAFFIC.closeCost * (m.held > 0 ? 1 : 0.5);
  }

  /** Picks the lane for the next moment. `off0` is the offset from the line we are driving now. */
  plan(me: CarState, cars: readonly CarState[], off0: number): LaneChoice {
    planners.set(me, this);
    this.gather(me, cars);
    this.inBend = this.tightAhead(me.s);
    // (Only for another AI: with you it's not shy.)
    this.crowded = this.near.some((o) => o.ai && Math.abs(o.ds) < TRAFFIC.crowdAlong && Math.abs(o.lat - me.lateral) < TRAFFIC.crowdSide);
    let k = 0;
    for (let d = 0; d <= 20; d += 5) k = Math.max(k, Math.abs(this.driver.curvatureAt(me.s + d)));
    this.bendRoom = TRAFFIC.bendMargin * k;
    this.fighting = this.fight(me);
    if (!this.tacticsEnabled) { if (this.defending) this.stopDefending(me); this.racecraft.cancel(); }
    if (this.choice.route && !this.racecraft.active) this.choice = { offset: off0 };
    // A slower car letting us by keeps to one side: we pass on the other, clear of the lane it's keeping to.
    const pass = this.passing(me);
    const sPass = me.s + TRAFFIC.roomLook;
    const wrongSide = (c: LaneChoice) => {
      if (!pass) return 0;
      const apart = (this.driver.lateralAt(sPass, pass.lane) - this.driver.lateralAt(sPass, c.offset)) * pass.side;
      return apart < 2 * CONTACT.halfWidth + TRAFFIC.marginSide * 0.5 ? TRAFFIC.letByWrongSide : 0;
    };
    // Cars beside and behind are played forward at the speed we'd like to go (if a slower car
    // is holding us up, we want to see that we'd draw alongside it, not keep station).
    const v = Math.max(0, me.speed, this.driver.speedAt(me.s) * TRAFFIC.intent);
    // Lanes that would really move us (beside the line there isn't always room on both
    // sides), and keeping the offset we have (which keeps us parallel to a car alongside
    // that's doing the same).
    const ahead = me.s + TRAFFIC.roomLook;
    const effective = (o: number) => this.driver.lateralAt(ahead, o) - this.driver.lateralAt(ahead);
    const options: LaneChoice[] = TRAFFIC.lanes.filter((o) => Math.abs(effective(o) - effective(off0)) > 0.5).map((offset) => ({ offset }));
    options.push({ offset: off0 });
    // A slower car ahead that isn't an AI: go by it on either side, wherever it is on the road.
    // (No new pass in the middle of a tight bend.)
    const noPass = this.inBend && !this.choice.pass;
    const slow = noPass ? undefined : this.near.find((o) => !o.ai && o.ds > 0 && o.ds < TRAFFIC.passAhead && o.v < v);
    if (slow) {
      for (const side of [1, -1]) {
        const at = slow.lat + side * this.passRoom();
        const edge = this.driver.lateralAt(ahead, side * 99);
        if ((edge - at) * side >= 0) options.push({ offset: 0, pass: { car: slow.car, side } });
      }
    }
    // A pass is over once its car is behind us (or out of sight).
    if (this.choice.pass) {
      const o = this.near.find((n) => n.car === this.choice.pass!.car);
      if (!o || o.ds < -2 * CONTACT.halfLength) this.choice = { offset: off0 };
    }
    const keep: LaneChoice = this.choice.route ? { offset: off0 } : this.choice;
    this.squeezer = null;
    const keepCost = this.cost(me, keep, v, off0) + wrongSide(keep);
    // A clearly quicker AI close behind us for a while: move aside (if that's safe) and let it by.
    const letBy = this.letByTarget(me);
    this.aside = false;
    if (letBy !== null) {
      const aside: LaneChoice = { offset: letBy };
      if (this.cost(me, aside, v, off0) < Infinity) {
        this.aside = true;
        this.choice = aside;
        this.defendSide = 0;
        this.racecraft.cancel();
        return aside;
      }
    }
    // You close behind, a bend coming: cover the inside of it (if that doesn't squeeze anyone
    // else; you, behind, it's watching in defendLane()).
    const def = this.tacticsEnabled && !this.racecraft.active ? this.defendLane(me) : null;
    if (def !== null) {
      const c: LaneChoice = { offset: def };
      if (this.cost(me, c, v, off0, this.defendCar) < Infinity) {
        this.choice = c;
        return c;
      }
      this.defendSide = 0;
    }
    this.racecraft.plan(me, this.near, this.racecraft.active ? null : this.nextCorner(me.s), this.started, this.tacticsEnabled);
    if (this.racecraft.active) {
      const c: LaneChoice = { offset: off0, route: this.racecraft.path };
      // The duelling car is handled by the reserved corridor and followSpeed's hard
      // collision cap. Judge the manoeuvre against the other cars here: a predicted
      // return to the solo line must not veto an otherwise legal outside overlap.
      if (this.cost(me, c, v, off0, this.racecraft.target) < Infinity) {
        this.choice = c;
        // A legitimate outside overlap can contest the braking zone too. Only a
        // switchback deliberately gives up entry speed to concentrate on the exit.
        this.fighting = this.racecraft.action === 'attack-inside' || (this.racecraft.action === 'hold-outside' && this.fighting);
        return c;
      }
      this.racecraft.reject();
    }
    if (this.choice.route) this.choice = { offset: off0 };
    let best = keep;
    let bestCost = Infinity;
    for (const c of options) {
      const k = this.cost(me, c, v, off0) + wrongSide(c) + TRAFFIC.changeCost * Math.abs(c.offset - off0);
      if (k < bestCost) {
        best = c;
        bestCost = k;
      }
    }
    const sideSwap = (a: LaneChoice, b: LaneChoice) => !!a.pass && !!b.pass && a.pass.side !== b.pass.side;
    // Stick with a lane once picked: switch only for a clear gain, and while committed to a
    // pass only for a big one, unless the lane we're in has become unsafe.
    this.committed = Math.max(0, this.committed - TRAFFIC.planEvery);
    const needGain = this.committed > 0 ? TRAFFIC.commitGain : TRAFFIC.switchGain;
    if (keepCost !== Infinity && bestCost > keepCost - needGain) best = keep;
    // Side by side with no room for both (every lane closes in on the car beside us, e.g. the
    // road narrowing into a bend). Racing rules: a car more than half a length behind backs out;
    // overlapped more than that, the one on the inside of the bend coming up has earned its
    // place and the one round the outside backs out. Neither turns in on the other.
    const sq = this.squeezer as Near | null;
    if (bestCost === Infinity && sq) {
      best = { offset: off0 };
      if (this.mustYield(me, sq)) {
        this.yieldFor = TRAFFIC.yieldTime;
        this.yieldTo = sq.car;
      }
      this.choice = best;
      return best;
    }
    // No new moves out from the line in the middle of a tight bend (unless where we are has
    // become unsafe); back towards it is fine.
    if (keepCost !== Infinity && this.inBend && (Math.abs(best.offset) > Math.abs(keep.offset) - 0.5 || sideSwap(best, keep))) best = keep;
    // Nothing near and no reason to be off the line: back onto it.
    if (this.near.length === 0) best = { offset: 0 };
    // (Going by a car on its other side is a real change too.)
    const sideChange = !!best.pass !== !!keep.pass || (best.pass && keep.pass && best.pass.side !== keep.pass.side);
    if (best !== keep && (Math.abs(best.offset - keep.offset) > 1 || sideChange) && this.near.length) this.committed = TRAFFIC.commitTime;
    this.choice = best;
    return best;
  }

  /**
   * The fastest we should go for the traffic in our way: keep a gap of about a
   * car length plus a third of a second behind the nearest car ahead that
   * overlaps where we are going, and close it gently.
   */
  followSpeed(me: CarState, cars: readonly CarState[], lane: number, dt: number): number {
    const v = Math.max(0, me.speed);
    let cap = Infinity;
    this.brakeNeed = 0;
    // Backing out of a side-by-side: drop in a little slower than the car we're giving way to.
    // Not if it's dropped behind us, or has all but stopped (then we'd only both stand there).
    if (this.yieldFor > 0) {
      this.yieldFor -= dt;
      const to = this.yieldTo;
      if (to && (to.speed < TRAFFIC.yieldMinSpeed || along(me.s, to.s, this.L) < -CONTACT.halfLength)) this.yieldFor = 0;
      else if (to) cap = Math.min(cap, Math.max(0, to.speed) - TRAFFIC.yieldDrop);
    }
    // Room across the road it wants before drawing alongside: more in a tight bend, where the
    // cars swing their tails out, and in any real bend more the faster it's closing.
    const reachS = 2 * CONTACT.halfLength + TRAFFIC.marginAlong;
    let bend = 0;
    for (let d = 0; d <= 20; d += 5) bend = Math.max(bend, Math.abs(this.driver.curvatureAt(me.s + d)));
    const closingMargin = bend > TRAFFIC.closingBend ? TRAFFIC.closingMargin : 0;
    for (const o of cars) {
      if (o === me || Math.abs(o.y - me.y) > CONTACT.heightGap) continue;
      const ds = along(me.s, o.s, this.L);
      if (ds <= 0 || ds > TRAFFIC.ahead) continue;
      const gap = ds - 2 * CONTACT.halfLength;
      const human = !aiCars.has(o);
      const other = this.toNear(o, ds);
      let reachL = this.sideRoom(me, { ai: !human, car: o }, this.inBend ? 1 : 0.5) + Math.min(TRAFFIC.closingMarginMax, closingMargin * Math.max(0, v - Math.max(0, o.speed) - 2));
      // The car we're going by (you): clear of it once we've the room we keep from it (keepOut()
      // holds us there), or we'd never draw alongside.
      if (this.choice.pass && this.choice.pass.car === o) reachL = Math.min(reachL, this.passRoom() - TRAFFIC.passSlack);
      const overlapNow = Math.abs(o.lateral - me.lateral) < reachL;
      // Right in front of us as we are now: brake if we must, whatever the plan says.
      const closingNow = v - Math.max(0, o.speed);
      if (overlapNow && closingNow > 0) this.brakeNeed = Math.max(this.brakeNeed, (closingNow * closingNow) / (2 * Math.max(0.3, gap - 0.5)));
      if (human && ds < reachS && Math.abs(o.lateral - me.lateral) > CONTACT.halfWidth) {
        // A faster car can still hit our front wheel when it cuts across before clearing
        // the overlap. Longitudinal closing speed alone misses that collision entirely.
        const left = leftOf(this.track.center.tangents[Math.max(0, me.trackIndex)]);
        const mySideways = me.vx * left.x + me.vz * left.y;
        const across = -(other.vlat - mySideways) * Math.sign(o.lateral - me.lateral);
        if (across > TRAFFIC.cutAcrossSpeed) {
          const until = Math.max(TRAFFIC.cutAcrossMinTime, (Math.abs(o.lateral - me.lateral) - 2 * CONTACT.halfWidth - TRAFFIC.keepGapHuman) / across);
          if (until < TRAFFIC.cutAcrossLook) cap = Math.min(cap, Math.max(0, o.speed) - (reachS - ds) / until);
        }
      }
      // In our way: we'd reach it before we're clear of it across the road (pulling out to
      // pass, we don't hold back for it).
      const inWay = (gap < 2 && overlapNow) || this.wouldHit(me, this.choice, lane, other, reachS, reachL);
      if (!inWay) continue;
      // (Right up behind you, in your tow, ready to pounce; further back behind another AI.)
      const want = TRAFFIC.gapBase + (human ? TRAFFIC.gapTimeHuman : TRAFFIC.gapTime) * v;
      cap = Math.min(cap, Math.max(0, o.speed) + (gap - want) * TRAFFIC.gapGain);
    }
    // Held up behind a slower car that isn't an AI: after a while, push to get by.
    const slowAhead = this.near.some((o) => !o.ai && o.ds > 0 && o.ds < TRAFFIC.pushWithin && o.v < this.driver.speedAt(me.s + o.ds));
    const held = slowAhead && v < this.driver.speedAt(me.s) * TRAFFIC.pushBelow;
    this.heldFor = held ? this.heldFor + dt : Math.max(0, this.heldFor - dt);
    this.pushWait = Math.max(0, this.pushWait - dt);
    if (this.pushFor > 0) {
      this.pushFor -= dt;
      // Over when its time is up, or there's no such car near ahead or beside any more (we're by).
      const still = this.near.some((o) => !o.ai && o.ds > -2 * CONTACT.halfLength && o.ds < TRAFFIC.pushWithin);
      if (this.pushFor <= 0 || !still) {
        this.pushFor = 0;
        this.pushWait = TRAFFIC.pushRest;
      }
    } else if (this.heldFor > TRAFFIC.pushAfter && this.pushWait <= 0) {
      this.pushFor = TRAFFIC.pushTime;
      this.heldFor = 0;
    }
    return Math.max(0, cap);
  }

  /**
   * The stretch across the road to keep within for the cars beside us: never
   * closer to one alongside (or just ahead, or with its nose up beside us) than a
   * car's width and TRAFFIC.keepGap (or than we are now, if already closer),
   * however the line goes. A car on the inside of a bend has its room; we
   * don't turn in on it. Null if no car is beside us.
   */
  keepOut(me: CarState, cars: readonly CarState[]): Corridor | null {
    let lo = -Infinity;
    let hi = Infinity;
    const room = 2 * CONTACT.halfWidth + TRAFFIC.keepGap + this.bendRoom;
    // You get a car's width and a little: hard, but fair.
    const roomHuman = 2 * CONTACT.halfWidth + TRAFFIC.keepGapHuman + this.bendRoom;
    const reach = 2 * CONTACT.halfLength + TRAFFIC.keepReach;
    for (const o of cars) {
      if (o === me || Math.abs(o.y - me.y) > CONTACT.heightGap) continue;
      const ds = along(me.s, o.s, this.L);
      const side = o.lateral - me.lateral;
      // A car behind gets its room once its nose is well up alongside us (past our rear
      // wheels), or about to be (closing fast: diving down the inside); before that, the line
      // is ours.
      const behindReach = TRAFFIC.keepBehind + Math.max(0, o.speed - me.speed) * TRAFFIC.keepClosing;
      if (ds > reach || ds < -behindReach) continue;
      // Right in line, nose to tail: that's for following, not for room beside.
      if (Math.abs(side) < CONTACT.halfWidth) continue;
      const r = aiCars.has(o) ? room : roomHuman;
      if (side > 0) hi = Math.min(hi, Math.max(o.lateral - r, me.lateral));
      else lo = Math.max(lo, Math.min(o.lateral + r, me.lateral));
    }
    // Passing a car that isn't an AI: stay on our side of it, with room.
    const pass = this.choice.pass;
    if (pass) {
      const ds = along(me.s, pass.car.s, this.L);
      if (ds > -2 * CONTACT.halfLength && ds < TRAFFIC.passClose) {
        const bound = pass.car.lateral + pass.side * this.passRoom();
        if (pass.side > 0) lo = Math.max(lo, Math.min(bound, me.lateral + TRAFFIC.passStep));
        else hi = Math.min(hi, Math.max(bound, me.lateral - TRAFFIC.passStep));
      }
    }
    if (lo === -Infinity && hi === Infinity) return null;
    // Squeezed between two: the middle of the gap.
    if (lo > hi) lo = hi = (lo + hi) / 2;
    return { lo, hi };
  }

  /**
   * The next bend that the line really slows for (by TRAFFIC.cornerDrop m/s,
   * within TRAFFIC.defendLook m of `s`): how far ahead its braking starts
   * (0 if already braking for it) and its slowest point (the apex), and which
   * side its inside is on (+1 left). Null if none.
   */
  private nextCorner(s: number): { brake: number; apex: number; side: number } | null {
    const T = TRAFFIC;
    const step = 5;
    let top = this.driver.speedAt(s);
    let brake = 0;
    let prev = top;
    let found = false;
    let apex = -1;
    for (let d = step; d <= T.defendLook; d += step) {
      const v = this.driver.speedAt(s + d);
      if (!found) {
        if (v >= top) {
          top = v;
          brake = d;
        } else if (top - v >= T.cornerDrop) found = true;
      } else if (v > prev + 0.01) {
        apex = d - step;
        break;
      }
      prev = v;
    }
    if (!found) return null;
    if (apex < 0) apex = T.defendLook;
    // Its inside: the way the tightest part of it turns.
    let k = 0;
    for (let d = Math.max(0, apex - 25); d <= apex + 10; d += 5) {
      const c = this.driver.curvatureAt(s + d);
      if (Math.abs(c) > Math.abs(k)) k = c;
    }
    if (k === 0) return null;
    // + curvature is a right-hander: its inside is on the right.
    return { brake, apex, side: k < 0 ? 1 : -1 };
  }

  /**
   * Defending against a car that isn't an AI (you) close behind: the lane
   * that covers the inside of the bend coming up (as far to that side as
   * there's room), or null. One move, made before the braking point once
   * you're close enough to try one; then held to the apex (no weaving), unless
   * you drop well back or get by. Not if you're already alongside on that
   * side (plan() checks the move doesn't squeeze you).
   */
  private defendLane(me: CarState): number | null {
    const T = TRAFFIC;
    if (this.defendSide !== 0) {
      const o = this.near.find((n) => n.car === this.defendCar);
      // Over once we're back on the line past the apex, or once you've dropped well back or
      // got by; and if you've got your nose up alongside on the inside before we're across,
      // it's your line (keepOut()).
      const overlap = o && o.ds > -(T.keepBehind + Math.max(0, o.v - me.speed) * T.keepClosing) && (o.lat - me.lateral) * this.defendSide > CONTACT.halfWidth;
      if (along(me.s, this.defendEnd + T.defendPast, this.L) < 0 || !o || o.ds < -T.defendDrop || o.ds > CONTACT.halfLength || overlap) {
        this.stopDefending(me);
        return null;
      }
      return this.defendOffset;
    }
    // The nearest car behind that isn't an AI, and how close it is (bumper to bumper).
    let atk: Near | null = null;
    for (const o of this.near) if (!o.ai && o.ds < 0 && (!atk || o.ds > atk.ds)) atk = o;
    if (!atk) return null;
    const gap = -atk.ds - 2 * CONTACT.halfLength;
    if (gap > T.defendWithin) return null;
    const bend = this.nextCorner(me.s);
    if (!bend) return null;
    // An inside overlap already earned is not an invitation to make a reactive block.
    const overlapReach = T.keepBehind + Math.max(0, atk.v - me.speed) * T.keepClosing;
    if (atk.ds > -overlapReach && (atk.lat - me.lateral) * bend.side > CONTACT.halfWidth) return null;
    const apexS = me.s + bend.apex;
    if (!isNaN(this.defendedApex) && Math.abs(along(this.defendedApex, apexS, this.L)) < 40) return null;
    // Before the braking point (not under braking), but not long before it (at the speed we'll
    // be doing on the way there).
    const sB = me.s + bend.brake;
    const t = bend.brake / Math.max(5, (Math.max(0, me.speed) + this.driver.speedAt(sB)) / 2);
    if (t < T.defendLatest || t > T.defendLead) return null;
    // Close enough by then to try a move (sooner if you're already pulling out to the inside).
    const pulling = (atk.lat - me.lateral) * bend.side > CONTACT.halfWidth;
    if (gap - Math.max(0, atk.v - me.speed) * t > T.defendGap * (pulling ? T.defendPulling : 1)) return null;
    // The lane that has us on the inside at the braking point (as far over as there's room):
    // not needed if the line is already there (no room left for a car down the inside).
    const offset = this.driver.lateralAt(sB, bend.side * 99) - this.driver.lateralAt(sB);
    if (Math.abs(offset) < T.defendMin) return null;
    // Only a move it can make in time, smoothly (half a move only loses time: the smoothest
    // way across in time t has a peak sideways pull of 6 × across / t²), on a straight run to the
    // braking point with the car settled (not out of the bend before, or in twisty stuff, where
    // one bend runs into the next and the line covers itself).
    // (The line's own sweep across the road comes free: it's the move off it that takes time.)
    const across = Math.abs(offset - (me.lateral - this.driver.lateralAt(me.s)));
    let k = 0;
    for (let d = 0; d <= bend.brake; d += 5) k = Math.max(k, Math.abs(this.driver.curvatureAt(me.s + d)));
    if (this.inBend || k > T.defendStraight || me.slip > T.defendSlip || 6 * across > T.defendAccel * t * t) return null;
    // And only where it's worth it: a bend you'd brake hard into (the inside of a faster one is
    // a slower way round, and passes there on the brakes are rare), or any bend you're already
    // pulling out to go down the inside of (it sees the move coming).
    const slow = this.driver.speedAt(me.s + bend.apex) <= this.driver.speedAt(sB) * T.defendSlow;
    if (!slow && !pulling) return null;
    this.defendSide = bend.side;
    this.defendEnd = apexS;
    this.defendCar = atk.car;
    this.defendedApex = apexS;
    this.defendOffset = offset;
    this.defendFrom = me.s;
    this.defendOff0 = me.lateral - this.driver.lateralAt(me.s);
    this.defendBrake = sB;
    return offset;
  }

  /** Done covering the inside: carry on from where we are (plan() takes it from there). */
  private stopDefending(me: CarState): void {
    this.defendSide = 0;
    this.choice = { offset: me.lateral - this.driver.lateralAt(me.s) };
  }

  /**
   * The path covering the inside (m left of the centre, at s), or null if
   * not defending: easing from where we were onto the inside of the bend by
   * the braking point (as far over as there's room, less TRAFFIC.coverGap),
   * along it to the apex, and back onto the line over TRAFFIC.defendPast m.
   * Smooth all the way, so it's no slower than it must be.
   */
  coverPath(): ((s: number) => number) | null {
    if (this.racecraft.active) return this.racecraft.path;
    if (this.defendSide === 0) return null;
    const T = TRAFFIC;
    const L = this.L;
    const side = this.defendSide;
    const from = this.defendFrom;
    const toBrake = Math.max(1, along(from, this.defendBrake, L));
    const toApex = along(from, this.defendEnd, L);
    const smooth = (u: number) => {
      const x = clamp(u, 0, 1);
      return x * x * (3 - 2 * x);
    };
    const off0 = this.defendOff0;
    return (s: number) => {
      const a = along(from, s, L);
      const line = this.driver.lateralAt(s);
      let u = smooth(a / toBrake);
      if (a > toApex) u *= 1 - smooth((a - toApex) / T.defendPast);
      const inside = Math.max(0, (this.driver.lateralAt(s, side * 99) - side * T.coverGap - line) * side);
      return line + off0 * (1 - smooth(a / toBrake)) + side * inside * u;
    };
  }

  /**
   * Fighting a car that isn't an AI (you) for a place: alongside it, or with
   * it just ahead and us on the inside of the bend coming up, clear of it
   * across the road (not right behind it, where braking late would only run
   * into it).
   */
  private fight(me: CarState): boolean {
    const T = TRAFFIC;
    const clear = 2 * CONTACT.halfWidth + T.fightSide;
    let bend: { side: number } | null | undefined;
    for (const o of this.near) {
      if (o.ai || o.ds < -2 * CONTACT.halfLength || o.ds > T.fightAhead) continue;
      const side = me.lateral - o.lat;
      if (Math.abs(side) < clear) continue;
      if (o.ds < 2 * CONTACT.halfLength) return true;
      if (bend === undefined) bend = this.nextCorner(me.s);
      if (bend && side * bend.side > 0) return true;
    }
    return false;
  }

  /**
   * Letting a quicker AI by: once one that's clearly quicker (by
   * TRAFFIC.letByPace) has been close behind us for a while, we keep to one
   * side (away from it, or to the side with more room) and ease off until
   * it's by, or it drops back, or a few seconds have gone. Returns that lane,
   * or null.
   */
  private letByTarget(me: CarState): number | null {
    const T = TRAFFIC;
    const quicker = (o: Near) => o.ai && o.pace !== null && o.pace > this.pace + T.letByPace;
    let behind: Near | null = null;
    for (const o of this.near) if (quicker(o) && o.ds < -1 && o.ds > -T.letByGap && (!behind || o.ds > behind.ds)) behind = o;
    if (this.letByFor > 0 && this.letByCar) {
      this.letByFor -= T.planEvery;
      // Done once it's a car length ahead of us, or has dropped well back.
      const ds = along(me.s, this.letByCar.s, this.L);
      if (ds > 2 * CONTACT.halfLength || ds < -2 * T.letByGap) this.letByFor = 0;
      this.passerClear = Math.abs(this.letByCar.lateral - me.lateral) > 2 * CONTACT.halfWidth + TRAFFIC.marginSide * 0.5;
    } else {
      // Not off the grid (everyone's bunched up then and sorts itself out), and not while we're
      // queued behind someone ourselves (then it's for the car at the front of the queue).
      // (Or while someone is letting us by.)
      const queued = this.near.some((o) => o.ds > 0 && o.ds < T.letByGap) || this.passing(me) !== null;
      this.letByWait = behind && this.started && !queued ? this.letByWait + T.planEvery : Math.max(0, this.letByWait - 2 * T.planEvery);
      if (behind && this.letByWait > T.letByAfter) {
        this.letByWait = 0;
        this.letByFor = T.letByHold;
        this.letByCar = behind.car;
        // Off the line to the side with more room over the stretch ahead (leaving it the line
        // to pass on), or the other side of the line from it if it's already well to one side.
        let left = 0;
        let right = 0;
        for (let d = 0; d <= 40; d += 10) {
          const line = this.driver.lateralAt(me.s + d);
          left += this.driver.lateralAt(me.s + d, 99) - line;
          right += line - this.driver.lateralAt(me.s + d, -99);
        }
        const side = Math.abs(behind.off) > 1.5 ? -Math.sign(behind.off) : left >= right ? 1 : -1;
        this.letBySide = (side > 0 ? left : right) >= 10 ? side : -side;
        this.letByLane = this.letBySide * T.letByOffset;
      }
    }
    return this.letByFor > 0 ? this.letByLane : null;
  }

  /** The side of the road (+1 left) a car letting us by is keeping to, and its lane, or null. */
  private passing(me: CarState): { side: number; lane: number } | null {
    for (const o of this.near) {
      const p = planners.get(o.car);
      if (p && p.lettingBy && p.letByCar === me) return { side: p.letBySide, lane: p.letByLane };
    }
    return null;
  }

  /** Car `o` and we are in a let-by (one moving over for the other), so we can pass closer. */
  private cooperating(me: CarState, o: CarState): boolean {
    if (this.lettingBy && this.letByCar === o) return true;
    const p = planners.get(o);
    return !!p && p.lettingBy && p.letByCar === me;
  }

  /** Squeezed side by side with car `o`: is it us that should back out (see plan())? */
  private mustYield(me: CarState, o: Near): boolean {
    // In a let-by, the car letting the other through gives way, wherever they are.
    if (this.cooperating(me, o.car)) return this.lettingBy;
    if (o.ds > CONTACT.halfLength) return true;
    if (o.ds < -CONTACT.halfLength) return false;
    // Overlapped: the one on the inside of the next bend keeps its place.
    const dir = this.bendAhead(me.s);
    if (dir === 0) return o.ds > TRAFFIC.yieldLead;
    return (me.lateral - o.lat) * dir < 0;
  }

  /** Which side the inside of the next real bend is on (within TRAFFIC.insideLook m): +1 left, -1 right, 0 none. */
  private bendAhead(s: number): number {
    let k = 0;
    for (let d = 0; d <= TRAFFIC.insideLook; d += 5) {
      const c = this.driver.curvatureAt(s + d);
      if (Math.abs(c) > Math.abs(k)) k = c;
    }
    // + curvature is a right-hander: its inside is on the right.
    return Math.abs(k) < 1 / 400 ? 0 : k < 0 ? 1 : -1;
  }

  /** Are we in, or right at, a tight bend? */
  private tightAhead(s: number): boolean {
    for (let d = 0; d <= TRAFFIC.tightLook; d += 5) if (Math.abs(this.driver.curvatureAt(s + d)) > TRAFFIC.tightBend) return true;
    return false;
  }

  /** Is a car coming up behind within a few seconds (so it's not safe to rejoin the road)? */
  carComing(me: CarState, cars: readonly CarState[]): boolean {
    for (const o of cars) {
      if (o === me || Math.abs(o.y - me.y) > CONTACT.heightGap) continue;
      const ds = along(me.s, o.s, this.L);
      if (ds < 0 && ds > -TRAFFIC.rejoinClear && o.speed > 3) return true;
    }
    return false;
  }
}
