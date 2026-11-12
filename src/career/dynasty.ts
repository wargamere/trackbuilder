import { CAREER } from '../config/career.ts';
import { clamp } from '../core/math.ts';
import { hashString, rng } from '../core/random.ts';
import type { CareerSave, RoundResult } from './career.ts';
import { driverDef, teamsFor } from './roster.ts';

export type StaffRole = 'technical' | 'coach' | 'engineer';
export type Department = 'laboratory' | 'simulator' | 'commercial';
export type TrainingFocus = 'pace' | 'racecraft' | 'consistency';
export type WeekendApproach = 'balanced' | 'attack' | 'development';
export interface DriverProgress {
  xp: number; pace: number; racecraft: number; consistency: number; morale: number;
  training?: { season: number; round: number; focus: TrainingFocus };
}
export interface TeamNews { id: string; title: string; body: string; kind: 'team' | 'board' | 'rival' | 'milestone'; season: number; round: number }
export interface DynastyState {
  v: 1; confidence: number; reputation: number; fans: number; morale: number; insight: number;
  plan: { season: number; round: number; id: WeekendApproach };
  drivers: Record<string, DriverProgress>;
  staff: Partial<Record<StaffRole, string>>;
  departments: Record<Department, number>;
  decisions: { key: string; template: string; choice: number; season: number; round: number }[];
  news: TeamNews[]; achievements: string[];
  rival: { id: string; won: number; lost: number; tied: number };
  settled: string; reviewed: number;
}

export const STAFF = [
  { id: 'hart', role: 'technical', name: 'Maya Hart', title: 'Technical director', level: 1, fee: 650_000, salary: 90_000, reputation: 0, detail: '8% cheaper research and 6% more performance per package.' },
  { id: 'mercer', role: 'technical', name: 'Ada Mercer', title: 'Technical director', level: 2, fee: 1_600_000, salary: 160_000, reputation: 40, detail: '14% cheaper research and 12% more performance per package.' },
  { id: 'soren', role: 'coach', name: 'Luca Soren', title: 'Driver coach', level: 1, fee: 550_000, salary: 75_000, reputation: 0, detail: '+10 XP to each commissioned driver training programme.' },
  { id: 'kade', role: 'coach', name: 'Rina Kade', title: 'Driver coach', level: 2, fee: 1_400_000, salary: 140_000, reputation: 40, detail: '+20 XP to training and a stronger driver-development programme.' },
  { id: 'vale', role: 'engineer', name: 'Noah Vale', title: 'Race engineer', level: 1, fee: 700_000, salary: 95_000, reputation: 0, detail: 'Reduces your AI cars’ mechanical failure chance by 0.6 percentage points.' },
  { id: 'tan', role: 'engineer', name: 'Esme Tan', title: 'Race engineer', level: 2, fee: 1_750_000, salary: 170_000, reputation: 40, detail: 'Reduces your AI cars’ mechanical failure chance by 1.2 percentage points.' },
] as const;
export const DEPARTMENTS = [
  { id: 'laboratory', name: 'Aerodynamics laboratory', icon: '↗', detail: 'Each level cuts research cost by 3% and increases package gains by 3%. Level 3 shortens long projects by one round.' },
  { id: 'simulator', name: 'Driver performance centre', icon: '◈', detail: 'Each level adds 5 XP to training. Build your two drivers into a lasting advantage.' },
  { id: 'commercial', name: 'Commercial studio', icon: '◎', detail: 'Each level earns $75k and attracts 10% more fans after each race.' },
] as const;
export const TRAINING = [
  { id: 'pace', name: 'Qualifying pace', detail: 'Develop outright speed and improve the driver’s rating.', cost: 220_000 },
  { id: 'racecraft', name: 'Racecraft simulator', detail: 'Develop the driver’s race rating and experience.', cost: 220_000 },
  { id: 'consistency', name: 'Consistency programme', detail: 'Reduce mechanical failure risk when this driver is controlled by AI.', cost: 220_000 },
] as const;
export const APPROACHES = [
  { id: 'balanced', name: 'Balanced weekend', short: 'BALANCED', detail: 'Normal pace, reliability and development. Keep your options open.', pace: 0, risk: 0, work: 1 },
  { id: 'attack', name: 'Maximum attack', short: 'ATTACK', detail: 'More pace from both cars: +0.6 to your AI pace setting and +0.4% engine pull for your car. AI mechanical risk rises by 1.2 percentage points; team morale falls by 2 after the race.', pace: 0.006, risk: 0.012, work: 1 },
  { id: 'development', name: 'Development weekend', short: 'DEVELOP', detail: 'Double workshop progress and +12 XP for both drivers. In return, your AI pace setting falls by 0.6 and your car loses 0.4% engine pull. AI mechanical risk falls by 0.2 percentage points.', pace: -0.006, risk: -0.002, work: 2 },
] as const;
export const ACHIEVEMENTS = [
  ['first-points', 'Off the mark', 'Score your first constructors’ points.'],
  ['first-podium', 'The first champagne', 'Put either team car on a podium.'],
  ['first-win', 'A winning team', 'Win a Grand Prix with your team.'],
  ['constructors-title', 'World champions', 'Win the constructors’ championship.'],
  ['drivers-title', 'The complete package', 'Win the drivers’ championship with either car.'],
  ['rivalry-win', 'Win the battle', 'Finish a season with more head-to-head wins than your rival.'],
  ['developed-driver', 'Homegrown advantage', 'Develop a driver to level three.'],
] as const;

const seats = (save: CareerSave) => teamsFor(save).find((t) => t.id === save.team)!.drivers;
const owned = (save: CareerSave, id: string) => seats(save).includes(id);
const freshDriver = (): DriverProgress => ({ xp: 0, pace: 0, racecraft: 0, consistency: 0, morale: 65 });
const roundKey = (save: CareerSave, round = save.done.length) => `${save.season}:${round}`;
export const managementOpen = (save: CareerSave) => !!save.owner && save.grid === null && save.done.length < save.calendar.length;
function rivalId(save: CareerSave): string {
  const rivals = teamsFor(save).filter((t) => t.id !== save.team);
  rivals.sort((a, b) => Math.abs(save.cars[a.id] - save.cars[save.team]) - Math.abs(save.cars[b.id] - save.cars[save.team]));
  return rivals[0].id;
}
export function createDynasty(save: CareerSave): DynastyState {
  const mine = seats(save), rival = teamsFor(save).find((t) => t.id === rivalId(save))!, achievements: string[] = [];
  const best = Math.min(99, ...save.done.flatMap((r) => mine.map((id) => r.dnf.includes(id) || !r.order.includes(id) ? 99 : r.order.indexOf(id) + 1)));
  if (best <= 10 || save.history.some((s) => s.points > 0)) achievements.push('first-points');
  if (best <= 3 || save.history.some((s) => s.podiums > 0)) achievements.push('first-podium');
  if (best === 1 || save.history.some((s) => s.wins > 0)) achievements.push('first-win');
  if (save.history.some((s) => s.teamPosition === 1)) achievements.push('constructors-title');
  if (save.history.some((s) => s.position === 1)) achievements.push('drivers-title');
  const battle = { id: rival.id, won: 0, lost: 0, tied: 0 };
  for (const r of save.done) { const a = points(r, mine), b = points(r, rival.drivers); if (a > b) battle.won++; else if (a < b) battle.lost++; else battle.tied++; }
  return { v: 1, confidence: 65, reputation: Math.round(15 + (save.cars[save.team] ?? 0.4) * 20), fans: 2000, morale: 65, insight: 0,
    plan: { season: save.season, round: save.done.length, id: 'balanced' }, drivers: Object.fromEntries(mine.map((id) => [id, { ...freshDriver(), xp: Math.min(500, save.done.length * 8) }])),
    staff: {}, departments: { laboratory: 0, simulator: 0, commercial: 0 }, decisions: [], achievements,
    news: [{ id: `welcome:${save.season}`, kind: 'team', title: 'Your team. Your era.', body: 'Choose your staff, develop both drivers and build a team that can fight for championships.', season: save.season, round: save.done.length }],
    rival: battle, settled: roundKey(save), reviewed: save.done.length === save.calendar.length ? save.season : 0 };
}
export function dynasty(save: CareerSave): DynastyState {
  if (!save.owner) throw new Error('An owner career is required');
  return save.owner.world ??= createDynasty(save);
}
export function driverProgress(save: CareerSave, id: string): DriverProgress {
  return save.owner?.world?.drivers[id] ?? freshDriver();
}
export function driverRating(save: CareerSave, id: string): number {
  const p = driverProgress(save, id);
  return clamp((driverDef(id)?.skill ?? 0.5) + Math.floor(p.xp / 100) * 0.008 + p.pace * 0.002 + p.racecraft * 0.001 + (p.morale - 65) * 0.0002, 0, 1);
}
export function weekendApproach(save: CareerSave, round = save.done.length) {
  const plan = save.owner?.world?.plan;
  return APPROACHES.find((p) => p.id === (plan?.season === save.season && plan.round === round ? plan.id : 'balanced')) ?? APPROACHES[0];
}
export function selectApproach(save: CareerSave, id: WeekendApproach): boolean {
  if (!managementOpen(save) || !APPROACHES.some((p) => p.id === id)) return false;
  dynasty(save).plan = { season: save.season, round: save.done.length, id }; return true;
}
export function staffMember(save: CareerSave, role: StaffRole) { return STAFF.find((p) => p.id === save.owner?.world?.staff[role] && p.role === role); }
export function researchDiscount(save: CareerSave): number { return (staffMember(save, 'technical')?.level === 2 ? 0.14 : staffMember(save, 'technical') ? 0.08 : 0) + (save.owner?.world?.departments.laboratory ?? 0) * 0.03; }
export function researchMultiplier(save: CareerSave): number { return 1 + (staffMember(save, 'technical')?.level ?? 0) * 0.06 + (save.owner?.world?.departments.laboratory ?? 0) * 0.03 + (save.owner?.world?.insight ?? 0) * 0.03; }
export function researchDuration(save: CareerSave, rounds: number): number { return Math.max(1, rounds - ((save.owner?.world?.departments.laboratory ?? 0) === 3 && rounds > 1 ? 1 : 0)); }
export function failureChance(save: CareerSave, id: string, round = save.done.length): number {
  if (!save.owner || !owned(save, id)) return CAREER.failure;
  return clamp(CAREER.failure + weekendApproach(save, round).risk - (staffMember(save, 'engineer')?.level ?? 0) * 0.006 - driverProgress(save, id).consistency * 0.0006, 0.004, 0.12);
}
export function operatingCosts(save: CareerSave): number {
  const w = save.owner?.world;
  return w ? STAFF.filter((p) => w.staff[p.role] === p.id).reduce((n, p) => n + p.salary, 0) + Object.values(w.departments).reduce((n, level) => n + level * 25_000, 0) : 0;
}
function book(save: CareerSave, label: string, amount: number): boolean {
  const o = save.owner!;
  if (o.cash + amount < 0) return false;
  o.cash += amount; if (amount > 0) o.earned += amount; else o.spent -= amount;
  o.ledger ??= []; o.ledger.unshift({ label, amount, season: save.season, round: save.done.length }); o.ledger = o.ledger.slice(0, 20);
  return true;
}
function news(save: CareerSave, title: string, body: string, kind: TeamNews['kind'] = 'team'): void {
  const w = dynasty(save);
  w.news.unshift({ id: `${roundKey(save)}:${hashString(title)}`, title, body, kind, season: save.season, round: save.done.length }); w.news = w.news.slice(0, 30);
}
export function hireStaff(save: CareerSave, id: string): boolean {
  const person = STAFF.find((s) => s.id === id);
  if (!managementOpen(save) || !person) return false;
  const w = dynasty(save);
  if (w.staff[person.role] === id || w.reputation < person.reputation || save.owner!.cash < person.fee + person.salary) return false;
  if (!book(save, `Signed ${person.name} · ${person.title}`, -person.fee)) return false;
  w.staff[person.role] = person.id; news(save, `${person.name} joins the team`, `${person.title}. ${person.detail}`); return true;
}
export function releaseStaff(save: CareerSave, role: StaffRole): boolean {
  if (!managementOpen(save)) return false;
  const w = dynasty(save), person = staffMember(save, role);
  if (!person) return false;
  delete w.staff[role]; news(save, `${person.name} leaves the team`, 'The role is open. There are no further salary payments.'); return true;
}
export function departmentCost(save: CareerSave, id: Department): number { return 750_000 * ((save.owner?.world?.departments[id] ?? 0) + 1) ** 2; }
export function upgradeDepartment(save: CareerSave, id: Department): boolean {
  if (!managementOpen(save) || !DEPARTMENTS.some((d) => d.id === id)) return false;
  const w = dynasty(save);
  if (w.departments[id] >= 3 || !book(save, `${DEPARTMENTS.find((d) => d.id === id)!.name} expansion`, -departmentCost(save, id))) return false;
  w.departments[id]++; return true;
}
export function trainDriver(save: CareerSave, id: string, focus: TrainingFocus): boolean {
  const spec = TRAINING.find((p) => p.id === focus);
  if (!managementOpen(save) || !owned(save, id) || !spec) return false;
  const w = dynasty(save), p = w.drivers[id] ??= freshDriver();
  if (p.training && (p.training.season !== save.season || p.training.round !== save.done.length)) delete p.training;
  if (p.training || p[focus] >= 8 || !book(save, `${driverDef(id)!.name} · ${spec.name}`, -spec.cost)) return false;
  p.training = { season: save.season, round: save.done.length, focus }; return true;
}

type DecisionId = 'vision' | 'media' | 'drivers' | 'reliability' | 'research' | 'community';
interface DecisionOption { label: string; detail: string; cost: number; confidence?: number; morale?: number; reputation?: number; fans?: number; insight?: number; xp?: number }
export const DECISIONS: Record<DecisionId, { from: string; title: string; body: string; options: readonly DecisionOption[] }> = {
  vision: { from: 'THE BOARD', title: 'What kind of team will you build?', body: 'Your first message sets the tone in the factory. The board wants ambition. Your people want a credible plan.', options: [
    { label: 'Invest in the foundations', detail: '$450k · +6 board confidence · +4 team morale · +1 research insight', cost: 450_000, confidence: 6, morale: 4, insight: 1 },
    { label: 'Make a statement', detail: 'No cost · +6 reputation · −3 team morale', cost: 0, reputation: 6, morale: -3 },
    { label: 'Promise steady progress', detail: 'No cost · +2 board confidence · +2 team morale', cost: 0, confidence: 2, morale: 2 },
  ] },
  media: { from: 'COMMERCIAL DIRECTOR', title: 'The cameras are waiting.', body: 'A partner wants a team feature before the next race. It could bring new fans, but the drivers need their preparation time.', options: [
    { label: 'Open the factory doors', detail: '+900 fans · +3 reputation · −4 team morale', cost: 0, fans: 900, reputation: 3, morale: -4 },
    { label: 'Protect the race programme', detail: '$180k · +5 morale · +2 board confidence', cost: 180_000, morale: 5, confidence: 2 },
    { label: 'A short team interview', detail: '+250 fans · +1 reputation', cost: 0, fans: 250, reputation: 1 },
  ] },
  drivers: { from: 'DRIVER DEVELOPMENT', title: 'Talent needs time.', body: 'Both drivers have asked for more time in the simulator. You can back their development now or keep the budget free for the car.', options: [
    { label: 'Fund a joint simulator camp', detail: '$350k · +25 XP to both drivers · +4 morale', cost: 350_000, xp: 25, morale: 4 },
    { label: 'Focus on the next car package', detail: '+1 research insight · −2 morale', cost: 0, insight: 1, morale: -2 },
    { label: 'Keep the current programme', detail: 'No immediate changes', cost: 0 },
  ] },
  reliability: { from: 'RACE ENGINEERING', title: 'Bring both cars home.', body: 'The engineering team wants more preparation after a difficult weekend. Rebuild confidence or put resources into the next performance step.', options: [
    { label: 'Run a reliability workshop', detail: '$300k · +1 consistency to both drivers · +6 morale · +3 board confidence', cost: 300_000, morale: 6, confidence: 3 },
    { label: 'Back the performance group', detail: '+2 research insight · −3 morale', cost: 0, insight: 2, morale: -3 },
    { label: 'Trust the existing process', detail: 'No immediate changes', cost: 0 },
  ] },
  research: { from: 'TECHNICAL GROUP', title: 'A concept worth pursuing.', body: 'Your engineers have found a promising direction. An extra test programme would turn the idea into insight for your next commissioned upgrade.', options: [
    { label: 'Approve the extra tests', detail: '$400k · +2 research insight · +3 board confidence', cost: 400_000, insight: 2, confidence: 3 },
    { label: 'Give the team more time', detail: '+1 research insight · +2 morale', cost: 0, insight: 1, morale: 2 },
    { label: 'Stay with the proven concept', detail: '+2 board confidence', cost: 0, confidence: 2 },
  ] },
  community: { from: 'TEAM COMMUNICATIONS', title: 'More than two cars.', body: 'Supporters have organised a community day. Show them what the team stands for, or keep everyone focused on the championship fight.', options: [
    { label: 'Make it a full team event', detail: '$250k · +1,500 fans · +4 reputation · +3 morale', cost: 250_000, fans: 1500, reputation: 4, morale: 3 },
    { label: 'Send a message from the factory', detail: '+300 fans · +1 reputation', cost: 0, fans: 300, reputation: 1 },
    { label: 'Keep the weekend race-focused', detail: '+2 board confidence', cost: 0, confidence: 2 },
  ] },
};
export function currentDecision(save: CareerSave) {
  if (!save.owner || save.done.length >= save.calendar.length) return null;
  const w = dynasty(save), key = roundKey(save);
  if (w.decisions.some((d) => d.key === key)) return null;
  const last = save.done.at(-1), reliability = last && seats(save).some((id) => last.dnf.includes(id));
  const pool: DecisionId[] = ['media', 'drivers', 'research', 'community'];
  const id: DecisionId = save.season === 1 && save.done.length === 0 ? 'vision' : reliability ? 'reliability' : pool[hashString(`${save.seed}:${key}:decision`) % pool.length];
  return { ...DECISIONS[id], id, key };
}
export function resolveDecision(save: CareerSave, key: string, choice: number): boolean {
  if (!managementOpen(save) || !Number.isInteger(choice)) return false;
  const decision = currentDecision(save), option = decision?.options[choice];
  if (!decision || decision.key !== key || !option || save.owner!.cash < option.cost) return false;
  if (option.cost && !book(save, decision.title, -option.cost)) return false;
  const w = dynasty(save);
  w.confidence = clamp(w.confidence + (option.confidence ?? 0), 0, 100); w.morale = clamp(w.morale + (option.morale ?? 0), 0, 100);
  w.reputation = clamp(w.reputation + (option.reputation ?? 0), 0, 100); w.fans += option.fans ?? 0; w.insight = Math.min(3, w.insight + (option.insight ?? 0));
  for (const id of seats(save)) {
    const p = w.drivers[id] ??= freshDriver(); p.xp = Math.min(500, p.xp + (option.xp ?? 0)); p.morale = clamp(p.morale + (option.morale ?? 0), 0, 100);
    if (decision.id === 'reliability' && choice === 0) p.consistency = Math.min(8, p.consistency + 1);
  }
  w.decisions.unshift({ key, template: decision.id, choice, season: save.season, round: save.done.length }); w.decisions = w.decisions.slice(0, 80);
  news(save, decision.title, `${option.label}. ${option.detail}`); return true;
}
function points(result: RoundResult, ids: readonly string[]): number { return ids.reduce((n, id) => n + (result.dnf.includes(id) ? 0 : CAREER.points[result.order.indexOf(id)] ?? 0), 0); }
function unlock(save: CareerSave, id: string): void {
  const w = dynasty(save), spec = ACHIEVEMENTS.find((a) => a[0] === id);
  if (!spec || w.achievements.includes(id)) return;
  w.achievements.push(id); news(save, spec[1], spec[2], 'milestone');
}
/** New-round hook only; replaying the hub or cleaning a save never advances the world or pays money. */
export function settleDynastyRound(save: CareerSave, result: RoundResult, teamPosition: number, champion: string | null): void {
  if (!save.owner) return;
  const w = dynasty(save), key = roundKey(save);
  if (w.settled === key) return;
  w.settled = key;
  const mine = seats(save), pts = points(result, mine), rival = teamsFor(save).find((t) => t.id === w.rival.id);
  const theirs = rival ? points(result, rival.drivers) : 0;
  if (pts > theirs) w.rival.won++; else if (pts < theirs) w.rival.lost++; else w.rival.tied++;
  const best = Math.min(...mine.map((id) => result.dnf.includes(id) ? 99 : result.order.indexOf(id) + 1));
  const retired = mine.filter((id) => result.dnf.includes(id)).length;
  const target = save.owner.target ?? teamsFor(save).length;
  w.confidence = clamp(w.confidence + (best <= 3 ? 5 : best <= target * 2 + 1 ? 2 : -3) - retired * 3, 0, 100);
  const approach = weekendApproach(save, save.done.length - 1);
  w.morale = clamp(w.morale + (pts ? 2 : -1) - retired * 3 - (approach.id === 'attack' ? 2 : 0), 0, 100);
  w.reputation = clamp(w.reputation + (best === 1 ? 4 : best <= 3 ? 2 : pts ? 1 : 0), 0, 100);
  w.fans = Math.min(2_000_000_000, w.fans + Math.round((200 + pts * 50) * (1 + w.departments.commercial * 0.1)));
  for (const id of mine) {
    const p = w.drivers[id] ??= freshDriver(), place = result.order.indexOf(id) + 1;
    p.morale = clamp(p.morale + (result.dnf.includes(id) ? -7 : place <= 3 ? 5 : place <= 10 ? 2 : -1), 0, 100);
    p.xp = Math.min(500, p.xp + 8 + (approach.id === 'development' ? 12 : 0));
    if (p.training?.season === save.season && p.training.round === save.done.length - 1) {
      p[p.training.focus] = Math.min(8, p[p.training.focus] + 1);
      p.xp = Math.min(500, p.xp + 24 + (staffMember(save, 'coach')?.level ?? 0) * 10 + w.departments.simulator * 5);
      news(save, `${driverDef(id)!.name} completes training`, `${TRAINING.find((t) => t.id === p.training!.focus)!.name} delivered. Their development follows them through the career.`);
      delete p.training;
    }
    if (p.xp >= 200) unlock(save, 'developed-driver');
  }
  const commercial = w.departments.commercial * 75_000;
  if (commercial) book(save, 'Commercial studio income', commercial);
  const costs = operatingCosts(save);
  if (costs) {
    const available = Math.min(costs, save.owner.cash); if (available) book(save, 'Staff and department operations', -available);
    if (available < costs) { w.staff = {}; w.confidence = Math.max(0, w.confidence - 8); news(save, 'Payroll shortfall', 'Staff contracts were released after the team could not cover operating costs. Department levels remain. No debt is carried forward.', 'board'); }
  }
  if (pts > 0) unlock(save, 'first-points'); if (best <= 3) unlock(save, 'first-podium'); if (best === 1) unlock(save, 'first-win');
  news(save, pts > theirs ? 'Advantage, your team.' : pts < theirs ? 'Your rival strikes back.' : 'Nothing between the teams.', `${pts}–${theirs} on points against ${rival?.name ?? 'your rival'}. Head-to-head: ${w.rival.won} wins, ${w.rival.lost} losses.`, 'rival');
  if (save.done.length % 3 === 0 && save.done.length < save.calendar.length) {
    for (const t of teamsFor(save)) if (t.id !== save.team) save.cars[t.id] = Math.min(1, save.cars[t.id] + 0.004 + rng(hashString(`${save.seed}:${key}:${t.id}:upgrade`))() * 0.008);
    news(save, 'The grid keeps moving.', 'Rival teams have brought new packages. Your vehicle comparison now reflects their gains.', 'rival');
  }
  if (save.done.length === save.calendar.length && w.reviewed !== save.season) {
    w.reviewed = save.season;
    if (teamPosition <= target) { const bonus = 800_000 + Math.round(w.confidence) * 10_000; book(save, 'Board objective bonus', bonus); news(save, 'Objective achieved.', 'The board has paid your season performance bonus. Keep building.', 'board'); }
    else news(save, 'A season to learn from.', `Finished P${teamPosition} against the board’s P${target} target. Your team and progress continue next season.`, 'board');
    if (teamPosition === 1) unlock(save, 'constructors-title'); if (champion && mine.includes(champion)) unlock(save, 'drivers-title');
    if (w.rival.won > w.rival.lost) unlock(save, 'rivalry-win');
  }
}
export function startDynastySeason(save: CareerSave): void {
  if (!save.owner) return;
  const w = dynasty(save); w.plan = { season: save.season, round: 0, id: 'balanced' }; w.settled = roundKey(save);
  w.rival = { id: rivalId(save), won: 0, lost: 0, tied: 0 };
  for (const p of Object.values(w.drivers)) { delete p.training; p.morale = Math.round((p.morale + 70) / 2); }
  news(save, `Season ${save.season}. A new chapter.`, `Recruitment and partner contracts reopen. Staff, departments, driver development and your legacy carry forward.`, 'board');
}

/** Strict optional migration. Missing campaign data stays absent until the owner hub initializes it. */
export function cleanDynasty(raw: unknown): DynastyState | undefined {
  if (!raw || typeof raw !== 'object' || (raw as { v?: number }).v !== 1) return undefined;
  const r = raw as Record<string, unknown>, object = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
  const n = (x: unknown, lo: number, hi: number, fallback: number) => typeof x === 'number' && Number.isFinite(x) ? clamp(x, lo, hi) : fallback;
  const text = (x: unknown, max = 160) => typeof x === 'string' ? x.slice(0, max) : '';
  const plan = object(r.plan), dep = object(r.departments), staff = object(r.staff), rival = object(r.rival);
  const out: DynastyState = { v: 1, confidence: n(r.confidence, 0, 100, 65), reputation: n(r.reputation, 0, 100, 15), fans: Math.floor(n(r.fans, 0, 2e9, 2000)), morale: n(r.morale, 0, 100, 65), insight: Math.floor(n(r.insight, 0, 3, 0)),
    plan: { season: Math.floor(n(plan.season, 1, 9999, 1)), round: Math.floor(n(plan.round, 0, 24, 0)), id: APPROACHES.some((p) => p.id === plan.id) ? plan.id as WeekendApproach : 'balanced' },
    drivers: {}, staff: {}, departments: { laboratory: Math.floor(n(dep.laboratory, 0, 3, 0)), simulator: Math.floor(n(dep.simulator, 0, 3, 0)), commercial: Math.floor(n(dep.commercial, 0, 3, 0)) },
    decisions: [], news: [], achievements: Array.isArray(r.achievements) ? [...new Set(r.achievements.filter((id): id is string => ACHIEVEMENTS.some((a) => a[0] === id)))].slice(0, 10) : [],
    rival: { id: text(rival.id, 40), won: Math.floor(n(rival.won, 0, 24, 0)), lost: Math.floor(n(rival.lost, 0, 24, 0)), tied: Math.floor(n(rival.tied, 0, 24, 0)) }, settled: text(r.settled, 30), reviewed: Math.floor(n(r.reviewed, 0, 9999, 0)) };
  for (const role of ['technical', 'coach', 'engineer'] as const) if (STAFF.some((p) => p.role === role && p.id === staff[role])) out.staff[role] = staff[role] as string;
  for (const [id, value] of Object.entries(object(r.drivers))) if (driverDef(id)) {
    const p = object(value), training = object(p.training);
    out.drivers[id] = { xp: Math.floor(n(p.xp, 0, 500, 0)), pace: Math.floor(n(p.pace, 0, 8, 0)), racecraft: Math.floor(n(p.racecraft, 0, 8, 0)), consistency: Math.floor(n(p.consistency, 0, 8, 0)), morale: n(p.morale, 0, 100, 65) };
    if (TRAINING.some((t) => t.id === training.focus)) out.drivers[id].training = { season: Math.floor(n(training.season, 1, 9999, 1)), round: Math.floor(n(training.round, 0, 23, 0)), focus: training.focus as TrainingFocus };
  }
  if (Array.isArray(r.decisions)) for (const item of r.decisions.slice(0, 80)) {
    const d = object(item); if (!Object.hasOwn(DECISIONS, text(d.template)) || !Number.isInteger(d.choice) || (d.choice as number) < 0 || (d.choice as number) > 2) continue;
    out.decisions.push({ key: text(d.key, 30), template: text(d.template, 30), choice: d.choice as number, season: Math.floor(n(d.season, 1, 9999, 1)), round: Math.floor(n(d.round, 0, 24, 0)) });
  }
  if (Array.isArray(r.news)) for (const item of r.news.slice(0, 30)) {
    const a = object(item); if (!a.title || !['team', 'board', 'rival', 'milestone'].includes(a.kind as string)) continue;
    out.news.push({ id: text(a.id, 80), title: text(a.title, 100), body: text(a.body, 300), kind: a.kind as TeamNews['kind'], season: Math.floor(n(a.season, 1, 9999, 1)), round: Math.floor(n(a.round, 0, 24, 0)) });
  }
  return out;
}
