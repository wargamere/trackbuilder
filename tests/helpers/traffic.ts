import { collideCars } from '../../src/car/contact.ts';
import { carriedTow, slipstream } from '../../src/car/slipstream.ts';
import { CarPhysics, NO_INPUT, type CarState } from '../../src/car/physics.ts';
import { HANDLING } from '../../src/config/handling.ts';
import { AiDriver, gridPlace } from '../../src/race/ai.ts';
import { botInput } from '../../src/race/bot.ts';
import { RaceSession, type Progress, type RaceEvent } from '../../src/race/session.ts';
import type { Track } from '../../src/track/track.ts';

/** A car in a test race: an AI at a difficulty, or the simple centre-line bot (a stand-in for a player who doesn't avoid anyone). */
export type CarSpec = { kind: 'ai'; difficulty: number } | { kind: 'bot'; aggression: number };

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
 * does: drive, step, contact (three passes), lap counting.
 */
export function race(
  track: Track,
  specs: CarSpec[],
  laps: number,
  maxSeconds = 600,
  drafting = true,
  log: string[] | null = null,
  onHard: ((tick: number, i: number, j: number, hit: number) => void) | null = null,
  onTick: ((tick: number, cars: { car: CarPhysics; ai: AiDriver | null }[]) => void) | null = null,
): TrafficResult {
  const L = track.center.length;
  type Car = { car: CarPhysics; session: RaceSession; ai: AiDriver | null; aggression: number };
  const cars: Car[] = specs.map((sp, k) => {
    if (sp.kind === 'ai') {
      const ai = new AiDriver(track, { name: `ai${k}`, paint: 0, difficulty: sp.difficulty, laps, slot: k });
      return { car: ai.car, session: ai.session, ai, aggression: 0 };
    }
    const car = new CarPhysics(track);
    const g = gridPlace(track, k);
    car.placeAt(g.s, g.lateral);
    return { car, session: new RaceSession(L, null, laps, track.center.width), ai: null, aggression: sp.aggression };
  });
  const states: CarState[] = cars.map((c) => c.car.state);
  const drafts = new Float32Array(cars.length);
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
      slipstream(states, L, drafts);
      cars.forEach((c, k) => (c.car.draft = carriedTow(c.car.draft, drafts[k], dt)));
    }
    for (const c of cars) {
      if (c.ai) {
        const x0 = c.car.state.x;
        const z0 = c.car.state.z;
        c.car.step(c.ai.drive(states, dt));
        if (Math.hypot(c.car.state.x - x0, c.car.state.z - z0) > 3) resets++;
      } else {
        c.car.step(c.session.canDrive && c.session.phase !== 'finished' ? botInput(c.car.state, track, c.aggression) : NO_INPUT);
      }
    }
    const now = new Set<string>();
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < states.length; i++) {
        for (let j = i + 1; j < states.length; j++) {
          const hit = collideCars(states[i], states[j]);
          if (hit > 0) now.add(`${i}-${j}`);
          if (pass === 0 && hit > 2 && !touching.has(`${i}-${j}`)) {
            firm++;
            {
              const a = states[i];
              const b = states[j];
              const ds = Math.abs((((b.s - a.s) % L) + L * 1.5) % L - L / 2);
              if (ds > 3.2) kinds.rear++;
              else kinds.side++;
              if (Math.abs(track.center.curvature[Math.max(0, a.trackIndex)]) > 1 / 60) kinds.bend++;
              if (!cars[i].ai || !cars[j].ai) kinds.withBot++;
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
