import { CAREER, YOU_ID } from '../config/career.ts';
import type { CareerSave, RoundResult } from './career.ts';

export interface OwnerState {
  selected: string;
  cash: number;
  earned: number;
  spent: number;
  development: number;
  facilities: number;
  project: boolean;
}

export const money = (n: number): string => `$${(n / 1_000_000).toFixed(2)}m`;

/** Converts a driver career without losing either car's results or its saved grid. */
export function takeOwnership(save: CareerSave): OwnerState {
  if (save.owner) return save.owner;
  const seats = CAREER.teams.find((t) => t.id === save.team)!.drivers;
  const replace = (id: string) => id === YOU_ID ? seats[1] : id;
  for (const r of save.done) {
    r.order = r.order.map(replace);
    r.dnf = r.dnf.map(replace);
    if (r.fastest) r.fastest = replace(r.fastest);
    if (r.pole) r.pole = replace(r.pole);
  }
  if (save.grid) save.grid = save.grid.map(replace);
  return save.owner = { selected: seats[1], cash: 8_000_000, earned: 0, spent: 0, development: 0, facilities: 0, project: false };
}

/** Selection changes control, never identities, the grid or championship points. */
export function selectDriver(save: CareerSave, id: string): boolean {
  const owner = save.owner;
  if (!owner || !CAREER.teams.find((t) => t.id === save.team)?.drivers.includes(id)) return false;
  owner.selected = id;
  return true;
}

export function developmentCost(save: CareerSave): number {
  return 2_000_000 + (save.owner?.development ?? 0) * 750_000;
}

export function commissionDevelopment(save: CareerSave): boolean {
  const o = save.owner;
  const cost = developmentCost(save);
  if (!o || o.project || o.development >= 5 || o.cash < cost || save.done.length >= save.calendar.length) return false;
  o.cash -= cost;
  o.spent += cost;
  o.project = true;
  return true;
}

export function facilityCost(save: CareerSave): number {
  return 1_500_000 * ((save.owner?.facilities ?? 0) + 1);
}

export function expandFacilities(save: CareerSave): boolean {
  const o = save.owner;
  const cost = facilityCost(save);
  if (!o || o.facilities >= 3 || o.cash < cost) return false;
  o.cash -= cost;
  o.spent += cost;
  o.facilities++;
  return true;
}

/** Called only when a new round is recorded, so replaying screens cannot pay twice. */
export function settleOwnerRound(save: CareerSave, result: RoundResult): void {
  const o = save.owner;
  if (!o) return;
  const seats = CAREER.teams.find((t) => t.id === save.team)!.drivers;
  const pts = seats.reduce((n, id) => {
    const pos = result.order.indexOf(id);
    return n + (result.dnf.includes(id) || pos < 0 ? 0 : CAREER.points[pos] ?? 0);
  }, 0);
  const income = 1_000_000 + o.facilities * 250_000 + pts * 35_000;
  o.cash += income;
  o.earned += income;
  if (o.project) {
    save.cars[save.team] = Math.min(1, save.cars[save.team] + 0.035);
    o.development++;
    o.project = false;
  }
}

/** Validate optional owner data before the line-up reads the selected driver. */
export function cleanOwner(raw: unknown, team: string): OwnerState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const seats = CAREER.teams.find((t) => t.id === team)!.drivers;
  const num = (key: string, max = 1e12) => typeof r[key] === 'number' && Number.isFinite(r[key]) ? Math.max(0, Math.min(max, r[key] as number)) : 0;
  return {
    selected: typeof r.selected === 'string' && seats.includes(r.selected) ? r.selected : seats[1],
    cash: num('cash'), earned: num('earned'), spent: num('spent'),
    development: Math.floor(num('development', 5)), facilities: Math.floor(num('facilities', 3)), project: r.project === true,
  };
}
