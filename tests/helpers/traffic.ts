import { collideCars } from '../../src/car/contact.ts';
import { carriedTow, slipstream } from '../../src/car/slipstream.ts';
import { CarPhysics, NO_INPUT, type CarState } from '../../src/car/physics.ts';
import { HANDLING } from '../../src/config/handling.ts';
import { DAMAGE } from '../../src/config/race.ts';
import { AiDriver, aiPace, gridPlace } from '../../src/race/ai.ts';
import { aiCars } from '../../src/race/traffic.ts';
import { RacingDriver } from '../../src/race/driver.ts';
import { botInput } from '../../src/race/bot.ts';
import { RaceSession, type Progress, type RaceEvent } from '../../src/race/session.ts';
import type { Track } from '../../src/track/track.ts';

/**
 * A car in a test race: an AI at a difficulty; the simple centre-line bot (a
 * stand-in for a player who doesn't avoid anyone); a `player` on the racing
 * line at a pace, who looks out for no one either; or a `human`: a player who
 * races cleanly (an AI driver, but one the AI cars see as you).
 */
export type CarSpec = { kind: 'ai'; difficulty: number } | { kind: 'bot'; aggression: number } | { kind: 'player'; difficulty: number } | { kind: 'human'; difficulty: number };

export interface TrafficResult {
  /** Contacts closing faster than 2 m/s (one per incident, not per tick), and how many involved an AI hitting the bot. */
  firm: number;
  /** Seconds (summed over cars) with the whole car past the track edge. */
  offTrack: number;
  /** Times an AI put itself back on the road. */
  resets: number;
  /** Changes of position between consecutive cars (counted each time one gets ahead of another along the race). */
  overtakes: number;
  /** Finishing order (indices into the specs), and each car's finishing session time (or NaN). */
  order: number[];
  ends: number[];
  /** Firm contacts by kind: rear-end (one car into the back of another) or side by side; and in a bend or not. */
  kinds: { rear: number; side: number; bend: number; withBot: number; hard: number };
  /** Car-seconds spent sliding sideways faster than 3 m/s (out of control). */
  sliding: number;
  /** Each car's best lap, laps, seconds off the track, and firm contacts it was in. */
  best: number[];
  laps: number[][];
  offBy: number[];
  hitsBy: number[];
}

/**
 * Runs a race of `specs` (in grid order, pole first) the way the race screen
 * does: drive, step, contact (three passes, with damage where it's on), lap
 * counting; a car that breaks down retires, stands where it stopped for
 * DAMAGE.recoverAfter s and is then taken off the track; and once a car has
 * finished, the chequered flag is out for the rest (`flag`).
 */
export function race(
  track: Track,
  specs: CarSpec[],
  laps: number,
  maxSeconds = 600,
  drafting = true,
  log: string[] | null = null,
  onHard: ((tick: number, i: number, j: number, hit: number) => void) | null = null,
  onTick: ((tick: number, cars: { car: CarPhysics; ai: AiDriver | null; session: RaceSession; human: boolean }[]) => void) | null = null,
  flag = false,
  /** Race conditions for the AI cars (and their pit crews): tyre wear, damage. */
  conditions: { tyreWear?: boolean; damage?: boolean; mediumLife?: number } = {},
): TrafficResult {
  const L = track.center.length;
  type Car = { car: CarPhysics; session: RaceSession; ai: AiDriver | null; aggression: number; line?: RacingDriver | null; human: boolean };
  const cars: Car[] = specs.map((sp, k) => {
    if (sp.kind === 'ai' || sp.kind === 'human') {
      const ai = new AiDriver(track, { name: `ai${k}`, paint: 0, difficulty: sp.difficulty, laps, slot: k, ...conditions });
      // A clean-racing player: driven like an AI, but the AI cars see it as you.
      if (sp.kind === 'human') aiCars.delete(ai.car.state);
      return { car: ai.car, session: ai.session, ai, aggression: 0, line: null, human: sp.kind === 'human' };
    }
    const car = new CarPhysics(track);
    const g = gridPlace(track, k);
    car.placeAt(g.s, g.lateral);
    // A "player": the bot (centre line), or a slow driver on the racing line; neither looks out for anyone.
    const line = sp.kind === 'player' ? new RacingDriver(track, aiPace(sp.difficulty, track)) : null;
    return { car, session: new RaceSession(L, null, laps, track.center.width), ai: null, aggression: sp.kind === 'bot' ? sp.aggression : 0, line, human: false };
  });
  const states: CarState[] = cars.map((c) => c.car.state);
  const drafts = new Float32Array(cars.length);
  // The cars on the track (indices into `cars`, and their states): all of them until one retires and is taken away.
  let live = cars.map((_, k) => k);
  let liveStates = states;
  const outFor = cars.map(() => 0);
  const gone = cars.map(() => false);
  const progress = (c: CarPhysics): Progress => {
    const st = c.state;
    const t = track.center.tangents[Math.max(0, st.trackIndex)];
    return { s: st.s, lateral: st.lateral, along: st.vx * t.x + st.vz * t.y, offTrack: st.offTrack };
  };
  const events: RaceEvent[] = [];
  const touching = new Set<string>();
  let firm = 0;
  let offTicks = 0;
  let resets = 0;
  let overtakes = 0;
  let lastOrder: number[] | null = null;
  const offBy = specs.map(() => 0);
  const kinds = { rear: 0, side: 0, bend: 0, withBot: 0, hard: 0 };
  let slideTicks = 0;
  const hitsBy = specs.map(() => 0);
  const dt = 1 / HANDLING.tickRate;
  for (let tick = 0; tick < maxSeconds * HANDLING.tickRate; tick++) {
    const prev = cars.map((c) => progress(c.car));
    if (drafting) {
      slipstream(liveStates, L, drafts);
      live.forEach((k, i) => (cars[k].car.draft = carriedTow(cars[k].car.draft, drafts[i], dt)));
    }
    for (const k of live) {
      const c = cars[k];
      if (c.ai) {
        const x0 = c.car.state.x;
        const z0 = c.car.state.z;
        c.car.step(c.ai.drive(liveStates, dt));
        if (Math.hypot(c.car.state.x - x0, c.car.state.z - z0) > 3) resets++;
      } else {
        const go = c.session.canDrive && c.session.phase !== 'finished';
        c.car.step(!go ? NO_INPUT : c.line ? c.line.drive(c.car.state) : botInput(c.car.state, track, c.aggression));
      }
    }
    const now = new Set<string>();
    for (let pass = 0; pass < 3; pass++) {
      for (let a = 0; a < live.length; a++) {
        for (let b = a + 1; b < live.length; b++) {
          const i = live[a];
          const j = live[b];
          const hit = collideCars(states[i], states[j]);
          if (hit > 0) now.add(`${i}-${j}`);
          if (pass === 0 && hit > 0) {
            cars[i].car.addDamage(hit);
            cars[j].car.addDamage(hit);
          }
          if (pass === 0 && hit > 2 && !touching.has(`${i}-${j}`)) {
            firm++;
            {
              const a = states[i];
              const b = states[j];
              const ds = Math.abs((((b.s - a.s) % L) + L * 1.5) % L - L / 2);
              if (ds > 3.2) kinds.rear++;
              else kinds.side++;
              if (Math.abs(track.center.curvature[Math.max(0, a.trackIndex)]) > 1 / 60) kinds.bend++;
              if (!cars[i].ai || !cars[j].ai || cars[i].human || cars[j].human) kinds.withBot++;
              if (hit > 4) {
                kinds.hard++;
                onHard?.(tick, i, j, hit);
              }
            }
            if (log) {
              const a = states[i];
              const b = states[j];
              const ch = (k: number) => {
                const ai = cars[k].ai as unknown as { planner: { choice: { offset: number } }; lane: number } | null;
                return ai ? `${ai.planner.choice.offset}/${ai.lane.toFixed(1)}` : 'bot';
              };
              const ds = (((b.s - a.s) % L) + L * 1.5) % L - L / 2;
              const yi = (k: number) => {
                const ai = cars[k].ai as unknown as { planner: { yieldFor: number } } | null;
                return ai && ai.planner.yieldFor > 0 ? 'Y' : '';
              };
              const li = Math.max(0, a.trackIndex);
              const line = (cars[i].ai ?? cars[j].ai) as unknown as { driver: { lateralAt(s: number, l?: number): number } } | null;
              const corr = line ? `line ${line.driver.lateralAt(a.s).toFixed(1)} [${line.driver.lateralAt(a.s, -99).toFixed(1)},${line.driver.lateralAt(a.s, 99).toFixed(1)}]` : '';
              log.push(`t=${(tick / 120).toFixed(1)} ${i}${yi(i)}(${ch(i)} v${a.speed.toFixed(0)} lat${a.lateral.toFixed(1)} h${a.heading.toFixed(2)}) ${j}${yi(j)}(${ch(j)} v${b.speed.toFixed(0)} lat${b.lateral.toFixed(1)} h${b.heading.toFixed(2)}) ds=${ds.toFixed(1)} hit=${hit.toFixed(1)} s=${a.s.toFixed(0)} k=${track.center.curvature[li].toFixed(3)} ${corr}`);
            }
            hitsBy[i]++;
            hitsBy[j]++;
          }
        }
      }
    }
    touching.clear();
    for (const k of now) touching.add(k);
    cars.forEach((c, k) => {
      if (gone[k]) return;
      c.session.step(prev[k], progress(c.car), events);
      if (c.car.state.slip > 3 && c.session.phase === 'racing') slideTicks++;
      if (c.car.state.offTrack && c.session.phase === 'racing') {
        offTicks++;
        offBy[k] += 1 / HANDLING.tickRate;
      }
    });
    // Overtakes: order by race distance, every half second.
    if (tick % 60 === 0 && cars.every((c) => c.session.canDrive)) {
      const order = cars
        .map((c, k) => ({ k, d: c.session.phase === 'finished' ? 1e9 - (c.session.runEnd ?? 0) : c.session.raceDistance(c.car.state.s) }))
        .sort((a, b) => b.d - a.d)
        .map((x) => x.k);
      if (lastOrder) {
        const before = new Map(lastOrder.map((k, i) => [k, i]));
        for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) if ((before.get(order[i]) ?? 0) > (before.get(order[j]) ?? 0)) overtakes++;
      }
      lastOrder = order;
    }
    // Breakdowns: retired where it stops, and taken off the track a while after.
    let changed = false;
    cars.forEach((c, k) => {
      if (gone[k]) return;
      if (c.car.broken && c.session.phase === 'racing') c.session.retire(c.car.state.s);
      if (!c.session.retired) return;
      outFor[k] += Math.abs(c.car.state.speed) < 1 ? dt : dt / 4;
      if (outFor[k] >= DAMAGE.recoverAfter) {
        gone[k] = true;
        changed = true;
      }
    });
    if (changed) {
      live = live.filter((k) => !gone[k]);
      liveStates = live.map((k) => states[k]);
    }
    // The chequered flag: once anyone has finished, the rest finish at the end of their lap.
    if (flag && cars.some((c) => c.session.phase === 'finished' && !c.session.retired)) for (const c of cars) c.session.flagged = true;
    onTick?.(tick, cars);
    if (cars.every((c) => c.session.phase === 'finished')) break;
  }
  const ends = cars.map((c) => c.session.runEnd ?? NaN);
  const order = cars
    .map((c, k) => ({ k, e: ends[k], d: c.session.raceDistance(c.car.state.s) }))
    .sort((a, b) => (isNaN(a.e) && isNaN(b.e) ? b.d - a.d : isNaN(a.e) ? 1 : isNaN(b.e) ? -1 : a.e - b.e))
    .map((x) => x.k);
  return {
    firm,
    offTrack: offTicks / HANDLING.tickRate,
    resets,
    overtakes,
    order,
    ends,
    best: cars.map((c) => (c.session.laps.length ? Math.min(...c.session.laps) : NaN)),
    laps: cars.map((c) => [...c.session.laps]),
    offBy,
    hitsBy,
    kinds,
    sliding: slideTicks / HANDLING.tickRate,
  };
}

/** Kendall's tau between the finishing order and the expected one (1 = same order, -1 = reversed). */
export function orderAgreement(order: number[], expected: number[]): number {
  const pos = new Map(order.map((k, i) => [k, i]));
  let agree = 0;
  let total = 0;
  for (let i = 0; i < expected.length; i++) {
    for (let j = i + 1; j < expected.length; j++) {
      total++;
      if ((pos.get(expected[i]) ?? 0) < (pos.get(expected[j]) ?? 0)) agree++;
    }
  }
  return total ? (2 * agree) / total - 1 : 1;
}

/** Puts `car` on `driver`'s line at `s`, moving along it at the line's speed there (turning as it does). */
export function rolling(car: CarPhysics, driver: RacingDriver, s: number, lane = 0): void {
  car.placeAt(s, driver.lateralAt(s, lane));
  const v = driver.speedAt(s);
  const a = driver.pointAt(s - 1, lane);
  const b = driver.pointAt(s + 1, lane);
  const c = driver.pointAt(s + 3, lane);
  const heading = Math.atan2(b.z - a.z, b.x - a.x);
  let turn = Math.atan2(c.z - b.z, c.x - b.x) - heading;
  while (turn > Math.PI) turn -= 2 * Math.PI;
  while (turn < -Math.PI) turn += 2 * Math.PI;
  Object.assign(car.state, { heading, vx: Math.cos(heading) * v, vz: Math.sin(heading) * v, speed: v, yawRate: (turn / 2) * v });
  car.prev.copyFrom(car.state);
}

/** The bends the line brakes for (by 6 m/s or more): where the braking starts and the slowest point (m along). */
export function brakingBends(track: Track, driver: RacingDriver): { brake: number; apex: number }[] {
  const L = track.center.length;
  const out: { brake: number; apex: number }[] = [];
  const step = 5;
  for (let s = 0; s < L; s += step) {
    const v = driver.speedAt(s);
    if (v <= driver.speedAt(s - step) && v < driver.speedAt(s + step)) {
      let b = s;
      while (driver.speedAt(b - step) > driver.speedAt(b) + 0.01 && s - b < 300) b -= step;
      if (driver.speedAt(b) - v >= 6) out.push({ brake: b, apex: s });
    }
  }
  return out;
}
