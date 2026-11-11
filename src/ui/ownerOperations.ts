import { carOrder, carRank, team, type CareerSave } from '../career/career.ts';
import { commissionDevelopment, developmentCost, expandFacilities, facilityCost, money, RESEARCH, researchBlocker, signSponsor, SPONSORS, sponsorFor } from '../career/owner.ts';
import { button, h } from './dom.ts';

export const ownerLabel = (text: string) => h('div', { class: 'owner-label', text });
export const ownerStat = (name: string, value: string) => h('div', { class: 'owner-stat' }, ownerLabel(name), h('strong', { text: value }));
const intro = (tag: string, title: string, text: string) => h('div', { class: 'owner-section-intro' }, ownerLabel(tag), h('h1', { text: title }), h('p', { class: 'owner-muted', text }));

export function developmentView(save: CareerSave, changed: () => void): HTMLElement {
  const o = save.owner!;
  const active = RESEARCH.find((r) => r.id === o.research?.id) ?? RESEARCH[1];
  const programmes = h('div', { class: 'research-programmes' });
  for (const spec of RESEARCH) {
    const blocker = researchBlocker(save, spec.id);
    const start = button(blocker ?? `Commission upgrade · ${money(developmentCost(save, spec.id))}`, () => { if (commissionDevelopment(save, spec.id)) changed(); }, { class: 'primary' });
    start.disabled = !!blocker;
    start.tabIndex = 0;
    programmes.append(h('article', { class: `research-option research-${spec.id}` },
      ownerLabel(spec.tag), h('h3', { text: spec.name }), h('p', { text: spec.description }),
      h('div', { class: 'research-specs' }, ownerStat('CAR RATING', `+${(spec.gain * 100).toFixed(1)}%`), ownerStat('DELIVERY', `${spec.rounds} ${spec.rounds === 1 ? 'ROUND' : 'ROUNDS'}`)), start));
  }
  const progress = o.project ? ((active.rounds - (o.research?.remaining ?? 1)) / active.rounds * 100) : 0;
  const bar = h('div', { class: 'owner-meter' }, h('i'));
  (bar.firstElementChild as HTMLElement).style.width = `${progress}%`;
  return h('section', { class: 'owner-card' },
    intro('RESEARCH & DEVELOPMENT', 'Outdevelop the competition.', 'One workshop. Three approaches. Choose how much to invest and how long you can wait. Every delivered upgrade improves both cars.'),
    h('div', { class: 'owner-workshop' }, ownerLabel(o.project ? 'WORKSHOP ACTIVE' : 'WORKSHOP AVAILABLE'), h('h3', { text: o.project ? active.name : 'Your next advantage starts here.' }),
      h('p', { text: o.project ? `${o.research?.remaining ?? 1} completed round(s) until delivery · ${o.development}/5 packages delivered this season` : `${o.development}/5 packages delivered this season · gains capped at 100% car rating` }), bar), programmes);
}

export function financeView(save: CareerSave, changed: () => void): HTMLElement {
  const o = save.owner!;
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
    intro('COMMERCIAL OPERATIONS', 'Make every decision count.', 'Choose your partner before the opening race. Once racing begins, the contract is locked for the season. Headquarters income is paid on top.'),
    h('div', { class: 'owner-finance-totals' }, ownerStat('AVAILABLE FUNDS', money(o.cash)), ownerStat('TOTAL INCOME', money(o.earned)), ownerStat('TOTAL INVESTMENT', money(o.spent))),
    contracts, ownerLabel('RECENT TRANSACTIONS'), (o.ledger?.length ? ledger : h('p', { class: 'owner-empty', text: 'Your opening balance is ready. Race income and team investments will appear here.' })));
}

export function facilitiesView(save: CareerSave, changed: () => void): HTMLElement {
  const o = save.owner!;
  const expand = button(o.facilities >= 3 ? 'Headquarters fully expanded' : o.cash < facilityCost(save) ? 'Insufficient funds' : `Expand headquarters · ${money(facilityCost(save))}`, () => { if (expandFacilities(save)) changed(); }, { class: 'primary' });
  expand.disabled = o.facilities >= 3 || o.cash < facilityCost(save);
  expand.tabIndex = 0;
  return h('section', { class: 'owner-card' },
    intro('TEAM HEADQUARTERS', 'Build beyond the circuit.', 'A stronger commercial operation means more dependable income. Every level adds $250,000 to your payment after each completed race.'),
    h('div', { class: 'owner-hq-visual' }, ...[1, 2, 3].map((n) => h('div', { class: o.facilities >= n ? 'built' : '' }, h('span', { text: `0${n}` }), h('strong', { text: ['Commercial office', 'Partner centre', 'Global headquarters'][n - 1] }), h('small', { text: o.facilities >= n ? 'OPERATIONAL' : 'EXPANSION OPPORTUNITY' })))),
    h('div', { class: 'owner-stats' }, ownerStat('CURRENT LEVEL', `${o.facilities} / 3`), ownerStat('HQ INCOME / RACE', money(o.facilities * 250_000)), ownerStat('NEXT LEVEL', o.facilities < 3 ? money(facilityCost(save)) : 'COMPLETE')), expand);
}

export function vehicleView(save: CareerSave, develop: () => void): HTMLElement {
  const order = carOrder(save);
  const list = h('ol', { class: 'owner-performance-list' });
  for (const [i, t] of order.entries()) {
    const meter = h('div', { class: 'owner-meter' }, h('i'));
    (meter.firstElementChild as HTMLElement).style.width = `${save.cars[t.id] * 100}%`;
    list.append(h('li', { class: t.id === save.team ? 'yours' : '' }, h('b', { text: String(i + 1).padStart(2, '0') }), h('div', {}, h('span', { text: t.name }), meter), h('strong', { text: `${Math.round(save.cars[t.id] * 100)}%` })));
  }
  return h('section', { class: 'owner-card' }, intro('VEHICLE PERFORMANCE', `${team(save.team).name} · TB–${String(save.season).padStart(2, '0')}`, 'Your car against the field. Shared development improves the grip, engine pull and top speed of your controlled car, and the pace of your teammate.'),
    h('div', { class: 'owner-stats' }, ownerStat('ON THE GRID', `P${carRank(save, save.team)}`), ownerStat('CAR RATING', `${Math.round(save.cars[save.team] * 100)}%`)), list, button('Open development workshop ↗', develop));
}
