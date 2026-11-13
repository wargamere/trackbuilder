import { team, type CareerSave } from '../career/career.ts';
import { money } from '../career/owner.ts';
import { driverDef } from '../career/roster.ts';
import { hireDriver, marketDrivers, recruitmentOpen, updateTeamIdentity } from '../career/teamManagement.ts';
import { button, h } from './dom.ts';
import { liveryFields, driverMarket } from './teamCreation.ts';
import { cancelFutureContract, contractQuote, driverContracts, offerDriverContract, openDriverTalk, projectedDrivers } from '../career/contracts.ts';

const seatFor = new WeakMap<CareerSave, 0 | 1>();

export function recruitmentView(save: CareerSave, changed: () => void): HTMLElement {
  const c = driverContracts(save), current = team(save.team, save);
  const section = h('section', { class: 'team-recruitment' }, h('div', { class: 'owner-label', text: 'DRIVER CONTRACTS' }), h('h2', { text: `Plan your season ${save.season + 1} lineup` }),
    h('p', { class: 'owner-muted', text: 'Talk to multiple drivers throughout the season. Agree signing fees, race salaries and one-to-three-year contracts. Signed moves take effect after the final race; this season’s grid and points stay with the current lineup.' }));
  const future = h('div', { class: 'contract-lineup' }), ids = projectedDrivers(save);
  for (const i of [0, 1] as const) {
    const deal = c.next[i], d = driverDef(ids[i])!, active = c.active.find(a => a.driver === ids[i]) ?? c.active[i];
    const retention = Math.round(contractQuote(save, ids[i], i).salary * 1.15 / 1000) * 1000;
    const card = h('article', {}, h('div', { class: 'owner-label', text: `NEXT SEASON · CAR ${i + 1}` }), h('h3', { text: `${d.first} ${d.name}` }), h('p', { text: deal ? `Signed through season ${deal.ends} · ${money(deal.salary)} / race` : active.ends > save.season ? `Contract continues through season ${active.ends} · ${money(active.salary)} / race` : `No new deal yet. Estimated one-year retention: ${money(retention)} / race, 15% above negotiated renewal salary.` }));
    if (deal) { const cancel = button('Cancel future deal · fee not refunded', () => { if (cancelFutureContract(save, i)) changed(); }); cancel.tabIndex = 0; card.append(cancel); }
    future.append(card);
  }
  section.append(future);
  const seat = seatFor.get(save) ?? 0;
  const controls = h('div', { class: 'team-seat-selection' });
  for (const i of [0, 1] as const) {
    const d = driverDef(current.drivers[i])!;
    const b = button(`Seat ${i + 1} · ${d.name}`, () => { seatFor.set(save, i); changed(); }, { class: seat === i ? 'on' : '' });
    b.tabIndex = 0; b.setAttribute('aria-pressed', String(seat === i)); controls.append(b);
  }
  const driver = h('select'); driver.setAttribute('aria-label', 'Driver to negotiate with');
  for (const d of [...marketDrivers(save)].sort((a, b) => Number(current.drivers.includes(b.id)) - Number(current.drivers.includes(a.id)) || b.skill - a.skill)) {
    const option = h('option', { text: `${d.first} ${d.name} · ${Math.round(d.skill * 100)}${current.drivers.includes(d.id) ? ' · renew' : ''}` }); option.value = d.id; option.disabled = c.next.some(deal => deal?.driver === d.id); driver.append(option);
  }
  driver.value = Array.from(driver.options).find(o => o.value === current.drivers[seat] && !o.disabled)?.value ?? Array.from(driver.options).find(o => !o.disabled)?.value ?? '';
  const years = h('select'); years.setAttribute('aria-label', 'Contract duration'); for (const n of [1, 2, 3]) { const option = h('option', { text: `${n} season${n > 1 ? 's' : ''}` }); option.value = String(n); years.append(option); }
  const open = button('Open contract talks', () => { if (openDriverTalk(save, driver.value, seat, Number(years.value))) changed(); }); open.tabIndex = 0;
  const payroll = c.active.reduce((sum, a) => sum + a.salary, 0);
  section.append(controls, h('div', { class: 'contract-open' }, driver, years, open), h('p', { class: 'owner-muted', text: `${money(save.owner!.cash)} available. Keep two race salaries in reserve when signing. Fees, including any replacement buyout, are paid now; new salaries start next season. ${payroll ? `Current driver payroll: ${money(payroll)} per race.` : 'Your existing contracts are prepaid this season.'}` }));
  const talks = h('div', { class: 'contract-talks' });
  for (const t of c.talks.filter(t => t.status !== 'cancelled')) {
    const d = driverDef(t.driver)!, expired = t.expires < save.done.length && t.status !== 'accepted';
    const card = h('article', { class: `contract-talk ${t.status}` }, h('div', { class: 'owner-label', text: `CAR ${t.seat + 1} · ${t.years} SEASON${t.years > 1 ? 'S' : ''}` }), h('h3', { text: `${d.first} ${d.name}` }));
    if (t.status === 'accepted') { card.append(h('p', { text: `Agreement signed. Joins for season ${save.season + 1}.` })); talks.append(card); continue; }
    if (expired) { const restart = button('Reopen expired talks', () => { if (openDriverTalk(save, t.driver, t.seat, t.years)) changed(); }); restart.tabIndex = 0; card.append(h('p', { text: 'The previous terms expired. Reopen talks for a new quote.' }), restart); talks.append(card); continue; }
    const prefix = `${d.name} car ${t.seat + 1}`;
    const fee = Object.assign(h('input'), { type: 'number', min: '0', step: '1000' }); fee.setAttribute('aria-label', `${prefix} signing fee`); fee.value = String(Math.round(t.counter.fee * (t.status === 'counter' ? 1 : .85) / 1000) * 1000);
    const salary = Object.assign(h('input'), { type: 'number', min: '0', step: '1000' }); salary.setAttribute('aria-label', `${prefix} salary per race`); salary.value = String(Math.round(t.counter.salary * (t.status === 'counter' ? 1 : .9) / 1000) * 1000);
    const status = h('p', { text: t.status === 'counter' ? `Counteroffer: ${money(t.counter.fee)} signing fee and ${money(t.counter.salary)} per race.` : `Requested terms: ${money(t.counter.fee)} signing fee, ${money(t.counter.salary)} per race. Terms remain available through round ${Math.min(save.calendar.length, t.expires + 1)}.` }); status.setAttribute('role', 'status');
    const offer = button(t.status === 'counter' ? 'Accept counteroffer' : 'Make contract offer', () => {
      const result = offerDriverContract(save, t.driver, t.seat, { fee: Number(fee.value), salary: Number(salary.value), years: t.years });
      if (result === 'accepted' || result === 'counter') changed();
      else status.textContent = result === 'funds' ? 'Keep enough cash for the fee and two race salaries.' : result === 'unavailable' ? 'This seat or driver already has a future agreement. Cancel it before signing a replacement.' : 'Enter valid contract amounts.';
    }); offer.tabIndex = 0;
    card.append(status, h('div', { class: 'contract-terms' }, h('label', {}, 'Signing fee', fee), h('label', {}, 'Salary / race', salary)), offer); talks.append(card);
  }
  section.append(talks);
  if (save.season === 1 && !save.calendarStarted && recruitmentOpen(save)) {
    const details = h('details', {}, h('summary', { text: 'Adjust the founding lineup before your first session' }));
    details.append(driverMarket(marketDrivers(save), current.drivers, seat, id => { if (hireDriver(save, seat, id)) changed(); }, save.owner!.cash, true)); section.append(details);
  }
  return section;
}

export function identityView(save: CareerSave, changed: () => void): HTMLElement {
  const t = team(save.team, save);
  const draft = { paint: t.paint, secondary: t.secondary ?? 0xffffff };
  const name = h('input', { class: 'text-input' }); name.value = t.name; name.maxLength = 28; name.setAttribute('aria-label', 'Team name');
  const status = h('p', { class: 'owner-muted' }); status.setAttribute('role', 'status');
  const apply = button('Save team identity', () => {
    if (!updateTeamIdentity(save, name.value, draft.paint, draft.secondary)) { status.textContent = 'Enter a team name.'; return; }
    changed();
  }, { class: 'primary' }); apply.tabIndex = 0;
  return h('section', { class: 'owner-card owner-identity' }, h('div', { class: 'owner-label', text: 'TEAM IDENTITY' }), h('h1', { text: 'Make it your own.' }),
    h('p', { class: 'owner-muted', text: 'Your team name and both livery colours follow you through the garage, both race cars, timing screens and championship standings. Your progress stays with the team.' }),
    h('label', {}, h('span', { class: 'owner-label', text: 'TEAM NAME' }), name), liveryFields(draft, () => {}), apply, status,
    h('div', { class: 'team-identity-lineup' }, h('div', { class: 'owner-label', text: 'YOUR CONTRACTED DRIVERS' }), ...t.drivers.map((id) => h('strong', { text: `${driverDef(id)!.first} ${driverDef(id)!.name}` }))),
    h('p', { class: 'owner-muted', text: 'Manage hiring and choose which car you control in the Drivers tab.' }));
}
