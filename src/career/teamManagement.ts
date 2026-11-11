import { newCareer, team, type CareerSave } from './career.ts';
import { takeOwnership } from './owner.ts';
import { allDrivers, cleanEntry, cleanTeamName, driverDef, driverFee, FOUNDING_BUDGET, PRIVATEER_ID, teamsFor, type TeamEntry } from './roster.ts';
import type { RaceLength, SeasonLength } from '../config/career.ts';
import { GP_DRIVERS, RESERVE_DRIVERS } from '../config/grandPrix.ts';

export interface CreateTeamOptions {
  principal: string; name: string; paint: number; secondary: number; drivers: [string, string];
  difficulty: number; length: RaceLength; rounds: SeasonLength;
}

function signing(save: CareerSave, id: string): void {
  const o = save.owner!;
  const amount = driverFee(id);
  o.cash -= amount; o.spent += amount;
  o.ledger ??= [];
  o.ledger.unshift({ label: `Signed ${driverDef(id)!.first} ${driverDef(id)!.name}`, amount: -amount, season: save.season, round: 0 });
  o.ledger = o.ledger.slice(0, 20);
}

/** Found a new twelfth team; validate the entire choice before charging either hire. */
export function createCustomCareer(opts: CreateTeamOptions, seed?: number): CareerSave | null {
  if (!opts.name.trim() || !opts.principal.trim()) return null;
  const entry = cleanEntry({ ...opts, id: PRIVATEER_ID }, 'grandprix');
  if (!entry || entry.drivers.some((id) => ![...GP_DRIVERS, ...RESERVE_DRIVERS].some((d) => d.id === id))) return null;
  if (entry.drivers.reduce((sum, id) => sum + driverFee(id), 0) > FOUNDING_BUDGET) return null;
  const save = newCareer({ name: opts.principal, team: 'kestrel', difficulty: opts.difficulty, length: opts.length, rounds: opts.rounds }, seed);
  save.roster = 'grandprix'; save.entry = entry; save.team = PRIVATEER_ID;
  save.cars = Object.fromEntries(teamsFor(save).map((t) => [t.id, t.car]));
  takeOwnership(save).cash = FOUNDING_BUDGET;
  entry.drivers.forEach((id) => signing(save, id));
  return save;
}

/** Rename/repaint an owned team while retaining its driver ids, car and results. */
export function updateTeamIdentity(save: CareerSave, name: string, paint: number, secondary: number): boolean {
  if (!save.owner || !name.trim()) return false;
  const current = team(save.team, save);
  const entry = cleanEntry({ id: save.team, name: cleanTeamName(name), paint, secondary, drivers: [...current.drivers] }, save.roster);
  if (!entry) return false;
  save.entry = entry;
  return true;
}

export const recruitmentOpen = (save: CareerSave): boolean => !!save.owner && save.done.length === 0 && save.grid === null;
export const marketDrivers = (save: CareerSave) => save.roster === 'grandprix' ? [...GP_DRIVERS, ...RESERVE_DRIVERS] : [...allDrivers];

/** Hires are only allowed before qualifying for round one; never rewrite a scored season. */
export function hireDriver(save: CareerSave, seat: 0 | 1, id: string): boolean {
  if (!recruitmentOpen(save) || !marketDrivers(save).some((d) => d.id === id)) return false;
  const current = team(save.team, save);
  if (current.drivers.includes(id) || save.owner!.cash < driverFee(id)) return false;
  const entry: TeamEntry = save.entry ? { ...save.entry, drivers: [...save.entry.drivers] } : {
    id: current.id, name: current.name, paint: current.paint, secondary: current.secondary ?? 0xffffff, drivers: [...current.drivers],
  };
  const previous = entry.drivers[seat];
  entry.drivers[seat] = id;
  save.entry = entry;
  if (save.owner!.selected === previous) save.owner!.selected = id;
  signing(save, id);
  return true;
}
