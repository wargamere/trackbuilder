import { team, type CareerSave } from '../career/career.ts';
import { money } from '../career/owner.ts';
import { driverDef } from '../career/roster.ts';
import { hireDriver, marketDrivers, recruitmentOpen, updateTeamIdentity } from '../career/teamManagement.ts';
import { button, h } from './dom.ts';
import { liveryFields, driverMarket } from './teamCreation.ts';

const seatFor = new WeakMap<CareerSave, 0 | 1>();

export function recruitmentView(save: CareerSave, changed: () => void): HTMLElement {
  const section = h('section', { class: 'team-recruitment' }, h('div', { class: 'owner-label', text: 'DRIVER CONTRACTS' }), h('h3', { text: 'Build your lineup.' }));
  if (!recruitmentOpen(save)) {
    section.append(h('p', { class: 'owner-muted', text: 'Your driver contracts are locked for this season. Recruitment reopens at the start of next season, before you qualify for its first race.' }));
    return section;
  }
  const current = team(save.team, save);
  const seat = seatFor.get(save) ?? 0;
  const controls = h('div', { class: 'team-seat-selection' });
  for (const i of [0, 1] as const) {
    const d = driverDef(current.drivers[i])!;
    const b = button(`Seat ${i + 1} · ${d.name}`, () => { seatFor.set(save, i); changed(); }, { class: seat === i ? 'on' : '' });
    b.tabIndex = 0; b.setAttribute('aria-pressed', String(seat === i)); controls.append(b);
  }
  section.append(h('p', { class: 'owner-muted', text: `Choose a seat to replace, then sign a driver. Fees are paid immediately from your ${money(save.owner!.cash)} balance. A previous signing fee is not refunded.` }), controls,
    driverMarket(marketDrivers(save), current.drivers, seat, (id) => { if (hireDriver(save, seat, id)) changed(); }, save.owner!.cash, true));
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
