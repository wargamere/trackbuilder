import { CAREER } from '../config/career.ts';
import { clamp } from '../core/math.ts';
import { hashString, rng } from '../core/random.ts';
import type { CareerSave } from './career.ts';
import { driverProgress, researchDiscount, researchMultiplier, staffMember } from './dynasty.ts';
import { driverDef, teamsFor } from './roster.ts';

export type EngineeringArea = 'aero' | 'chassis' | 'powertrain' | 'durability';
export type EngineeringGains = Record<EngineeringArea, number>;
const noGains = (): EngineeringGains => ({ aero: 0, chassis: 0, powertrain: 0, durability: 0 });
export type EngineeringFacility = 'research' | 'manufacturing' | 'quality';
export interface PartDefinition { id: string; area: EngineeringArea; name: string; tier: number; rp: number; cost: number; researchDays: number; buildDays: number; effect: number; requires: string | null }
export interface EngineeringJob { id: number; part: string; days: number; total: number; copies: number; risk: number; cost: number; multiplier: number }
export interface EngineeringState {
  /** Previous seasons' integrated knowledge, attached to cars rather than drivers. */
  baseline?: [EngineeringGains, EngineeringGains];
  v: 1; rp: number; day: number; advanced: string; serial: number;
  researched: string[]; designs: Record<string, number>; research: EngineeringJob[]; production: EngineeringJob[];
  stock: Record<string, number>; fitted: [string[], string[]]; workforce: number;
  facilities: Record<EngineeringFacility, number>;
  capSeason: number; capStartSpent: number;
  practice: { key: string; laps: number; best: number | null; rewards: string[] };
  regulation?: { season: number; area: EngineeringArea; adapted: string[] };
  history: { season: number; round: number; title: string; detail: string }[];
}
export const ENGINEERING_AREAS: { id: EngineeringArea; name: string; effect: string }[] = [
  { id: 'aero', name: 'Aerodynamics', effect: 'Cornering grip and aerodynamic efficiency' },
  { id: 'chassis', name: 'Chassis', effect: 'Grip, balance and acceleration' },
  { id: 'powertrain', name: 'Powertrain', effect: 'Engine pull and top speed' },
  { id: 'durability', name: 'Durability', effect: 'Lower mechanical failure risk for AI-controlled cars' },
];
const branches: [EngineeringArea, string[]][] = [
  ['aero', ['Front wing profiles', 'Underfloor channels', 'Rear diffuser', 'Integrated aero package']],
  ['chassis', ['Weight reduction', 'Suspension geometry', 'Brake cooling', 'Lightweight monocoque']],
  ['powertrain', ['Combustion efficiency', 'Energy recovery', 'Turbo optimisation', 'Energy deployment']],
  ['durability', ['Cooling installation', 'Gearbox lubrication', 'Control electronics', 'Endurance package']],
];
export const PARTS: readonly PartDefinition[] = branches.flatMap(([area, names]) => names.map((name, i) => ({
  id: `${area}-${i + 1}`, area, name, tier: i + 1, rp: [450, 800, 1250, 1850][i], cost: [400_000, 650_000, 950_000, 1_400_000][i],
  researchDays: [7, 14, 21, 28][i], buildDays: [7, 10, 14, 18][i], effect: area === 'durability' ? [.003, .004, .005, .006][i] : [.012, .017, .022, .028][i], requires: i ? `${area}-${i}` : null,
})));
const partById = (id: string) => PARTS.find((p) => p.id === id);
const seats = (save: CareerSave) => teamsFor(save).find((t) => t.id === save.team)!.drivers;
const key = (save: CareerSave) => `${save.season}:${save.done.length}`;
const open = (save: CareerSave) => !!save.owner && save.grid === null && save.done.length < save.calendar.length;
export function engineering(save: CareerSave): EngineeringState {
  if (!save.owner) throw Error('Engineering requires an owner career');
  return save.owner.engineering ??= { v: 1, rp: 850, day: save.done.length * 14, advanced: '', serial: 0, researched: [], designs: {}, research: [], production: [], stock: {}, fitted: [[], []], workforce: 20,
    facilities: { research: 0, manufacturing: 0, quality: 0 }, capSeason: save.season, capStartSpent: save.owner.spent, practice: { key: '', laps: 0, best: null, rewards: [] }, history: [] };
}
function log(save: CareerSave, title: string, detail: string): void { const e = engineering(save); e.history.unshift({ season: save.season, round: save.done.length + 1, title, detail }); e.history = e.history.slice(0, 60); }
export const costCap = (save: CareerSave) => save.calendar.length * 4_000_000;
export const capSpent = (save: CareerSave) => Math.max(0, (save.owner?.spent ?? 0) - (save.owner?.engineering?.capStartSpent ?? save.owner?.spent ?? 0));
function pay(save: CareerSave, amount: number, label: string): boolean {
  const o = save.owner!;
  if (amount < 0 || !Number.isFinite(amount) || o.cash < amount || capSpent(save) + amount > costCap(save)) return false;
  o.cash -= amount; o.spent += amount; o.ledger ??= []; o.ledger.unshift({ label, amount: -amount, season: save.season, round: save.done.length }); o.ledger = o.ledger.slice(0, 20); return true;
}
export function engineeringCapacity(save: CareerSave, type: 'research' | 'production'): number {
  const e = engineering(save); return 1 + Math.floor(e.facilities[type === 'research' ? 'research' : 'manufacturing'] / 2);
}
export function researchPrice(save: CareerSave, id: string): number { return Math.round((partById(id)?.rp ?? 0) * (1 - researchDiscount(save))); }
function speed(save: CareerSave, type: 'research' | 'manufacturing'): number {
  const e = engineering(save); return Math.max(.45, 1 - (e.workforce - 20) * .004 - e.facilities[type] * .08 - (staffMember(save, 'technical')?.level ?? 0) * .03);
}
export function researchDays(save: CareerSave, id: string): number { return Math.max(3, Math.ceil((partById(id)?.researchDays ?? 7) * speed(save, 'research'))); }
export function buildQuote(save: CareerSave, id: string, copies: 1 | 2, rushed = false): { cost: number; days: number; risk: number } {
  const e = engineering(save), p = partById(id);
  return { cost: Math.round((p?.cost ?? 0) * (copies === 2 ? 1.65 : 1) * (rushed ? 1.4 : 1) / 1000) * 1000,
    days: Math.max(3, Math.ceil(((p?.buildDays ?? 7) * (copies === 2 ? 1.7 : 1) + (copies === 2 ? 7 : 0)) * speed(save, 'manufacturing') * (rushed ? .65 : 1))),
    risk: clamp(.08 + (rushed ? .15 : 0) - e.facilities.quality * .018 - (e.workforce - 20) * .0004 - (staffMember(save, 'technical')?.level ?? 0) * .008, .01, .3) };
}
export function researchBlock(save: CareerSave, id: string): string | null {
  const e = engineering(save), p = partById(id);
  if (!p) return 'Unknown part'; if (!open(save)) return 'Available before qualifying';
  if (e.researched.includes(id)) return 'Researched'; if (e.research.some((j) => j.part === id)) return 'Research in progress';
  if (p.requires && !e.researched.includes(p.requires)) return `Research ${partById(p.requires)!.name} first`;
  if (e.research.length >= engineeringCapacity(save, 'research')) return 'Research capacity occupied';
  if (e.rp < researchPrice(save, id)) return 'Insufficient resource points'; return null;
}
export function startResearch(save: CareerSave, id: string): boolean {
  if (researchBlock(save, id)) return false;
  const e = engineering(save), days = researchDays(save, id), multiplier = researchMultiplier(save);
  const price = researchPrice(save, id);
  e.rp -= price; e.research.push({ id: ++e.serial, part: id, days, total: days, copies: 0, risk: 0, cost: price, multiplier });
  if (save.owner!.world) save.owner!.world.insight = 0;
  log(save, `Research started: ${partById(id)!.name}`, `${days} days. A completed design must be manufactured before it can improve either car.`); return true;
}
export function copiesNeeded(save: CareerSave, id: string): number {
  const e = engineering(save); return Math.max(0, 2 - e.fitted.filter((car) => car.includes(id)).length - (e.stock[id] ?? 0) - e.production.filter((j) => j.part === id).reduce((sum, j) => sum + j.copies, 0));
}
export function buildBlock(save: CareerSave, id: string, copies: 1 | 2, rushed = false): string | null {
  const e = engineering(save), q = buildQuote(save, id, copies, rushed);
  if (!partById(id) || !e.researched.includes(id)) return 'Research this part first'; if (!open(save)) return 'Available before qualifying';
  if (copiesNeeded(save, id) < copies) return 'Enough copies are already built or ordered';
  if (e.production.length >= engineeringCapacity(save, 'production')) return 'Manufacturing capacity occupied';
  if (save.owner!.cash < q.cost) return 'Insufficient funds'; if (capSpent(save) + q.cost > costCap(save)) return 'Season cost cap reached'; return null;
}
export function manufacture(save: CareerSave, id: string, copies: 1 | 2, rushed = false): boolean {
  if (![1, 2].includes(copies) || buildBlock(save, id, copies, rushed)) return false;
  const e = engineering(save), q = buildQuote(save, id, copies, rushed);
  if (!pay(save, q.cost, `${partById(id)!.name} · ${copies} ${rushed ? 'rushed ' : ''}copies`)) return false;
  e.production.push({ id: ++e.serial, part: id, days: q.days, total: q.days, copies, risk: q.risk, cost: q.cost, multiplier: e.designs[id] ?? 1 });
  log(save, `Manufacturing: ${partById(id)!.name}`, `${copies} copies ordered. ${q.days} days; ${(q.risk * 100).toFixed(1)}% failure risk per copy.`); return true;
}
export function assignBlock(save: CareerSave, id: string, seat: 0 | 1): string | null {
  const e = engineering(save), p = partById(id);
  if (!p || !open(save)) return 'Available before qualifying';
  if (e.fitted[seat].includes(id)) return 'Fitted'; if (!(e.stock[id] > 0)) return 'No manufactured copy available';
  if (p.requires && !e.fitted[seat].includes(p.requires)) return `Fit ${partById(p.requires)!.name} first`; return null;
}
export function assignUpgrade(save: CareerSave, id: string, seat: 0 | 1): boolean {
  if (![0, 1].includes(seat) || assignBlock(save, id, seat)) return false;
  const e = engineering(save); e.stock[id]--; e.fitted[seat].push(id);
  const ids = seats(save);
  if (save.owner!.world) for (const driver of ids) save.owner!.world.drivers[driver] ??= driverProgress(save, driver);
  const mine = driverProgress(save, ids[seat]), other = driverProgress(save, ids[1 - seat]);
  const equal = e.fitted[1 - seat].includes(id);
  mine.morale = clamp(mine.morale + (equal ? 3 : 1), 0, 100); if (!equal) other.morale = Math.max(0, other.morale - 3);
  log(save, `${partById(id)!.name} fitted to car ${seat + 1}`, `${driverDef(ids[seat])!.name} receives the upgrade. ${equal ? 'Both cars now have this part.' : 'The other driver loses 3 morale until you balance future investment.'}`); return true;
}
export function carDevelopment(save: Pick<CareerSave, 'owner'> & Partial<Pick<CareerSave, 'team' | 'roster' | 'entry'>>, id: string): Record<EngineeringArea, number> {
  const result = { aero: 0, chassis: 0, powertrain: 0, durability: 0 }, e = save.owner?.engineering;
  if (!e || !save.team) return result;
  const index = teamsFor(save).find((t) => t.id === save.team)?.drivers.indexOf(id) ?? -1;
  if (index < 0) return result;
  if (e.baseline) Object.assign(result, e.baseline[index]);
  for (const fitted of e.fitted[index]) { const p = partById(fitted); if (p) result[p.area] += p.effect * (e.designs[fitted] ?? 1); }
  return result;
}
export function performanceGain(save: Pick<CareerSave, 'owner'> & Partial<Pick<CareerSave, 'team' | 'roster' | 'entry'>>, id: string): number {
  const p = carDevelopment(save, id); return p.aero + p.chassis + p.powertrain;
}
export function teamDevelopment(save: Pick<CareerSave, 'owner'> & Partial<Pick<CareerSave, 'team' | 'roster' | 'entry'>>): number {
  if (!save.team || !save.owner?.engineering) return 0;
  const ids = teamsFor(save).find((t) => t.id === save.team)!.drivers; return (performanceGain(save, ids[0]) + performanceGain(save, ids[1])) / 2;
}
export function resourceIncome(save: CareerSave): number {
  const scores = teamsFor(save).map((t) => {
    const places: number[] = []; let points = 0;
    for (const r of save.done) for (const id of t.drivers) { const index = r.order.indexOf(id); if (index >= 0 && !r.dnf.includes(id)) { points += CAREER.points[index] ?? 0; places[index] = (places[index] ?? 0) + 1; } }
    return { id: t.id, points, places };
  });
  scores.sort((a, b) => { if (a.points !== b.points) return b.points - a.points; for (let i = 0; i < 24; i++) { const difference = (b.places[i] ?? 0) - (a.places[i] ?? 0); if (difference) return difference; } return 0; });
  const position = scores.findIndex((t) => t.id === save.team) + 1;
  return 250 + position * 25 + engineering(save).workforce * 3;
}
export function advanceToWeekend(save: CareerSave, completing = false): boolean {
  if (!save.owner || save.done.length >= save.calendar.length || (!completing && !open(save))) return false;
  const e = engineering(save); if (e.advanced === key(save)) return false;
  e.advanced = key(save); e.day += 14; const income = resourceIncome(save); e.rp = Math.min(100_000, e.rp + income);
  log(save, 'Engineering resources received', `+${income} resource points. Your championship position and workforce determine this income.`);
  for (const j of e.research) j.days -= 14;
  for (const j of e.research.filter((j) => j.days <= 0)) { e.researched.push(j.part); e.designs[j.part] = j.multiplier; log(save, `Design ready: ${partById(j.part)!.name}`, 'Research complete. Manufacture copies in Development, then fit them in Assign upgrades.'); }
  e.research = e.research.filter((j) => j.days > 0);
  for (const j of e.production) j.days -= 14;
  for (const j of e.production.filter((j) => j.days <= 0)) {
    let passed = 0; for (let i = 0; i < j.copies; i++) if (rng(hashString(`${save.seed}:factory:${j.id}:${i}`))() >= j.risk) passed++;
    e.stock[j.part] = (e.stock[j.part] ?? 0) + passed;
    log(save, passed === j.copies ? `Parts ready: ${partById(j.part)!.name}` : `Manufacturing setback: ${partById(j.part)!.name}`, `${passed}/${j.copies} copies passed quality control. ${passed ? 'Assign the available parts to your cars.' : 'The design is retained; order replacement copies.'}`);
  }
  e.production = e.production.filter((j) => j.days > 0); return true;
}
export function awardPractice(save: CareerSave, lap: number, reference: number): number {
  if (!open(save) || !Number.isFinite(lap) || lap <= 0 || !Number.isFinite(reference) || reference <= 0) return 0;
  const e = engineering(save); if (e.practice.key !== key(save)) e.practice = { key: key(save), laps: 0, best: null, rewards: [] };
  const p = e.practice; p.laps = Math.min(3, p.laps + 1); p.best = Math.min(p.best ?? Infinity, lap); let earned = 0;
  for (const [id, condition, reward] of [['clean-lap', true, 100], ['qualifying-pace', p.best <= reference * 1.12, 150], ['race-run', p.laps >= 3, 200]] as const) if (condition && !p.rewards.includes(id)) { p.rewards.push(id); earned += reward; }
  e.rp = Math.min(100_000, e.rp + earned); if (earned) log(save, 'Practice programme complete', `+${earned} RP from valid practice laps. Each programme pays once per weekend.`); return earned;
}
export function setWorkforce(save: CareerSave, count: number): boolean {
  if (!open(save) || !Number.isInteger(count) || count < 20 || count > 100 || count % 10) return false;
  const e = engineering(save); if (count === e.workforce) return false;
  if (count > e.workforce && !pay(save, (count - e.workforce) * 10_000, 'Engineering recruitment')) return false;
  e.workforce = count; return true;
}
export function facilityPrice(save: CareerSave, id: EngineeringFacility): number { return (engineering(save).facilities[id] + 1) * 900_000; }
export function improveEngineering(save: CareerSave, id: EngineeringFacility): boolean {
  if (!open(save) || !['research', 'manufacturing', 'quality'].includes(id)) return false;
  const e = engineering(save); if (e.facilities[id] >= 3 || !pay(save, facilityPrice(save, id), `Engineering facility · ${id}`)) return false;
  e.facilities[id]++; return true;
}
export function announceRegulations(save: CareerSave): void {
  if (!save.owner?.engineering || save.done.length < save.calendar.length - 3) return;
  const e = engineering(save); if (e.regulation?.season === save.season + 1) return;
  const area = ENGINEERING_AREAS[hashString(`${save.seed}:${save.season + 1}:regulation`) % 4].id;
  e.regulation = { season: save.season + 1, area, adapted: [] }; log(save, 'Next season’s regulation change', `${ENGINEERING_AREAS.find((a) => a.id === area)!.name} designs must be adapted with RP before the season ends to keep those upgrades.`);
}
export function adaptPart(save: CareerSave, id: string): boolean {
  const e = engineering(save), p = partById(id), r = e.regulation;
  if (!open(save) || !p || !r || r.area !== p.area || !e.researched.includes(id) || r.adapted.includes(id)) return false;
  const cost = Math.ceil(p.rp * .45); if (e.rp < cost) return false; e.rp -= cost; r.adapted.push(id); log(save, `Adapted: ${p.name}`, 'This design and its fitted copies are protected for next season.'); return true;
}
export function startEngineeringSeason(save: CareerSave): void {
  const e = save.owner?.engineering; if (!e) return;
  const lost = PARTS.filter((p) => e.regulation?.season === save.season && e.regulation.area === p.area && !e.regulation.adapted.includes(p.id)).map((p) => p.id);
  const baseline = e.baseline ?? [noGains(), noGains()];
  for (const seat of [0, 1] as const) for (const id of e.fitted[seat]) {
    const p = partById(id)!;
    if (!lost.includes(id)) baseline[seat][p.area] += p.effect * (e.designs[id] ?? 1);
  }
  // Refund the unfinished share of commissioned work instead of deleting paid value.
  const salvage = PARTS.reduce((sum, p) => sum + (e.stock[p.id] ?? 0) * p.cost * .5, 0);
  const refund = Math.round(salvage + e.production.reduce((sum, j) => sum + j.cost * j.days / j.total, 0));
  const returnedRP = Math.round(e.research.reduce((sum, j) => sum + (j.cost || partById(j.part)!.rp) * j.days / j.total, 0));
  if (refund) {
    save.owner!.cash += refund; save.owner!.spent = Math.max(0, save.owner!.spent - refund);
    save.owner!.ledger ??= []; save.owner!.ledger.unshift({ label: 'Offseason manufacturing refund', amount: refund, season: save.season, round: 0 });
    save.owner!.ledger = save.owner!.ledger.slice(0, 20);
  }
  e.rp = Math.min(100_000, e.rp + returnedRP);
  e.baseline = baseline; e.researched = []; e.designs = {}; e.fitted = [[], []]; e.stock = {}; e.research = []; e.production = [];
  delete e.regulation; e.capSeason = save.season; e.capStartSpent = save.owner!.spent; e.advanced = ''; e.practice = { key: '', laps: 0, best: null, rewards: [] };
  log(save, 'A new car, built on your progress', `Retained fitted gains are integrated into the cars' foundations. The research tree starts at minor upgrades again. ${returnedRP} unused RP returned; $${refund.toLocaleString()} unfinished manufacturing refunded.`);
}

export function cleanEngineering(raw: unknown): EngineeringState | undefined {
  if (!raw || typeof raw !== 'object' || (raw as { v?: number }).v !== 1) return undefined;
  const obj = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
  const r = obj(raw), n = (x: unknown, lo: number, hi: number, fallback = lo) => typeof x === 'number' && Number.isFinite(x) ? clamp(x, lo, hi) : fallback;
  const ids = (x: unknown) => Array.isArray(x) ? [...new Set(x.filter((id): id is string => typeof id === 'string' && !!partById(id)))] : [];
  const f = obj(r.facilities), p = obj(r.practice), reg = obj(r.regulation);
  const e: EngineeringState = { v: 1, rp: Math.floor(n(r.rp, 0, 100_000)), day: Math.floor(n(r.day, 0, 1e7)), advanced: typeof r.advanced === 'string' ? r.advanced.slice(0, 30) : '', serial: Math.floor(n(r.serial, 0, 1e9)), researched: ids(r.researched), designs: {}, research: [], production: [], stock: {}, fitted: [[], []], workforce: Math.round(n(r.workforce, 20, 100, 20) / 10) * 10,
    facilities: { research: Math.floor(n(f.research, 0, 3)), manufacturing: Math.floor(n(f.manufacturing, 0, 3)), quality: Math.floor(n(f.quality, 0, 3)) }, capSeason: Math.floor(n(r.capSeason, 1, 9999)), capStartSpent: n(r.capStartSpent, 0, 1e12),
    practice: { key: typeof p.key === 'string' ? p.key.slice(0, 30) : '', laps: Math.floor(n(p.laps, 0, 3)), best: typeof p.best === 'number' && Number.isFinite(p.best) && p.best > 0 ? p.best : null, rewards: Array.isArray(p.rewards) ? [...new Set(p.rewards.filter((id): id is string => ['clean-lap', 'qualifying-pace', 'race-run'].includes(id as string)))] : [] }, history: [] };
  if (Array.isArray(r.baseline) && r.baseline.length === 2) e.baseline = r.baseline.map(x => Object.fromEntries(ENGINEERING_AREAS.map(a => [a.id, n(obj(x)[a.id], 0, 100)]))) as [EngineeringGains, EngineeringGains];
  for (const id of e.researched) e.designs[id] = n(obj(r.designs)[id], 1, 1.4, 1);
  if (Array.isArray(r.fitted)) for (const i of [0, 1] as const) e.fitted[i] = ids(r.fitted[i]).filter((id) => e.researched.includes(id));
  for (const id of e.researched) if (Object.hasOwn(obj(r.stock), id)) e.stock[id] = Math.floor(n(obj(r.stock)[id], 0, 2 - e.fitted.filter((car) => car.includes(id)).length));
  for (const type of ['research', 'production'] as const) if (Array.isArray(r[type])) for (const item of (r[type] as unknown[]).slice(0, 2)) {
    const j = obj(item), id = j.part as string; if (!partById(id) || (type === 'research' ? e.researched.includes(id) || e.research.some((a) => a.part === id) : !e.researched.includes(id)) || e[type].some((a) => a.id === j.id)) continue;
    const remaining = type === 'production' ? 2 - e.fitted.filter((car) => car.includes(id)).length - (e.stock[id] ?? 0) - e.production.filter((job) => job.part === id).reduce((sum, job) => sum + job.copies, 0) : 2;
    if (remaining <= 0) continue;
    const total = Math.floor(n(j.total, 1, 1000)); e[type].push({ id: Math.floor(n(j.id, 1, 1e9)), part: id, days: Math.floor(n(j.days, 1, total)), total, copies: type === 'research' ? 0 : Math.floor(n(j.copies, 1, Math.min(2, remaining))), risk: n(j.risk, 0, .3), cost: n(j.cost, 0, 1e9), multiplier: n(j.multiplier, 1, 1.4, 1) });
    e.serial = Math.max(e.serial, e[type].at(-1)!.id);
  }
  if (Number.isInteger(reg.season) && ENGINEERING_AREAS.some((a) => a.id === reg.area)) e.regulation = { season: Math.floor(n(reg.season, 1, 9999)), area: reg.area as EngineeringArea, adapted: ids(reg.adapted).filter((id) => e.researched.includes(id) && partById(id)!.area === reg.area) };
  if (Array.isArray(r.history)) for (const item of r.history.slice(0, 60)) { const a = obj(item); if (typeof a.title === 'string' && typeof a.detail === 'string') e.history.push({ season: Math.floor(n(a.season, 1, 9999)), round: Math.floor(n(a.round, 0, 25)), title: a.title.slice(0, 120), detail: a.detail.slice(0, 320) }); }
  return e;
}
