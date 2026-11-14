import { carOrder, carRank, performanceIndex, team, type CareerSave } from '../career/career.ts';
import { CAR_AREAS, seatAreas, teamAreas, type CarArea } from '../career/carAreas.ts';
import { circuitDemand, projectedOrder } from '../career/circuitPace.ts';
import { driverDef, teamsFor } from '../career/roster.ts';
import { DEVELOPMENT } from '../config/development.ts';
import { builtInTrack } from '../editor/pipeline.ts';
import { expandFacilities, facilityCost, money, signSponsor, SPONSORS, sponsorFor } from '../career/owner.ts';
import { button, h } from './dom.ts';
import { engineeringFacilities } from './engineeringScreen.ts';
import { capSpent, costCap } from '../career/engineering.ts';
import { departmentsView, reliabilityLabel } from './careerCampaign.ts';
import { operatingCosts } from '../career/dynasty.ts';

export const ownerLabel = (text: string) => h('div', { class: 'owner-label', text });
export const ownerStat = (name: string, value: string) => h('div', { class: 'owner-stat' }, ownerLabel(name), h('strong', { text: value }));
const intro = (tag: string, title: string, text: string) => h('div', { class: 'owner-section-intro' }, ownerLabel(tag), h('h1', { text: title }), h('p', { class: 'owner-muted', text }));

export function financeView(save: CareerSave, changed: () => void): HTMLElement {
  const o = save.owner!;
  const salaries = save.contracts?.active.reduce((sum, d) => sum + d.salary, 0) ?? 0;
  const current = sponsorFor(save);
  const contracts = h('div', { class: 'owner-contracts' });
  for (const sponsor of SPONSORS) {
    const selected = sponsor.id === current.id;
    const sign = button(selected ? 'Current partner' : save.done.length ? 'Available next season' : 'Sign season contract', () => { if (signSponsor(save, sponsor.id)) changed(); }, { class: selected ? 'on' : '' });
    sign.disabled = selected || save.done.length > 0;
    sign.tabIndex = 0;
    contracts.append(h('article', { class: `owner-contract${selected ? ' selected' : ''}` }, ownerLabel(sponsor.category), h('h3', { text: sponsor.name }), h('p', { text: sponsor.description }),
      h('strong', { text: `${money(sponsor.base)} / RACE` }), h('small', { text: `+ ${money(sponsor.perPoint)} per team point${sponsor.bonus ? ` · ${money(sponsor.bonus)} target bonus` : ''}` }), sign));
  }
  const ledger = h('ol', { class: 'owner-ledger' });
  for (const entry of o.ledger ?? []) ledger.append(h('li', {}, h('span', {}, h('strong', { text: entry.label }), h('small', { text: `SEASON ${entry.season} · ROUND ${entry.round}` })), h('b', { class: entry.amount >= 0 ? 'credit' : 'debit', text: `${entry.amount >= 0 ? '+' : '−'}${money(Math.abs(entry.amount))}` })));
  return h('section', { class: 'owner-card owner-finance' },
    intro('TEAM', 'Finance', 'Choose a sponsor before the opening race. The contract is then locked for the season. Review payroll, operating costs and season spending here.'),
    h('div', { class: 'owner-finance-totals' }, ownerStat('AVAILABLE FUNDS', money(o.cash)), ownerStat('TOTAL INCOME', money(o.earned)), ownerStat('SEASON SPENDING', money(capSpent(save))), ownerStat('COST CAP', money(costCap(save)))),
    h('div', { class: 'campaign-finance-forecast' }, ownerLabel('NEXT RACE / GUARANTEED BUDGET'), h('strong', { text: `${money(current.base + o.facilities * 250_000 + (o.world?.departments.commercial ?? 0) * 75_000 - operatingCosts(save) - salaries)} net before points bonuses` }), h('p', { text: `${money(operatingCosts(save))} in staff/engineering costs and ${money(salaries)} in driver salaries will be paid after the race. Signing fees and training are separate, immediate expenses.` })),
    contracts, ownerLabel('RECENT TRANSACTIONS'), (o.ledger?.length ? ledger : h('p', { class: 'owner-empty', text: 'Your opening balance is ready. Race income and team investments will appear here.' })));
}

export function facilitiesView(save: CareerSave, changed: () => void): HTMLElement {
  const o = save.owner!;
  const expand = button(o.facilities >= 3 ? 'Headquarters fully expanded' : o.cash < facilityCost(save) ? 'Insufficient funds' : `Expand headquarters · ${money(facilityCost(save))}`, () => { if (expandFacilities(save)) changed(); }, { class: 'primary' });
  expand.disabled = o.facilities >= 3 || o.cash < facilityCost(save);
  expand.tabIndex = 0;
  return h('section', { class: 'owner-card' },
    intro('FACILITIES', 'Facilities and workforce', 'Invest in engineering, driver development and commercial operations.'), engineeringFacilities(save, changed),
    h('details', { class: 'owner-extra-facilities' }, h('summary', { text: 'Commercial & driver facilities' }), h('div', { class: 'owner-hq-visual' }, ...[1, 2, 3].map((n) => h('div', { class: o.facilities >= n ? 'built' : '' }, h('span', { text: `0${n}` }), h('strong', { text: ['Commercial office', 'Partner centre', 'Global headquarters'][n - 1] }), h('small', { text: o.facilities >= n ? 'OPERATIONAL' : 'EXPANSION OPPORTUNITY' })))),
    h('div', { class: 'owner-stats' }, ownerStat('CURRENT LEVEL', `${o.facilities} / 3`), ownerStat('HQ INCOME / RACE', money(o.facilities * 250_000)), ownerStat('NEXT LEVEL', o.facilities < 3 ? money(facilityCost(save)) : 'COMPLETE')), expand, departmentsView(save, changed)));
}

const AREA_NAMES: Record<CarArea, string> = { aero: 'Aerodynamics', chassis: 'Chassis', powertrain: 'Power unit' };
const AREA_SHORT: Record<CarArea, string> = { aero: 'Aero', chassis: 'Chassis', powertrain: 'Power' };
/** A rating as performance-index points (the leader's original car is 700). */
const pi = (rating: number) => Math.round(rating * 700);
const signed = (s: number, digits = 2) => `${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(digits)}`;

/** A bar on a shared scale, with optional marks (the field's best and average). */
function bar(value: number, scale: number, marks: { at: number; label: string }[] = []): HTMLElement {
  const meter = h('div', { class: 'owner-meter vehicle-meter' }, h('i'));
  (meter.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(100, (value / scale) * 100))}%`;
  for (const m of marks) {
    const tick = h('b', { class: 'vehicle-mark', title: m.label });
    tick.style.left = `${Math.max(0, Math.min(100, (m.at / scale) * 100))}%`;
    meter.append(tick);
  }
  return meter;
}

/**
 * The cars compared, area by area: your two cars against the field's best
 * and average in aerodynamics, chassis and power unit; what the next circuit
 * rewards and where every car is projected to be there (the same driver in
 * each, so the gaps are the cars'); the overall performance order; and the
 * packages the rival teams have brought.
 */
export function vehicleView(save: CareerSave, develop: () => void): HTMLElement {
  const teams = teamsFor(save);
  const mine = teams.find((t) => t.id === save.team)!;
  const seatCars = mine.drivers.map((id) => ({ id, areas: seatAreas(save, save.team, id) }));
  const rivals = teams.filter((t) => t.id !== save.team).map((t) => teamAreas(save, t.id));
  const all = [...rivals, ...seatCars.map((c) => c.areas)];
  const top = Math.max(...all.flatMap((a) => CAR_AREAS.map((k) => a[k])));
  const scale = Math.max(1, Math.ceil((top * 700 + 1) / 250) * 250 / 700);

  // Your cars, area by area.
  const areas = h('div', { class: 'vehicle-areas' });
  for (const area of CAR_AREAS) {
    const best = Math.max(...rivals.map((a) => a[area])), avg = rivals.reduce((n, a) => n + a[area], 0) / rivals.length;
    const marks = [{ at: best, label: `Best rival: ${pi(best)}` }, { at: avg, label: `Field average: ${pi(avg)}` }];
    const rows = seatCars.map((c, i) => h('div', { class: 'vehicle-area-row' }, h('span', { text: `Car ${i + 1} · ${driverDef(c.id)?.name ?? ''}` }), bar(c.areas[area], scale, marks), h('strong', { text: String(pi(c.areas[area])) })));
    const gap = seatCars[0].areas[area] - best;
    areas.append(h('article', {}, ownerLabel(AREA_NAMES[area].toUpperCase()), ...rows, h('small', { class: gap >= 0 ? 'ahead' : '', text: gap >= 0 ? `The best on the grid (+${pi(gap)} on the next best)` : `${pi(-gap)} behind the best rival · field average ${pi(avg)}` })));
  }

  // The next circuit: what it rewards, and the projected order there.
  const round = Math.min(save.done.length, save.calendar.length - 1);
  const track = builtInTrack(save.calendar[round]);
  let circuit: HTMLElement | null = null;
  if (track) {
    const demand = circuitDemand(save, track);
    const order = projectedOrder(save, track), lead = order[0].lap;
    const demands = h('div', { class: 'vehicle-demand' }, ...CAR_AREAS.map((a) => h('div', {}, h('span', { text: AREA_SHORT[a] }), bar(demand.share[a], 0.6), h('strong', { text: `${Math.round(demand.share[a] * 100)}%` }))));
    const list = h('ol', { class: 'owner-performance-list vehicle-projection' });
    order.forEach((row, i) => {
      const t = teams.find((x) => x.id === row.team)!;
      const name = row.seat === null ? t.name : `${t.name} · car ${row.seat + 1}`;
      list.append(h('li', { class: row.team === save.team ? 'yours' : '' }, h('b', { text: String(i + 1).padStart(2, '0') }), h('span', { text: name }), h('strong', { text: i === 0 ? `${row.lap.toFixed(2)} s` : `${signed(row.lap - lead)} s` })));
    });
    const strongest = CAR_AREAS.reduce((a, b) => (demand.share[b] > demand.share[a] ? b : a));
    circuit = h('section', { class: 'vehicle-circuit' }, ownerLabel(`NEXT CIRCUIT · ROUND ${round + 1}`), h('h2', { text: track.def.name }),
      h('p', { class: 'owner-muted', text: `What a step in each area is worth on a lap here. ${AREA_NAMES[strongest]} counts most at this circuit: +${pi(DEVELOPMENT.probe)} PI there saves ${demand.seconds[strongest].toFixed(2)} s a lap.` }), demands,
      ownerLabel('PROJECTED LAP · SAME DRIVER IN EVERY CAR'), list,
      h('p', { class: 'owner-muted', text: 'Planned along the racing line with each car’s grip, engine and top speed. Drivers, tyres, weather and traffic decide the race itself.' }));
  }

  // The overall order.
  const order = carOrder(save);
  const overall = h('ol', { class: 'owner-performance-list' });
  const oScale = Math.max(1000, Math.ceil((Math.max(...order.map((t) => performanceIndex(save, t.id))) + 1) / 250) * 250);
  for (const [i, t] of order.entries()) {
    overall.append(h('li', { class: t.id === save.team ? 'yours' : '' }, h('b', { text: String(i + 1).padStart(2, '0') }), h('div', {}, h('span', { text: t.name }), bar(performanceIndex(save, t.id), oScale)), h('strong', { text: `${performanceIndex(save, t.id)} PI` })));
  }

  // The rivals' development.
  const packages = (save.rivalPackages ?? []).slice(0, 12);
  const news = h('ol', { class: 'owner-ledger vehicle-rivals' });
  for (const p of packages) {
    const t = teams.find((x) => x.id === p.team);
    news.append(h('li', {}, h('span', {}, h('strong', { text: `${t?.name ?? p.team} · ${AREA_NAMES[p.area]}` }), h('small', { text: `SEASON ${p.season} · FROM ROUND ${p.round}${p.flop ? ' · DIDN’T WORK AS PLANNED' : ''}` })), h('b', { class: p.flop ? 'debit' : 'credit', text: `+${pi(p.gain)} PI` })));
  }

  return h('section', { class: 'owner-card' }, intro('VEHICLE PERFORMANCE', `${team(save.team, save).name} · TB–${String(save.season).padStart(2, '0')}`, 'Every car on one scale. A car’s aerodynamics and chassis make its cornering grip; the power unit and chassis its acceleration; the power unit and aero its top speed. Your parts count on the same scale as the rivals’ packages.'),
    h('div', { class: 'owner-stats' }, ownerStat('ON THE GRID', `P${carRank(save, save.team)}`), ownerStat('PERFORMANCE INDEX', `${performanceIndex(save, save.team)} PI`), ownerStat('AI RELIABILITY', reliabilityLabel(save))), h('div', { class: 'owner-garage' }),
    ownerLabel('YOUR CARS · AREA BY AREA'), h('p', { class: 'owner-muted', text: 'Red mark: the best rival in that area. Grey mark: the field average.' }), areas,
    circuit,
    ownerLabel('OVERALL PERFORMANCE'), overall,
    ownerLabel('RIVAL DEVELOPMENT'), packages.length ? news : h('p', { class: 'owner-empty', text: 'No rival packages yet. Teams bring upgrades through the season; the further back a team finished, the more development time it gets.' }),
    button('Open development workshop ↗', develop));
}
