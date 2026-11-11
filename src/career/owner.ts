import { CAREER, YOU_ID } from '../config/career.ts';
import type { CareerSave, RoundResult } from './career.ts';
import { teamsFor } from './roster.ts';

export interface OwnerState {
  selected: string;
  cash: number;
  earned: number;
  spent: number;
  development: number;
  facilities: number;
  project: boolean;
  target?: number;
  research?: { id: string; remaining: number };
  sponsor?: string;
  ledger?: { label: string; amount: number; season: number; round: number }[];
}

export const RESEARCH = [
  { id: 'sprint', name: 'Rapid iteration', tag: 'QUICK TURNAROUND', cost: 1_200_000, gain: 0.018, rounds: 1, description: 'A focused update. Smaller gains, ready for the next round.' },
  { id: 'balanced', name: 'Performance package', tag: 'BALANCED DEVELOPMENT', cost: 2_000_000, gain: 0.035, rounds: 1, description: 'A complete refinement of the car. Your dependable route up the grid.' },
  { id: 'concept', name: 'Next-generation chassis', tag: 'LONG-TERM INVESTMENT', cost: 3_800_000, gain: 0.065, rounds: 3, description: 'A bigger step forward. Commit now and deliver after three rounds.' },
] as const;

export const SPONSORS = [
  { id: 'atlas', name: 'Atlas Systems', category: 'TECHNOLOGY PARTNER', base: 1_000_000, perPoint: 35_000, bonus: 0, target: 0, description: 'Reliable funding, with a balanced reward for every point.' },
  { id: 'vector', name: 'Vector Energy', category: 'PERFORMANCE PARTNER', base: 700_000, perPoint: 45_000, bonus: 450_000, target: 10, description: 'Back your pace. Score 10 team points for an extra $450k each race.' },
  { id: 'meridian', name: 'Meridian Group', category: 'TITLE PARTNER', base: 1_300_000, perPoint: 15_000, bonus: 0, target: 0, description: 'A higher guaranteed payment. More security, less upside.' },
] as const;

export function sponsorFor(save: CareerSave) {
  return SPONSORS.find((s) => s.id === save.owner?.sponsor) ?? SPONSORS[0];
}

export function signSponsor(save: CareerSave, id: string): boolean {
  if (!save.owner || save.done.length || !SPONSORS.some((s) => s.id === id)) return false;
  save.owner.sponsor = id;
  return true;
}

function transaction(save: CareerSave, label: string, amount: number): void {
  const o = save.owner!;
  o.ledger ??= [];
  o.ledger.unshift({ label, amount, season: save.season, round: save.done.length });
  o.ledger = o.ledger.slice(0, 20);
}

export const money = (n: number): string => n > 0 && n < 1_000_000 ? `$${Math.round(n / 1000)}k` : `$${(n / 1_000_000).toFixed(2)}m`;

/** Converts a driver career without losing either car's results or its saved grid. */
export function takeOwnership(save: CareerSave): OwnerState {
  if (save.owner) return save.owner;
  const seats = teamsFor(save).find((t) => t.id === save.team)!.drivers;
  const replace = (id: string) => id === YOU_ID ? seats[1] : id;
  for (const r of save.done) {
    r.order = r.order.map(replace);
    r.dnf = r.dnf.map(replace);
    if (r.fastest) r.fastest = replace(r.fastest);
    if (r.pole) r.pole = replace(r.pole);
  }
  if (save.grid) save.grid = save.grid.map(replace);
  const target = Object.values(save.cars).filter((rating) => rating > save.cars[save.team]).length + 1;
  return save.owner = { selected: seats[1], cash: 8_000_000, earned: 0, spent: 0, development: 0, facilities: 0, project: false, target };
}

/** Selection changes control, never identities, the grid or championship points. */
export function selectDriver(save: CareerSave, id: string): boolean {
  const owner = save.owner;
  if (!owner || !teamsFor(save).find((t) => t.id === save.team)?.drivers.includes(id)) return false;
  owner.selected = id;
  return true;
}

export function developmentCost(save: CareerSave, id = 'balanced'): number {
  return (RESEARCH.find((r) => r.id === id)?.cost ?? RESEARCH[1].cost) + (save.owner?.development ?? 0) * 750_000;
}

export function researchBlocker(save: CareerSave, id = 'balanced'): string | null {
  const o = save.owner;
  const spec = RESEARCH.find((r) => r.id === id);
  if (!o || !spec) return 'Unavailable';
  if (o.project) return 'Workshop occupied';
  if (o.development >= 5) return 'Season programme complete';
  if (save.cars[save.team] >= 1) return 'Car is at the performance ceiling';
  if (spec.rounds > save.calendar.length - save.done.length) return 'Not enough rounds left this season';
  if (o.cash < developmentCost(save, id)) return 'Insufficient funds';
  return null;
}

export function commissionDevelopment(save: CareerSave, id = 'balanced'): boolean {
  if (researchBlocker(save, id)) return false;
  const o = save.owner!;
  const spec = RESEARCH.find((r) => r.id === id)!;
  const cost = developmentCost(save, id);
  o.cash -= cost;
  o.spent += cost;
  o.project = true;
  o.research = { id, remaining: spec.rounds };
  transaction(save, spec.name, -cost);
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
  transaction(save, `Headquarters · level ${o.facilities}`, -cost);
  return true;
}

/** Called only when a new round is recorded, so replaying screens cannot pay twice. */
export function settleOwnerRound(save: CareerSave, result: RoundResult): void {
  const o = save.owner;
  if (!o) return;
  const seats = teamsFor(save).find((t) => t.id === save.team)!.drivers;
  const pts = seats.reduce((n, id) => {
    const pos = result.order.indexOf(id);
    return n + (result.dnf.includes(id) || pos < 0 ? 0 : CAREER.points[pos] ?? 0);
  }, 0);
  const sponsor = sponsorFor(save);
  const income = sponsor.base + o.facilities * 250_000 + pts * sponsor.perPoint + (sponsor.target && pts >= sponsor.target ? sponsor.bonus : 0);
  o.cash += income;
  o.earned += income;
  transaction(save, `Round ${save.done.length} · ${pts} team points`, income);
  if (o.project) {
    if (o.research) o.research.remaining--;
    if (!o.research || o.research.remaining <= 0) {
      const spec = RESEARCH.find((r) => r.id === o.research?.id) ?? RESEARCH[1];
      save.cars[save.team] = Math.min(1, save.cars[save.team] + spec.gain);
      o.development++;
      o.project = false;
      delete o.research;
    }
  }
}

/** Validate optional owner data before the line-up reads the selected driver. */
export function cleanOwner(raw: unknown, team: string, teamSeats?: readonly [string, string]): OwnerState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const seats = teamSeats ?? CAREER.teams.find((t) => t.id === team)!.drivers;
  const num = (key: string, max = 1e12) => typeof r[key] === 'number' && Number.isFinite(r[key]) ? Math.max(0, Math.min(max, r[key] as number)) : 0;
  const owner: OwnerState = {
    selected: typeof r.selected === 'string' && seats.includes(r.selected) ? r.selected : seats[1],
    cash: num('cash'), earned: num('earned'), spent: num('spent'),
    development: Math.floor(num('development', 5)), facilities: Math.floor(num('facilities', 3)), project: r.project === true,
  };
  if (typeof r.target === 'number' && Number.isFinite(r.target)) owner.target = Math.max(1, Math.min(12, Math.floor(r.target)));
  if (typeof r.sponsor === 'string' && SPONSORS.some((s) => s.id === r.sponsor)) owner.sponsor = r.sponsor;
  if (r.research && typeof r.research === 'object' && owner.project) {
    const raw = r.research as Record<string, unknown>;
    const spec = RESEARCH.find((p) => p.id === raw.id);
    if (spec) owner.research = { id: spec.id, remaining: typeof raw.remaining === 'number' && Number.isFinite(raw.remaining) ? Math.max(1, Math.min(spec.rounds, Math.floor(raw.remaining))) : spec.rounds };
  }
  if (Array.isArray(r.ledger)) owner.ledger = r.ledger.filter((x) => x && typeof x === 'object' && typeof x.label === 'string' && typeof x.amount === 'number' && Number.isFinite(x.amount)).slice(0, 20).map((x) => ({ label: x.label.slice(0, 80), amount: Math.max(-1e12, Math.min(1e12, x.amount)), season: typeof x.season === 'number' && Number.isFinite(x.season) ? Math.max(1, Math.floor(x.season)) : 1, round: typeof x.round === 'number' && Number.isFinite(x.round) ? Math.max(0, Math.floor(x.round)) : 0 }));
  return owner;
}
