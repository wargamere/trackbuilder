import { CAREER, type DriverDef, type TeamDef } from '../config/career.ts';
import { GP_DRIVERS, GP_TEAMS, RESERVE_DRIVERS } from '../config/grandPrix.ts';

export interface TeamEntry {
  id: string;
  name: string;
  paint: number;
  secondary: number;
  drivers: [string, string];
}
export interface RosterSave { roster?: 'grandprix'; entry?: TeamEntry; }
export const PRIVATEER_ID = 'privateer';
export const FOUNDING_BUDGET = 12_000_000;
export const allDrivers: readonly DriverDef[] = [...CAREER.drivers, ...GP_DRIVERS, ...RESERVE_DRIVERS];
export const driverDef = (id: string): DriverDef | undefined => allDrivers.find((d) => d.id === id);
export const baseTeams = (save: RosterSave): readonly TeamDef[] => save.roster === 'grandprix' ? GP_TEAMS : CAREER.teams;
export const driverFee = (id: string): number => Math.round((400_000 + 3_200_000 * (driverDef(id)?.skill ?? 0) ** 3) / 10_000) * 10_000;
export const cleanTeamName = (raw: unknown): string => typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 28) || 'My Racing Team' : 'My Racing Team';

/** A career's field, with hired drivers removed from rivals and their vacancies filled. */
export function teamsFor(save: RosterSave): readonly TeamDef[] {
  const base = baseTeams(save);
  if (!save.entry) return base;
  const entry = save.entry;
  const hired = new Set(entry.drivers);
  const used = new Set(base.filter((t) => t.id !== entry.id).flatMap((t) => t.drivers).filter((id) => !hired.has(id)));
  const available = allDrivers.filter((d) => !used.has(d.id) && !hired.has(d.id));
  // Reserves fill the vacated seats before a former driver is recalled.
  available.sort((a, b) => Number(b.id.startsWith('reserve-')) - Number(a.id.startsWith('reserve-')));
  const field = base.map((t): TeamDef => t.id === entry.id ? { ...t, ...entry } : {
    ...t, drivers: t.drivers.map((id) => hired.has(id) ? available.shift()!.id : id) as [string, string],
  });
  if (!field.some((t) => t.id === entry.id)) field.push({ ...entry, car: .38 });
  return field;
}

/** Validate optional custom identity before reading names, colours or driver ids. */
export function cleanEntry(raw: unknown, roster: RosterSave['roster']): TeamEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !(r.id === PRIVATEER_ID || baseTeams({ roster }).some((t) => t.id === r.id))) return undefined;
  const ids = Array.isArray(r.drivers) ? r.drivers.filter((id): id is string => typeof id === 'string' && !!driverDef(id)) : [];
  if (ids.length !== 2 || ids[0] === ids[1]) return undefined;
  const colour = (x: unknown, fallback: number) => typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(0xffffff, Math.round(x))) : fallback;
  return { id: r.id, name: cleanTeamName(r.name), paint: colour(r.paint, 0x7657ed), secondary: colour(r.secondary, 0x61e2be), drivers: [ids[0], ids[1]] };
}
