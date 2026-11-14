import type { CarPerformance } from '../car/physics.ts';
import { CAREER } from '../config/career.ts';
import { DEVELOPMENT } from '../config/development.ts';
import { clamp } from '../core/math.ts';
import { hashString, rng } from '../core/random.ts';
import type { CareerSave } from './career.ts';
import { carDevelopment, type EngineeringArea } from './engineering.ts';
import { teamsFor } from './roster.ts';

/**
 * Every car in the championship as three ratings, on the same scale as a
 * team's overall car rating (1 = the original leader): aerodynamics,
 * chassis and power unit. The physics gets its grip, engine pull and top
 * speed from them by one formula for every car, the player's included, so
 * a rating point is worth the same on track whoever has it, and the
 * performance index tells the truth.
 *
 * A team's overall rating stays in `save.cars` (the mean of its three);
 * `save.carAreas` holds how each area differs from that mean (a team's
 * character: one is quick on the straights, another in the corners).
 */
export type CarArea = Exclude<EngineeringArea, 'durability'>;
export const CAR_AREAS: readonly CarArea[] = ['aero', 'chassis', 'powertrain'];
export type AreaRatings = Record<CarArea, number>;

/** One package a rival team brought (for the development news and the vehicle screen). */
export interface RivalPackage {
  season: number;
  /** The round it raced at (1-based). */
  round: number;
  team: string;
  area: CarArea;
  /** What it was worth (rating points, in its area). */
  gain: number;
  /** It didn't work as the team hoped. */
  flop: boolean;
}

const zero = (): AreaRatings => ({ aero: 0, chassis: 0, powertrain: 0 });
const dice = (save: Pick<CareerSave, 'seed'>, what: string) => rng(hashString(`${save.seed}:${what}`))();

/** A team's character at the start: each area a little better or worse than its overall rating (they average out). */
export function initialShape(save: Pick<CareerSave, 'seed'>, team: string): AreaRatings {
  const raw = CAR_AREAS.map((a) => (dice(save, `shape:${team}:${a}`) * 2 - 1) * DEVELOPMENT.character);
  const mean = raw.reduce((x, y) => x + y, 0) / raw.length;
  return { aero: raw[0] - mean, chassis: raw[1] - mean, powertrain: raw[2] - mean };
}

/** How team `team`'s areas differ from its overall rating. */
export function areaShape(save: Pick<CareerSave, 'seed'> & { carAreas?: CareerSave['carAreas'] }, team: string): AreaRatings {
  return save.carAreas?.[team] ?? initialShape(save, team);
}

/** Team `team`'s base car, area by area (no parts fitted to one car or the other). */
export function teamAreas(save: Pick<CareerSave, 'seed' | 'cars'> & { carAreas?: CareerSave['carAreas'] }, team: string, base = save.cars[team] ?? 0): AreaRatings {
  const shape = areaShape(save, team);
  return { aero: base + shape.aero, chassis: base + shape.chassis, powertrain: base + shape.powertrain };
}

/** What the parts fitted to driver `id`'s car add, area by area, in rating points. */
export function partAreas(save: CareerSave, id: string): AreaRatings {
  const parts = carDevelopment(save, id);
  return { aero: parts.aero * DEVELOPMENT.partScale, chassis: parts.chassis * DEVELOPMENT.partScale, powertrain: parts.powertrain * DEVELOPMENT.partScale };
}

/** Driver `id`'s car, area by area: its team's base car plus the parts fitted to that car. */
export function seatAreas(save: CareerSave, team: string, id: string | null): AreaRatings {
  const base = teamAreas(save, team);
  if (!id || team !== save.team) return base;
  const parts = partAreas(save, id);
  return { aero: base.aero + parts.aero, chassis: base.chassis + parts.chassis, powertrain: base.powertrain + parts.powertrain };
}

/** The overall rating of a car with these areas (their mean). */
export const overall = (a: AreaRatings): number => (a.aero + a.chassis + a.powertrain) / 3;

/**
 * Areas to the physics: cornering grip comes from the aero and the chassis,
 * engine pull from the power unit and the chassis (traction), top speed from
 * the power unit and the aero (drag). With all three areas at a rating r
 * this is the same car as before areas existed: 1 − CAREER.carGrip × (1 − r)
 * of the grip, and so on. `extra` adds grip and pull on top (a driver's
 * experience, a weekend approach).
 */
export function areaPhysics(a: AreaRatings, extra: { grip?: number; pull?: number } = {}): CarPerformance {
  const W = DEVELOPMENT.weights;
  const grip = W.grip.aero * a.aero + W.grip.chassis * a.chassis;
  const pull = W.pull.powertrain * a.powertrain + W.pull.chassis * a.chassis;
  const top = W.top.powertrain * a.powertrain + W.top.aero * a.aero;
  // Preserve the balance through 1.0; beyond it, diminishing returns rather than
  // unbounded straight-line speed or a hard wall.
  const progress = (value: number) => (value <= 1 ? value : 1 + 0.25 * (1 - Math.exp(-(value - 1) / 0.25)));
  return {
    grip: progress(1 - CAREER.carGrip * (1 - grip) + (extra.grip ?? 0)),
    pull: progress(1 - CAREER.carPull * (1 - pull) + (extra.pull ?? 0)),
    top: progress(1 - CAREER.carTop * (1 - top)),
  };
}

/**
 * The rival teams' development through a season. Each AI team brings a few
 * packages (DEVELOPMENT.packages a season, on rounds of its own); each goes
 * to the area it's weakest in, more often than not. What a season's
 * programme is worth depends on the team's engineering strength and on where
 * it finished last year: the lower, the more wind-tunnel time it gets, as in
 * the real thing. Now and then a package doesn't work.
 *
 * Called once per recorded round (round `done` has just been run); returns
 * the packages brought for the next round.
 */
export function developRivals(save: CareerSave, standing: readonly string[]): RivalPackage[] {
  const D = DEVELOPMENT;
  const round = save.done.length;
  const rounds = save.calendar.length;
  if (round >= rounds) return [];
  const out: RivalPackage[] = [];
  const teams = teamsFor(save).filter((t) => t.id !== save.team);
  for (const t of teams) {
    const n = Math.max(1, Math.round((rounds * D.packages) / 16));
    // Its rounds: spread over the season, each team on its own (a package raced from the round after it's announced).
    const offset = dice(save, `${save.season}:devoffset:${t.id}`);
    const due = Array.from({ length: n }, (_, k) => Math.min(rounds - 1, 1 + Math.floor(((k + offset) * (rounds - 1)) / n)));
    const k = due.indexOf(round);
    if (k < 0) continue;
    // Its season's budget: engineering strength, and help for the teams further back.
    const position = Math.max(0, standing.indexOf(t.id));
    const strength = D.strength[0] + dice(save, `strength:${t.id}`) * (D.strength[1] - D.strength[0]);
    const backing = 1 + D.atr * (position / Math.max(1, standing.length - 1));
    const budget = D.season * strength * backing;
    const flop = dice(save, `${save.season}:${round}:flop:${t.id}`) < D.flop;
    const size = D.size[0] + dice(save, `${save.season}:${round}:size:${t.id}`) * (D.size[1] - D.size[0]);
    // Every rating point in one area is a third of a point overall: three times as much there.
    const gain = ((budget / n) * size * 3) * (flop ? D.flopShare : 1);
    const shape = { ...areaShape(save, t.id) };
    const weakest = CAR_AREAS.reduce((a, b) => (shape[b] < shape[a] ? b : a));
    const area = dice(save, `${save.season}:${round}:area:${t.id}`) < D.weakest ? weakest : CAR_AREAS[Math.floor(dice(save, `${save.season}:${round}:pick:${t.id}`) * 3) % 3];
    shape[area] += gain;
    // Keep the overall rating in save.cars and the character as the difference from it.
    const mean = (shape.aero + shape.chassis + shape.powertrain) / 3;
    save.cars[t.id] = (save.cars[t.id] ?? t.car) + mean;
    save.carAreas ??= {};
    save.carAreas[t.id] = { aero: shape.aero - mean, chassis: shape.chassis - mean, powertrain: shape.powertrain - mean };
    out.push({ season: save.season, round: round + 1, team: t.id, area, gain, flop });
  }
  if (out.length) {
    save.rivalPackages = [...out, ...(save.rivalPackages ?? [])].slice(0, D.log);
  }
  return out;
}

/** Saved area data made safe (unknown teams dropped, each team's areas averaging zero). */
export function cleanCarAreas(raw: unknown, teams: readonly string[]): Record<string, AreaRatings> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, AreaRatings> = {};
  for (const id of teams) {
    const v = r[id];
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const a = CAR_AREAS.map((k) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? clamp(o[k] as number, -1, 1) : 0));
    // (Saved character averages zero already: left exactly as saved, so a save loads back identical.)
    const mean = (a[0] + a[1] + a[2]) / 3;
    out[id] = Math.abs(mean) < 1e-9 ? { aero: a[0], chassis: a[1], powertrain: a[2] } : { aero: a[0] - mean, chassis: a[1] - mean, powertrain: a[2] - mean };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Saved rival packages made safe. */
export function cleanRivalPackages(raw: unknown, teams: readonly string[]): RivalPackage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RivalPackage[] = [];
  for (const x of raw.slice(0, DEVELOPMENT.log)) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.team !== 'string' || !teams.includes(o.team) || !CAR_AREAS.includes(o.area as CarArea)) continue;
    const n = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : lo);
    out.push({ season: Math.floor(n(o.season, 1, 9999)), round: Math.floor(n(o.round, 1, 99)), team: o.team, area: o.area as CarArea, gain: n(o.gain, 0, 1), flop: o.flop === true });
  }
  return out.length ? out : undefined;
}

export { zero as noAreas };
