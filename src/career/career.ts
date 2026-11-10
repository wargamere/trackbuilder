import { CAREER, YOU_ID, type DriverDef, type RaceLength, type SeasonLength, type TeamDef } from '../config/career.ts';
import type { Compound } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import { hashString, rng } from '../core/random.ts';
import { loadJSON, saveJSON, storage } from '../platform/storage.ts';

/**
 * The career's rules, as plain data and functions (no screen, no tracks):
 * a season of rounds for ten teams of two, points for the top ten, drivers'
 * and constructors' standings, the weather and the AI's pace for each round,
 * and what's saved between visits. The screen is ui/careerScreen.ts; the
 * race screen drives each round (see RaceEventSpec in core/screen.ts).
 */

/** The weather for a round (the same kinds as a single race's). */
export type RoundWeather = 'dry' | 'rain' | 'changing';

/** One finished round. */
export interface RoundResult {
  /** Everyone in the classification, the winner first; the cars that retired come last. */
  order: string[];
  /** Who retired (they score nothing). */
  dnf: string[];
  /** Who set the race's fastest lap, and who started from pole (null: not known). */
  fastest: string | null;
  pole: string | null;
}

/** A finished season, for the record. */
export interface SeasonRecord {
  season: number;
  /** The team you drove for. */
  team: string;
  /** Your place in the drivers' championship, your points, wins and podiums. */
  position: number;
  points: number;
  wins: number;
  podiums: number;
  /** Your team's place in the constructors' championship. */
  teamPosition: number;
  /** The champions: the driver (their name, as it was) and the team. */
  champion: string;
  championTeam: string;
}

/** Everything a career keeps. */
export interface CareerSave {
  v: 1;
  /** Your name on the timing screens. */
  name: string;
  /** The team you drive for this season. */
  team: string;
  /** How fast the quickest AI is, 1–100 (%). */
  difficulty: number;
  length: RaceLength;
  rounds: SeasonLength;
  /** The season under way (1 = the first). */
  season: number;
  /** What the career's dice are thrown from (weather, form, failures, how the cars change). */
  seed: number;
  /** How good each team's car is this season (0..1), by team id. */
  cars: Record<string, number>;
  /** This season's rounds: track ids, in order. */
  calendar: string[];
  /** The rounds run so far this season. */
  done: RoundResult[];
  /** After qualifying for the next round: the grid (driver ids, pole first). Null before it. */
  grid: string[] | null;
  /** The tyres you last chose to start a race on. */
  tyres: Compound;
  history: SeasonRecord[];
}

/** A driver in this season's field. */
export interface Entrant {
  id: string;
  name: string;
  code: string;
  team: TeamDef;
  you: boolean;
}

/** A row of the drivers' standings. */
export interface DriverRow extends Entrant {
  points: number;
  wins: number;
  podiums: number;
  /** Races it retired from, poles and fastest laps. */
  dnfs: number;
  poles: number;
  fastest: number;
  /** Its finishing place each round so far (1-based; 0 = retired). */
  results: number[];
}

/** A row of the constructors' standings. */
export interface TeamRow {
  team: TeamDef;
  points: number;
  wins: number;
  podiums: number;
  /** Its drivers this season. */
  drivers: Entrant[];
  yours: boolean;
}

const KEY = 'career.v1';
const teamById = new Map(CAREER.teams.map((t) => [t.id, t]));
const driverById = new Map(CAREER.drivers.map((d) => [d.id, d]));
const LENGTHS: readonly RaceLength[] = ['short', 'medium', 'long'];
const SEASONS: readonly SeasonLength[] = ['short', 'standard', 'full'];
const COMPOUNDS: readonly Compound[] = ['soft', 'medium', 'hard', 'wet'];

/** A throw of the career's dice for `what` (the same every time it's asked): 0..1. */
function dice(save: Pick<CareerSave, 'seed'>, what: string): number {
  return rng(hashString(`${save.seed}:${what}`))();
}

/** Your name as typed, made fit for the screen (at most 14 characters; "You" if it's empty). */
export function cleanName(name: unknown): string {
  const s = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 14) : '';
  return s || 'You';
}

export function team(id: string): TeamDef {
  return teamById.get(id) ?? CAREER.teams[0];
}

/** The rounds of season `season` (1-based): an even spread of the calendar, a different one each season when it's shorter than the whole. */
export function seasonCalendar(length: SeasonLength, season: number): string[] {
  const all = CAREER.calendar;
  const n = Math.min(CAREER.rounds[length], all.length);
  const step = all.length / n;
  const turns = Math.ceil(step);
  const off = (((season - 1) % turns) * step) / turns;
  return Array.from({ length: n }, (_, i) => all[Math.min(all.length - 1, Math.floor(i * step + off))]);
}

/** How the cars stand in a new career: each team's own, as designed. */
function firstCars(): Record<string, number> {
  return Object.fromEntries(CAREER.teams.map((t) => [t.id, t.car]));
}

/** A new career, at the first round of the first season. */
export function newCareer(opts: { name: string; team: string; difficulty: number; length: RaceLength; rounds: SeasonLength }, seed: number = Math.floor(Math.random() * 0xffffffff)): CareerSave {
  return {
    v: 1,
    name: cleanName(opts.name),
    team: team(opts.team).id,
    difficulty: clamp(Math.round(opts.difficulty), 1, 100),
    length: opts.length,
    rounds: opts.rounds,
    season: 1,
    seed: seed >>> 0,
    cars: firstCars(),
    calendar: seasonCalendar(opts.rounds, 1),
    done: [],
    grid: null,
    tyres: 'medium',
    history: [],
  };
}

/** This season's twenty drivers, team by team (quickest car first as designed): you in your team's second seat. */
export function lineup(save: Pick<CareerSave, 'team' | 'name'>): Entrant[] {
  const out: Entrant[] = [];
  for (const t of CAREER.teams) {
    t.drivers.forEach((id, seat) => {
      const d = driverById.get(id) as DriverDef;
      if (t.id === save.team && seat === 1) out.push({ id: YOU_ID, name: save.name, code: save.name.slice(0, 3).toUpperCase(), team: t, you: true });
      else out.push({ id: d.id, name: d.name, code: d.code, team: t, you: false });
    });
  }
  return out;
}

/** How good team `id`'s car is this season, 0..1. */
export function carRating(save: Pick<CareerSave, 'cars'>, id: string): number {
  const c = save.cars[id];
  return typeof c === 'number' ? clamp(c, 0, 1) : team(id).car;
}

/** The teams by how good their cars are this season, the quickest first. */
export function carOrder(save: Pick<CareerSave, 'cars'>): TeamDef[] {
  return [...CAREER.teams].sort((a, b) => carRating(save, b.id) - carRating(save, a.id));
}

/** Where team `id`'s car ranks this season (1 = the quickest): what the team expects in the constructors' championship. */
export function carRank(save: Pick<CareerSave, 'cars'>, id: string): number {
  return carOrder(save).findIndex((t) => t.id === id) + 1;
}

/**
 * How hard AI driver `id` drives in round `round` (0-based), 0..1 (see
 * aiPace): the career's difficulty for the best driver in the quickest car,
 * less for a slower car and a weaker driver, give or take the weekend's form.
 */
export function aiDifficulty(save: CareerSave, round: number, id: string): number {
  const d = driverById.get(id);
  const t = CAREER.teams.find((x) => x.drivers.includes(id));
  if (!d || !t) return save.difficulty / 100;
  const rating = CAREER.carShare * carRating(save, t.id) + (1 - CAREER.carShare) * d.skill;
  const form = (dice(save, `${save.season}:${round}:form:${id}`) * 2 - 1) * CAREER.form;
  return clamp(save.difficulty / 100 - CAREER.spread * (1 - rating) + form, 0.01, 1);
}

/** Your own car this season: the share of the standard car's grip, engine pull and top speed your team's car has. */
export function playerCar(save: CareerSave): { grip: number; pull: number; top: number } {
  const off = 1 - carRating(save, save.team);
  return { grip: 1 - CAREER.carGrip * off, pull: 1 - CAREER.carPull * off, top: 1 - CAREER.carTop * off };
}

/** The weather for round `round` (0-based) of this season. */
export function roundWeather(save: CareerSave, round: number): RoundWeather {
  const r = dice(save, `${save.season}:${round}:weather`);
  return r < CAREER.rain ? 'rain' : r < CAREER.rain + CAREER.changing ? 'changing' : 'dry';
}

/** Mechanical failures in round `round`: for each AI car that has one, how far through the race (a share of the distance). */
export function roundFailures(save: CareerSave, round: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of lineup(save)) {
    if (e.you) continue;
    if (dice(save, `${save.season}:${round}:fail:${e.id}`) >= CAREER.failure) continue;
    out[e.id] = CAREER.failFrom + dice(save, `${save.season}:${round}:failAt:${e.id}`) * (CAREER.failTo - CAREER.failFrom);
  }
  return out;
}

/** Laps for a race of `length` on a track whose racing lap takes about `lapTime` s. */
export function raceLaps(length: RaceLength, lapTime: number): number {
  const L = CAREER.lengths[length];
  return clamp(Math.round((L.minutes * 60) / Math.max(10, lapTime)), L.minLaps, CAREER.maxLaps);
}

/** Laps medium tyres last in a race of `laps` on a track where they'd naturally last `natural` (see CAREER.tyreShare). */
export function tyreLife(laps: number, natural: number): number {
  return Math.max(natural, laps * CAREER.tyreShare);
}

/** Points for finishing `place` (1-based). */
export function pointsFor(place: number): number {
  return CAREER.points[place - 1] ?? 0;
}

/** Points driver `id` scored in a round (nothing for a retirement). */
export function roundPoints(r: RoundResult, id: string): number {
  if (r.dnf.includes(id)) return 0;
  const i = r.order.indexOf(id);
  return i < 0 ? 0 : pointsFor(i + 1);
}

/** Ahead on points; level, on the most wins, then the most 2nd places, and so on (countback). */
function ahead(a: { points: number; places: number[] }, b: { points: number; places: number[] }): number {
  if (a.points !== b.points) return b.points - a.points;
  for (let k = 0; k < Math.max(a.places.length, b.places.length); k++) {
    const d = (b.places[k] ?? 0) - (a.places[k] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The drivers' championship as it stands, the leader first. */
export function driverStandings(save: CareerSave): DriverRow[] {
  const rows = lineup(save).map((e) => ({ ...e, points: 0, wins: 0, podiums: 0, dnfs: 0, poles: 0, fastest: 0, results: [] as number[], places: [] as number[] }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const round of save.done) {
    round.order.forEach((id, i) => {
      const row = byId.get(id);
      if (!row) return;
      if (round.dnf.includes(id)) {
        row.dnfs++;
        row.results.push(0);
        return;
      }
      row.results.push(i + 1);
      row.points += pointsFor(i + 1);
      row.places[i] = (row.places[i] ?? 0) + 1;
      if (i === 0) row.wins++;
      if (i < 3) row.podiums++;
    });
    const pole = round.pole ? byId.get(round.pole) : null;
    if (pole) pole.poles++;
    const fast = round.fastest ? byId.get(round.fastest) : null;
    if (fast) fast.fastest++;
  }
  // (A stable sort: level on everything, the line-up's order stays.)
  return rows.sort(ahead).map(({ places: _places, ...row }) => row);
}

/** The constructors' championship: each team's two drivers' points together. */
export function teamStandings(save: CareerSave): TeamRow[] {
  const drivers = driverStandings(save);
  const rows = CAREER.teams.map((t) => {
    const mine = drivers.filter((d) => d.team.id === t.id);
    const places: number[] = [];
    for (const d of mine) d.results.forEach((p) => p > 0 && (places[p - 1] = (places[p - 1] ?? 0) + 1));
    return {
      team: t,
      points: mine.reduce((a, d) => a + d.points, 0),
      wins: mine.reduce((a, d) => a + d.wins, 0),
      podiums: mine.reduce((a, d) => a + d.podiums, 0),
      drivers: mine.map(({ id, name, code, team: tm, you }) => ({ id, name, code, team: tm, you })),
      yours: t.id === save.team,
      places,
    };
  });
  return rows.sort(ahead).map(({ places: _places, ...row }) => row);
}

/** The round to drive next (0-based), or null when the season is over. */
export function nextRound(save: CareerSave): number | null {
  return save.done.length < save.calendar.length ? save.done.length : null;
}

/** A grid (ids, pole first) made whole: only this season's drivers, each once, anyone missing at the back. */
export function wholeOrder(save: CareerSave, order: readonly string[]): string[] {
  const ids = lineup(save).map((e) => e.id);
  const out = order.filter((id, i) => ids.includes(id) && order.indexOf(id) === i);
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

/** Qualifying for the next round is done: the grid is kept until the race has been run. */
export function setGrid(save: CareerSave, order: readonly string[]): void {
  save.grid = wholeOrder(save, order);
}

/**
 * The next round has been run: `order` is the classification (the winner
 * first), `dnf` who retired. The cars that retired go to the end of it (in
 * the order given), and the grid is used up.
 */
export function recordRound(save: CareerSave, result: { order: readonly string[]; dnf: readonly string[]; fastest: string | null }): RoundResult | null {
  if (nextRound(save) === null) return null;
  const whole = wholeOrder(save, result.order);
  const dnf = whole.filter((id) => result.dnf.includes(id));
  const round: RoundResult = {
    order: [...whole.filter((id) => !dnf.includes(id)), ...dnf],
    dnf,
    fastest: result.fastest && whole.includes(result.fastest) ? result.fastest : null,
    pole: save.grid?.[0] ?? null,
  };
  save.done.push(round);
  save.grid = null;
  return round;
}

/** How the cars will stand next season: each up to CAREER.drift better or worse, then spread out again from the quickest (1) down. */
export function nextCars(save: CareerSave): Record<string, number> {
  const raw = CAREER.teams.map((t) => carRating(save, t.id) + (dice(save, `${save.season}:drift:${t.id}`) * 2 - 1) * CAREER.drift);
  const lo = Math.min(...raw);
  const hi = Math.max(...raw);
  const floor = CAREER.teams[CAREER.teams.length - 1].car;
  return Object.fromEntries(CAREER.teams.map((t, i) => [t.id, hi > lo ? floor + ((raw[i] - lo) / (hi - lo)) * (1 - floor) : t.car]));
}

/** Your season so far, in a line: place, points, wins, podiums and your team's place. */
export function yourSeason(save: CareerSave): { position: number; points: number; wins: number; podiums: number; teamPosition: number } {
  const drivers = driverStandings(save);
  const i = drivers.findIndex((d) => d.you);
  const me = drivers[i];
  return { position: i + 1, points: me?.points ?? 0, wins: me?.wins ?? 0, podiums: me?.podiums ?? 0, teamPosition: teamStandings(save).findIndex((t) => t.yours) + 1 };
}

/**
 * The teams that want you for next season, the best car first: your own
 * (always), and every team whose car next season ranks no better than
 * CAREER.offerReach places above the level your championship place is worth
 * (1st–2nd: the best car; 3rd–4th: the second best; …).
 */
export function offers(save: CareerSave): TeamDef[] {
  const next = { cars: nextCars(save) };
  const level = Math.ceil(yourSeason(save).position / 2);
  return carOrder(next).filter((t) => t.id === save.team || carRank(next, t.id) >= level - CAREER.offerReach);
}

/** The season is over: it goes in the record, and the next one starts with `teamId` (one of offers()). */
export function nextSeason(save: CareerSave, teamId: string): void {
  if (nextRound(save) !== null) return;
  const drivers = driverStandings(save);
  const teams = teamStandings(save);
  const mine = yourSeason(save);
  save.history.push({
    season: save.season,
    team: save.team,
    ...mine,
    champion: drivers[0]?.name ?? '',
    championTeam: teams[0]?.team.id ?? '',
  });
  if (save.history.length > 50) save.history.splice(0, save.history.length - 50);
  const allowed = offers(save).some((t) => t.id === teamId);
  save.cars = nextCars(save);
  if (allowed) save.team = teamId;
  save.season++;
  save.calendar = seasonCalendar(save.rounds, save.season);
  save.done = [];
  save.grid = null;
}

/** Saved data made safe: a career as this version understands it, or null if it isn't one. */
export function cleanCareer(raw: unknown): CareerSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.team !== 'string' || !teamById.has(r.team)) return null;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && isFinite(x) ? clamp(Math.round(x), lo, hi) : d);
  const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  const rounds = SEASONS.includes(r.rounds as SeasonLength) ? (r.rounds as SeasonLength) : 'standard';
  const season = num(r.season, 1, 9999, 1);
  const known = new Set<string>(CAREER.calendar);
  const calendar = strings(r.calendar).filter((id) => known.has(id));
  const cars: Record<string, number> = {};
  const savedCars = r.cars && typeof r.cars === 'object' ? (r.cars as Record<string, unknown>) : {};
  for (const t of CAREER.teams) cars[t.id] = typeof savedCars[t.id] === 'number' && isFinite(savedCars[t.id] as number) ? clamp(savedCars[t.id] as number, 0, 1) : t.car;
  const save: CareerSave = {
    v: 1,
    name: cleanName(r.name),
    team: r.team,
    difficulty: num(r.difficulty, 1, 100, 50),
    length: LENGTHS.includes(r.length as RaceLength) ? (r.length as RaceLength) : 'medium',
    rounds,
    season,
    seed: typeof r.seed === 'number' && isFinite(r.seed) ? r.seed >>> 0 : 1,
    cars,
    calendar: calendar.length ? calendar : seasonCalendar(rounds, season),
    done: [],
    grid: null,
    tyres: COMPOUNDS.includes(r.tyres as Compound) ? (r.tyres as Compound) : 'medium',
    history: [],
  };
  const ids = new Set(lineup(save).map((e) => e.id));
  const one = (x: unknown) => (typeof x === 'string' && ids.has(x) ? x : null);
  for (const d of Array.isArray(r.done) ? r.done : []) {
    if (!d || typeof d !== 'object' || save.done.length >= save.calendar.length) continue;
    const o = d as Record<string, unknown>;
    const order = wholeOrder(save, strings(o.order));
    save.done.push({ order, dnf: strings(o.dnf).filter((id) => ids.has(id)), fastest: one(o.fastest), pole: one(o.pole) });
  }
  const grid = strings(r.grid);
  if (grid.length && nextRound(save) !== null) save.grid = wholeOrder(save, grid);
  for (const h of Array.isArray(r.history) ? r.history : []) {
    if (!h || typeof h !== 'object') continue;
    const o = h as Record<string, unknown>;
    if (typeof o.team !== 'string' || !teamById.has(o.team)) continue;
    save.history.push({
      season: num(o.season, 1, 9999, save.history.length + 1),
      team: o.team,
      position: num(o.position, 1, CAREER.cars, CAREER.cars),
      points: num(o.points, 0, 1e6, 0),
      wins: num(o.wins, 0, 999, 0),
      podiums: num(o.podiums, 0, 999, 0),
      teamPosition: num(o.teamPosition, 1, CAREER.teams.length, CAREER.teams.length),
      champion: typeof o.champion === 'string' ? o.champion.slice(0, 40) : '',
      championTeam: typeof o.championTeam === 'string' && teamById.has(o.championTeam) ? o.championTeam : '',
    });
  }
  return save;
}

/**
 * The saved career (one at a time), through the platform's storage: so it's
 * in the cloud save with everything else. Every change is written at once.
 */
export class CareerStore {
  private loaded = false;
  private current: CareerSave | null = null;

  /** The career under way, or null. */
  get save(): CareerSave | null {
    if (!this.loaded) {
      this.loaded = true;
      this.current = cleanCareer(loadJSON<unknown>(KEY, null));
    }
    return this.current;
  }

  /** Starts a new career (over any there was). */
  start(save: CareerSave): void {
    this.loaded = true;
    this.current = save;
    this.write();
  }

  /** Writes the career after it changed. */
  write(): void {
    if (this.current) saveJSON(KEY, this.current);
  }

  /** Throws the career away. */
  clear(): void {
    this.loaded = true;
    this.current = null;
    storage.removeItem(KEY);
  }
}
