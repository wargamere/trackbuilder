import { CAREER, YOU_ID, type DriverDef, type RaceLength, type SeasonLength, type TeamDef } from '../config/career.ts';
import { STANDARD_CAR, type CarPerformance } from '../car/physics.ts';
import { AI, type Compound } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import { hashString, rng } from '../core/random.ts';
import { loadJSON, saveJSON, storage } from '../platform/storage.ts';
import { cleanOwner, grantSeasonPrize, settleOwnerRound, type OwnerState } from './owner.ts';
import { cleanEntry, driverDef, teamsFor, type RosterSave } from './roster.ts';
import { GP_TEAMS } from '../config/grandPrix.ts';
import { createDynasty, driverProgress, driverRating, dynasty, failureChance, settleDynastyRound, startDynastySeason, weekendApproach } from './dynasty.ts';
import { advanceToWeekend, announceRegulations, carDevelopment, startEngineeringSeason, teamDevelopment } from './engineering.ts';
import { CALENDAR_TRACKS } from './calendar.ts';
import { seasonWeather } from './seasonWeather.ts';
import { activateDriverContracts, cleanDriverContracts, driverContracts, settleDriverPayroll, type DriverContracts } from './contracts.ts';

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
  report?: SeasonReport;
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

export interface SeasonReport {
  teamName: string; teamPoints: number; teamWins: number; teamPodiums: number; teamPosition: number;
  target: number; prize: number; startIndex: number; endIndex: number; baselineRound: number; research: number; fitted: number;
  champion: string; championTeam: string; bestTrack: string; bestPoints: number;
  drivers: { id: string; name: string; position: number; points: number; wins: number; podiums: number }[];
}

/** Everything a career keeps. */
export interface CareerSave extends RosterSave {
  contracts?: DriverContracts;
  seasonStart?: { season: number; round: number; index: number };
  /** Present in a team-owner career; absent in legacy driver careers. */
  owner?: OwnerState;
  v: 1;
  /** Your name on the timing screens. */
  name: string;
  /** The team you drive for this season. */
  team: string;
  /** How fast the quickest AI is, 1–110 (%). */
  difficulty: number;
  length: RaceLength;
  rounds: SeasonLength;
  /** The season under way (1 = the first). */
  season: number;
  /** What the career's dice are thrown from (weather, form, failures, how the cars change). */
  seed: number;
  /** Absolute base performance by team; 1 is the initial leader, not a career cap. */
  cars: Record<string, number>;
  /** This season's rounds: track ids, in order. */
  calendar: string[];
  /** A custom schedule carries into the next preseason, where it can be edited again. */
  customCalendar?: true;
  /** Locked at the first on-track session, not after the first race. */
  calendarStarted?: true;
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

export function team(id: string, save?: RosterSave): TeamDef {
  return (save ? teamsFor(save).find((t) => t.id === id) : undefined) ?? teamById.get(id) ?? GP_TEAMS.find((t) => t.id === id) ?? CAREER.teams[0];
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
    difficulty: clamp(Math.round(opts.difficulty), 1, AI.maxDifficulty),
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
export function lineup(save: Pick<CareerSave, 'team' | 'name' | 'owner' | 'entry' | 'roster'>): Entrant[] {
  const out: Entrant[] = [];
  for (const t of teamsFor(save)) {
    t.drivers.forEach((id, seat) => {
      const d = driverDef(id) as DriverDef;
      if (!save.owner && t.id === save.team && seat === 1) out.push({ id: YOU_ID, name: save.name, code: save.name.slice(0, 3).toUpperCase(), team: t, you: true });
      else out.push({ id: d.id, name: d.name, code: d.code, team: t, you: save.owner?.selected === id });
    });
  }
  return out;
}

/** Absolute car development, including the mean gain of both owned cars. */
export function carRating(save: Pick<CareerSave, 'cars'> & Partial<Pick<CareerSave, 'owner' | 'team' | 'roster' | 'entry'>>, id: string): number {
  const c = save.cars[id];
  return typeof c === 'number' ? Math.max(0, c + (id === save.team ? teamDevelopment(save) : 0)) : team(id).car;
}

/** An absolute index: the initial leading car is 700, with room for future seasons. */
export function performanceIndex(save: Parameters<typeof carRating>[0], id: string): number { return Math.round(carRating(save, id) * 700); }

/** The teams by how good their cars are this season, the quickest first. */
export function carOrder(save: Pick<CareerSave, 'cars'> & RosterSave): TeamDef[] {
  return [...teamsFor(save)].sort((a, b) => carRating(save, b.id) - carRating(save, a.id));
}

/** Where team `id`'s car ranks this season (1 = the quickest): what the team expects in the constructors' championship. */
export function carRank(save: Pick<CareerSave, 'cars'> & RosterSave, id: string): number {
  return carOrder(save).findIndex((t) => t.id === id) + 1;
}

/**
 * How hard AI driver `id` drives in round `round` (0-based), 0..1 (see
 * aiPace): ability and weekend form only. The car's hardware is passed to
 * the physics and the driver's speed plan through carPerformance().
 */
export function aiDifficulty(save: CareerSave, round: number, id: string): number {
  const d = driverDef(id);
  const t = teamsFor(save).find((x) => x.drivers.includes(id));
  const base = save.difficulty / 100;
  if (!d || !t) return base;
  const form = (dice(save, `${save.season}:${round}:form:${id}`) * 2 - 1) * CAREER.form;
  return clamp(base - CAREER.spread * (1 - driverRating(save, id)) + form + (save.owner && t.id === save.team ? weekendApproach(save, round).pace : 0), 0.01, save.difficulty <= 100 ? 1 : AI.maxDifficulty / 100);
}

/** Physical hardware for this driver's seat, whether driven by the player or AI. */
export function carPerformance(save: CareerSave, id: string): CarPerformance {
  const t = id === YOU_ID ? teamsFor(save).find((t) => t.id === save.team) : teamsFor(save).find((t) => t.drivers.includes(id));
  if (!t) return { ...STANDARD_CAR };
  // Use the base rating here: fitted parts are seat-specific and must not be counted twice.
  const off = 1 - carRating({ cars: save.cars }, t.id);
  const parts = carDevelopment(save, id);
  const experience = save.owner && t.id === save.team ? Math.floor(driverProgress(save, id).xp / 100) * .0005 : 0;
  const approach = save.owner && t.id === save.team ? weekendApproach(save).pace * 2 / 3 : 0;
  // Preserve the existing balance through 1.0; later decades have diminishing
  // returns rather than unbounded straight-line speeds or a hard upgrade wall.
  const progress = (value: number) => value <= 1 ? value : 1 + .25 * (1 - Math.exp(-(value - 1) / .25));
  return { grip: progress(1 - CAREER.carGrip * off + parts.aero * .7 + parts.chassis * .5 + experience), pull: progress(1 - CAREER.carPull * off + parts.powertrain * .8 + parts.chassis * .16 + approach), top: progress(1 - CAREER.carTop * off + parts.powertrain * .36 + parts.aero * .08) };
}

/** Hardware in the car selected for the player this weekend. */
export function playerCar(save: CareerSave): CarPerformance {
  return carPerformance(save, save.owner?.selected ?? YOU_ID);
}

/** The weather for round `round` (0-based) of this season. */
export function roundWeather(save: CareerSave, round: number): RoundWeather {
  return seasonWeather(save)[round] ?? 'dry';
}

/** Mechanical failures in round `round`: for each AI car that has one, how far through the race (a share of the distance). */
export function roundFailures(save: CareerSave, round: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of lineup(save)) {
    if (e.you) continue;
    if (dice(save, `${save.season}:${round}:fail:${e.id}`) >= failureChance(save, e.id, round)) continue;
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
  const rows = teamsFor(save).map((t) => {
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
  save.calendarStarted = true;
  save.grid = wholeOrder(save, order);
}

/**
 * The next round has been run: `order` is the classification (the winner
 * first), `dnf` who retired. The cars that retired go to the end of it (in
 * the order given), and the grid is used up.
 */
export function recordRound(save: CareerSave, result: { order: readonly string[]; dnf: readonly string[]; fastest: string | null }): RoundResult | null {
  if (nextRound(save) === null) return null;
  save.calendarStarted = true;
  if (save.owner) dynasty(save);
  ensureSeasonStart(save);
  if (save.owner?.engineering) advanceToWeekend(save, true);
  const whole = wholeOrder(save, result.order);
  const dnf = whole.filter((id) => result.dnf.includes(id));
  const round: RoundResult = {
    order: [...whole.filter((id) => !dnf.includes(id)), ...dnf],
    dnf,
    fastest: result.fastest && whole.includes(result.fastest) ? result.fastest : null,
    pole: save.grid?.[0] ?? null,
  };
  save.done.push(round);
  settleOwnerRound(save, round);
  settleDriverPayroll(save);
  if (save.owner) settleDynastyRound(save, round, teamStandings(save).findIndex((t) => t.yours) + 1, driverStandings(save)[0]?.id ?? null);
  announceRegulations(save);
  settleSeasonAwards(save);
  save.grid = null;
  return round;
}

/** Carry absolute progress forward; the leading car is never normalised back to a ceiling. */
export function nextCars(save: CareerSave): Record<string, number> {
  const teams = teamsFor(save);
  return Object.fromEntries(teams.map(t => [t.id, (save.cars[t.id] ?? t.car) + (save.owner && t.id === save.team ? 0 : .015 + dice(save, `${save.season}:drift:${t.id}`) * .04)]));
}

/** Your season so far, in a line: place, points, wins, podiums and your team's place. */
export function yourSeason(save: CareerSave): { position: number; points: number; wins: number; podiums: number; teamPosition: number } {
  const drivers = driverStandings(save);
  const i = drivers.findIndex((d) => save.owner ? d.team.id === save.team : d.you);
  const me = drivers[i];
  return { position: i + 1, points: me?.points ?? 0, wins: me?.wins ?? 0, podiums: me?.podiums ?? 0, teamPosition: teamStandings(save).findIndex((t) => t.yours) + 1 };
}

export function ensureSeasonStart(save: CareerSave): boolean {
  if (!save.owner || save.seasonStart?.season === save.season) return false;
  save.seasonStart = { season: save.season, round: save.done.length, index: performanceIndex(save, save.team) }; return true;
}

export function settleSeasonAwards(save: CareerSave): boolean {
  if (!save.owner || nextRound(save) !== null) return false;
  const teams = teamStandings(save), position = teams.findIndex(t => t.yours) + 1;
  const driverTitle = driverStandings(save)[0]?.team.id === save.team;
  return grantSeasonPrize(save, 1_000_000 + (teams.length - position) * 350_000 + (driverTitle ? 1_000_000 : 0));
}

export function seasonReport(save: CareerSave): SeasonReport {
  const teams = teamStandings(save), mine = teams.find(t => t.yours)!, all = driverStandings(save), ids = new Set(mine.drivers.map(d => d.id));
  const weekends = save.done.map((r, i) => ({ track: save.calendar[i], points: r.order.reduce((sum, id, place) => sum + (ids.has(id) && !r.dnf.includes(id) ? CAREER.points[place] ?? 0 : 0), 0) }));
  const best = weekends.sort((a, b) => b.points - a.points)[0];
  return { teamName: mine.team.name, teamPoints: mine.points, teamWins: mine.wins, teamPodiums: mine.podiums, teamPosition: teams.indexOf(mine) + 1,
    target: save.owner?.target ?? carRank(save, save.team), prize: save.owner?.seasonPrize?.season === save.season ? save.owner.seasonPrize.amount : 0,
    startIndex: save.seasonStart?.index ?? performanceIndex(save, save.team), endIndex: performanceIndex(save, save.team), baselineRound: save.seasonStart?.round ?? save.done.length,
    research: save.owner?.engineering?.researched.length ?? 0, fitted: save.owner?.engineering?.fitted.reduce((sum, car) => sum + car.length, 0) ?? 0,
    champion: all[0]?.name ?? '', championTeam: teams[0]?.team.name ?? '', bestTrack: best?.track ?? '', bestPoints: best?.points ?? 0,
    drivers: all.map((d, i) => ({ id: d.id, name: d.name, position: i + 1, points: d.points, wins: d.wins, podiums: d.podiums })).filter(d => ids.has(d.id)) };
}

function cleanSeasonReport(raw: unknown): SeasonReport | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>, text = (x: unknown) => typeof x === 'string' ? x.slice(0, 80) : '';
  const n = (x: unknown, max = 1e9) => typeof x === 'number' && Number.isFinite(x) ? Math.round(clamp(x, 0, max)) : 0;
  if (!Array.isArray(r.drivers) || typeof r.teamName !== 'string') return undefined;
  return { teamName: text(r.teamName), teamPoints: n(r.teamPoints), teamWins: n(r.teamWins), teamPodiums: n(r.teamPodiums), teamPosition: n(r.teamPosition, 12), target: n(r.target, 12), prize: n(r.prize), startIndex: n(r.startIndex), endIndex: n(r.endIndex), baselineRound: n(r.baselineRound, 30), research: n(r.research, 16), fitted: n(r.fitted, 32), champion: text(r.champion), championTeam: text(r.championTeam), bestTrack: text(r.bestTrack), bestPoints: n(r.bestPoints, 50),
    drivers: r.drivers.filter(d => d && typeof d === 'object' && !!driverDef(d.id)).slice(0, 2).map(d => ({ id: d.id, name: text(d.name), position: n(d.position, 24), points: n(d.points), wins: n(d.wins), podiums: n(d.podiums) })) };
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
  settleSeasonAwards(save);
  if (save.owner) driverContracts(save);
  const drivers = driverStandings(save);
  const teams = teamStandings(save);
  const mine = yourSeason(save);
  save.history.push({
    season: save.season,
    team: save.team,
    ...mine,
    champion: drivers[0]?.name ?? '',
    championTeam: teams[0]?.team.id ?? '',
    ...(save.owner ? { report: seasonReport(save) } : {}),
  });
  if (save.history.length > 200) save.history.splice(0, save.history.length - 200);
  const allowed = !save.owner && offers(save).some((t) => t.id === teamId);
  save.cars = nextCars(save);
  if (allowed) save.team = teamId;
  save.season++;
  if (!save.customCalendar) save.calendar = seasonCalendar(save.rounds, save.season);
  delete save.calendarStarted;
  save.done = [];
  save.grid = null;
  if (save.owner) { save.owner.development = 0; startEngineeringSeason(save); activateDriverContracts(save); save.owner.target = carRank(save, save.team); startDynastySeason(save); }
  ensureSeasonStart(save);
}

/** Saved data made safe: a career as this version understands it, or null if it isn't one. */
export function cleanCareer(raw: unknown): CareerSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const roster = r.roster === 'grandprix' ? 'grandprix' : undefined;
  const entry = cleanEntry(r.entry, roster);
  const field = teamsFor({ roster, entry });
  if (r.v !== 1 || typeof r.team !== 'string' || !field.some((t) => t.id === r.team) || (entry && entry.id !== r.team)) return null;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && isFinite(x) ? clamp(Math.round(x), lo, hi) : d);
  const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  const rounds = SEASONS.includes(r.rounds as SeasonLength) ? (r.rounds as SeasonLength) : 'standard';
  const season = num(r.season, 1, 9999, 1);
  const known = new Set(CALENDAR_TRACKS.map(t => t.id));
  const calendar = [...new Set(strings(r.calendar).filter((id) => known.has(id)))];
  const cars: Record<string, number> = {};
  const savedCars = r.cars && typeof r.cars === 'object' ? (r.cars as Record<string, unknown>) : {};
  for (const t of field) cars[t.id] = typeof savedCars[t.id] === 'number' && isFinite(savedCars[t.id] as number) ? clamp(savedCars[t.id] as number, 0, 100) : t.car;
  const save: CareerSave = {
    v: 1,
    name: cleanName(r.name),
    team: r.team,
    difficulty: num(r.difficulty, 1, AI.maxDifficulty, 50),
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
  if (roster) save.roster = roster;
  if (entry) save.entry = entry;
  const seats = field.find((t) => t.id === save.team)!.drivers;
  const owner = cleanOwner(r.owner, save.team, seats);
  if (owner) save.owner = owner;
  if (owner?.world && !field.some((t) => t.id === owner.world!.rival.id && t.id !== save.team)) owner.world.rival.id = createDynasty(save).rival.id;
  const contracts = cleanDriverContracts(r.contracts, save); if (contracts) save.contracts = contracts;
  if (r.seasonStart && typeof r.seasonStart === 'object') {
    const p = r.seasonStart as Record<string, unknown>;
    if (p.season === season && typeof p.index === 'number' && Number.isFinite(p.index) && p.index >= 0) save.seasonStart = { season, round: num(p.round, 0, save.calendar.length, 0), index: Math.min(1e9, Math.round(p.index)) };
  }
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
  if (r.customCalendar === true) save.customCalendar = true;
  if (r.calendarStarted === true || save.done.length || save.grid || (save.owner?.engineering?.practice.key.startsWith(`${save.season}:`) && save.owner.engineering.practice.laps > 0)) save.calendarStarted = true;
  for (const h of Array.isArray(r.history) ? r.history.slice(-200) : []) {
    if (!h || typeof h !== 'object') continue;
    const o = h as Record<string, unknown>;
    if (typeof o.team !== 'string' || !field.some((t) => t.id === o.team)) continue;
    save.history.push({
      season: num(o.season, 1, 9999, save.history.length + 1),
      team: o.team,
      position: num(o.position, 1, field.length * 2, field.length * 2),
      points: num(o.points, 0, 1e6, 0),
      wins: num(o.wins, 0, 999, 0),
      podiums: num(o.podiums, 0, 999, 0),
      teamPosition: num(o.teamPosition, 1, field.length, field.length),
      champion: typeof o.champion === 'string' ? o.champion.slice(0, 40) : '',
      championTeam: typeof o.championTeam === 'string' && field.some((t) => t.id === o.championTeam) ? o.championTeam : '',
      ...(cleanSeasonReport(o.report) ? { report: cleanSeasonReport(o.report) } : {}),
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
