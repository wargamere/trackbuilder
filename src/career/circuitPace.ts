import type { CarPerformance } from '../car/physics.ts';
import { DEVELOPMENT } from '../config/development.ts';
import { aiPace } from '../race/ai.ts';
import { carPace, planLapTime, racingLine, roadPace, speedProfile } from '../race/racingLine.ts';
import { suggestedSetup } from '../race/strategy.ts';
import type { Track } from '../track/track.ts';
import { areaPhysics, CAR_AREAS, seatAreas, teamAreas, type AreaRatings, type CarArea } from './carAreas.ts';
import type { CareerSave } from './career.ts';
import { PARTS } from './engineering.ts';
import { teamsFor } from './roster.ts';

/**
 * What the cars are worth at a circuit: each car's lap planned by the same
 * driver (DEVELOPMENT.referencePace) along the racing line, with that car's
 * grip, engine pull and top speed, so the gaps are the cars' alone; how much
 * the circuit rewards each area; and what a part would give there. Uses the
 * AI's own speed planner, not a formula: a power circuit rewards the power
 * unit because its straights are long, nothing more.
 */

const laps = new Map<string, number>();

/** A planned lap of `track` (s) with car `tune`. */
export function plannedLap(track: Track, tune: CarPerformance): number {
  const key = `${track.def.id}|${tune.grip}|${tune.pull}|${tune.top}`;
  const known = laps.get(key);
  if (known !== undefined) return known;
  const line = racingLine(track);
  const pace = roadPace(carPace(aiPace(DEVELOPMENT.referencePace, track), suggestedSetup(track), tune), track);
  const lap = planLapTime(line, speedProfile(track, line, pace));
  if (laps.size > 400) laps.clear();
  laps.set(key, lap);
  return lap;
}

/** A car's lap with these areas. */
const lapWith = (track: Track, a: AreaRatings) => plannedLap(track, areaPhysics(a));

/**
 * How much `track` rewards each area: the time the same step in each one
 * saves on a lap there, as shares (they add up to 1), and the time itself
 * (s per lap for DEVELOPMENT.probe rating points).
 */
export function circuitDemand(save: CareerSave, track: Track): { share: AreaRatings; seconds: AreaRatings } {
  const base = teamAreas(save, save.team);
  const lap = lapWith(track, base);
  const seconds = { aero: 0, chassis: 0, powertrain: 0 };
  for (const area of CAR_AREAS) seconds[area] = Math.max(0, lap - lapWith(track, { ...base, [area]: base[area] + DEVELOPMENT.probe }));
  const total = seconds.aero + seconds.chassis + seconds.powertrain || 1;
  return { share: { aero: seconds.aero / total, chassis: seconds.chassis / total, powertrain: seconds.powertrain / total }, seconds };
}

/** One car in the projected order at a circuit. */
export interface ProjectedCar {
  team: string;
  /** For your team, which car (0 or 1); null for a rival (both its cars are the same). */
  seat: 0 | 1 | null;
  areas: AreaRatings;
  lap: number;
}

/** Every car's planned lap at `track`, quickest first: one row a rival team, one for each of your two cars. */
export function projectedOrder(save: CareerSave, track: Track): ProjectedCar[] {
  const rows: ProjectedCar[] = [];
  for (const t of teamsFor(save)) {
    if (t.id === save.team) {
      t.drivers.forEach((id, seat) => {
        const areas = seatAreas(save, t.id, id);
        rows.push({ team: t.id, seat: seat as 0 | 1, areas, lap: lapWith(track, areas) });
      });
    } else {
      const areas = teamAreas(save, t.id);
      rows.push({ team: t.id, seat: null, areas, lap: lapWith(track, areas) });
    }
  }
  return rows.sort((a, b) => a.lap - b.lap);
}

/** What fitting part `partId` to your car `seat` would save per lap at `track` (s; 0 for a durability part). */
export function partLapGain(save: CareerSave, partId: string, seat: 0 | 1, track: Track, multiplier = 1): number {
  const part = PARTS.find((p) => p.id === partId);
  if (!part || part.area === 'durability') return 0;
  const id = teamsFor(save).find((t) => t.id === save.team)!.drivers[seat];
  const areas = seatAreas(save, save.team, id);
  const area = part.area as CarArea;
  const fitted = { ...areas, [area]: areas[area] + part.effect * multiplier * DEVELOPMENT.partScale };
  return Math.max(0, lapWith(track, areas) - lapWith(track, fitted));
}
