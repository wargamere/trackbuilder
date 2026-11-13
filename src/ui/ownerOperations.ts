import { carOrder, carRank, performanceIndex, team, type CareerSave } from '../career/career.ts';
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

export function vehicleView(save: CareerSave, develop: () => void): HTMLElement {
  const order = carOrder(save);
  const scale = Math.max(1000, Math.ceil((Math.max(...order.map(t => performanceIndex(save, t.id))) + 1) / 250) * 250);
  const list = h('ol', { class: 'owner-performance-list' });
  for (const [i, t] of order.entries()) {
    const meter = h('div', { class: 'owner-meter' }, h('i'));
    (meter.firstElementChild as HTMLElement).style.width = `${performanceIndex(save, t.id) / scale * 100}%`;
    list.append(h('li', { class: t.id === save.team ? 'yours' : '' }, h('b', { text: String(i + 1).padStart(2, '0') }), h('div', {}, h('span', { text: t.name }), meter), h('strong', { text: `${performanceIndex(save, t.id)} PI` })));
  }
  return h('section', { class: 'owner-card' }, intro('VEHICLE PERFORMANCE', `${team(save.team, save).name} · TB–${String(save.season).padStart(2, '0')}`, 'Compare the team’s average car rating with the field. Each car receives only its fitted upgrades; review individual equipment in Assign upgrades.'),
    h('div', { class: 'owner-stats' }, ownerStat('ON THE GRID', `P${carRank(save, save.team)}`), ownerStat('PERFORMANCE INDEX', `${performanceIndex(save, save.team)} PI`), ownerStat('AI RELIABILITY', reliabilityLabel(save))), h('div', { class: 'owner-garage' }), h('p', { class: 'owner-muted', text: 'An absolute performance index, not a percentage of the leader. The initial leader is 700 PI. Earned gains carry into future seasons; the chart scale expands as cars improve.' }), list, button('Open development workshop ↗', develop));
}
