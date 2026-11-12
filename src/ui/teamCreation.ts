import { CAREER, type DriverDef, type RaceLength, type SeasonLength } from '../config/career.ts';
import { AI } from '../config/race.ts';
import { GP_DRIVERS, GP_TEAMS, RESERVE_DRIVERS } from '../config/grandPrix.ts';
import type { CareerSave } from '../career/career.ts';
import { money } from '../career/owner.ts';
import { driverDef, driverFee, FOUNDING_BUDGET } from '../career/roster.ts';
import { createCustomCareer, type CreateTeamOptions } from '../career/teamManagement.ts';
import { button, h, segmented, slider } from './dom.ts';

export interface TeamDraft extends CreateTeamOptions { seat: 0 | 1; }
export const freshTeamDraft = (): TeamDraft => ({ principal: '', name: 'My Racing Team', paint: 0x7657ed, secondary: 0x61e2be, drivers: ['gp-alborne', 'gp-behrman'], difficulty: 50, length: 'medium', rounds: 'standard', seat: 0 });
export const colourHex = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const title = (step: string, name: string) => h('div', { class: 'team-section-title' }, h('b', { text: step }), h('h3', { text: name }));

export function driverMarket(drivers: readonly DriverDef[], picked: readonly string[], seat: 0 | 1, choose: (id: string) => void, cash = Infinity, hiring = false): HTMLElement {
  const grid = h('div', { class: 'team-driver-market' });
  for (const driver of [...drivers].sort((a, b) => b.skill - a.skill)) {
    const selected = picked[seat] === driver.id;
    const other = picked[1 - seat] === driver.id;
    const b = button('', () => choose(driver.id), { class: `team-market-driver${selected ? ' selected' : ''}` });
    b.tabIndex = 0;
    b.setAttribute('aria-label', `Hire ${driver.first} ${driver.name} for seat ${seat + 1}`);
    b.setAttribute('aria-pressed', String(selected));
    b.disabled = other || (hiring && selected) || driverFee(driver.id) > cash;
    const source = GP_TEAMS.find((t) => t.drivers.includes(driver.id))?.name ?? CAREER.teams.find((t) => t.drivers.includes(driver.id))?.name ?? 'Free agent';
    b.append(h('div', { class: 'team-market-heading' }, h('span', { class: 'team-market-code', text: driver.code }), h('b', { text: `${Math.round(driver.skill * 100)} OVR` })), h('strong', { text: `${driver.first} ${driver.name}` }), h('small', { text: source }),
      h('span', { class: 'team-market-fee', text: other ? 'SIGNED TO YOUR OTHER SEAT' : selected ? 'SELECTED FOR THIS SEAT' : `${money(driverFee(driver.id))} signing fee` }));
    grid.append(b);
  }
  return grid;
}

export function liveryFields(draft: { paint: number; secondary: number }, changed: () => void): HTMLElement {
  const row = h('div', { class: 'team-colour-fields' });
  for (const [key, label] of [['paint', 'Primary colour'], ['secondary', 'Accent colour']] as const) {
    const input = h('input'); input.type = 'color'; input.value = colourHex(draft[key]); input.setAttribute('aria-label', label);
    const value = h('b', { text: input.value.toUpperCase() });
    input.addEventListener('input', () => { draft[key] = parseInt(input.value.slice(1), 16); value.textContent = input.value.toUpperCase(); changed(); });
    row.append(h('label', {}, h('span', { text: label }), h('div', {}, input, value)));
  }
  return row;
}

export function teamCreation(draft: TeamDraft, render: () => void, start: (save: CareerSave) => void, back: () => void, takeover: () => void, preview: () => void): { body: Node[]; primary: () => void } {
  const label = (text: string) => h('span', { class: 'label', text });
  const status = h('p', { class: 'team-create-error' }); status.setAttribute('role', 'status');
  const launch = () => {
    const save = createCustomCareer(draft);
    if (!save) { status.textContent = 'Enter your principal and team names, then choose two different drivers.'; return; }
    start(save);
  };
  const launchButton = button('Start career', launch, { class: 'primary', icon: '🏁', key: 'Enter' }); launchButton.tabIndex = 0;
  const validation = () => { launchButton.disabled = !draft.principal.trim() || !draft.name.trim() || draft.drivers[0] === draft.drivers[1]; };
  const name = h('input', { class: 'text-input team-name-input' }); name.value = draft.name; name.maxLength = 28; name.setAttribute('aria-label', 'Team name');
  name.addEventListener('input', () => { draft.name = name.value; validation(); });
  const principal = h('input', { class: 'text-input career-name' }); principal.value = draft.principal; principal.maxLength = 14; principal.placeholder = 'Your name'; principal.setAttribute('aria-label', 'Team principal name');
  principal.addEventListener('input', () => { draft.principal = principal.value; validation(); });
  for (const input of [principal, name]) input.addEventListener('keydown', (e) => { if (!['Escape', 'Enter', 'NumpadEnter'].includes(e.code)) e.stopPropagation(); });
  const lengths = segmented<RaceLength>([['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']], (value) => { draft.length = value; render(); }); lengths.set(draft.length);
  const seasons = segmented<SeasonLength>([['short', '8 races'], ['standard', '16 races'], ['full', '24 races']], (value) => { draft.rounds = value; render(); }); seasons.set(draft.rounds);
  const speed = slider(1, AI.maxDifficulty, 1, (n) => draft.difficulty = n, () => {}, (n) => `${n}%`); speed.set(draft.difficulty);
  const seats = h('div', { class: 'team-seat-selection' });
  for (const i of [0, 1] as const) {
    const d = driverDef(draft.drivers[i])!;
    const b = button('', () => { draft.seat = i; render(); }, { class: draft.seat === i ? 'on' : '' }); b.tabIndex = 0; b.setAttribute('aria-label', `Choose driver for seat ${i + 1}`); b.setAttribute('aria-pressed', String(draft.seat === i));
    b.append(h('small', { text: `SEAT ${i + 1}` }), h('strong', { text: `${d.first} ${d.name}` }), h('span', { text: `${money(driverFee(d.id))} · ${Math.round(d.skill * 100)} OVR` })); seats.append(b);
  }
  const fees = draft.drivers.reduce((sum, id) => sum + driverFee(id), 0);
  validation();
  return { primary: launch, body: [
    h('div', { class: 'team-create-heading' }, h('div', {}, label('YOUR TEAM. YOUR COLOURS. YOUR DRIVERS.'), h('h2', { text: 'Build your own team.' }), h('p', { text: 'Join 11 GP-inspired rivals as a new twelfth team. Pick your identity and sign two drivers before your first race.' })), button('Take over an existing team', takeover)),
    h('div', { class: 'team-create-layout' },
      h('section', { class: 'team-create-identity' }, title('01', 'Team identity'), h('label', {}, label('Team principal name'), principal), h('label', {}, label('Team name'), name), liveryFields(draft, preview), h('div', { class: 'owner-garage team-create-garage' }),
        title('03', 'Your championship'), label('Race length'), lengths.el, label('Season length'), seasons.el, label('AI difficulty'), speed.el),
      h('section', { class: 'team-create-hiring' }, title('02', 'Hire your two drivers'), h('p', { class: 'team-create-help', text: 'Choose a seat, then a driver. Signing fees come from your $12m founding budget. Rival vacancies are filled by reserves.' }), seats,
        driverMarket([...GP_DRIVERS, ...RESERVE_DRIVERS], draft.drivers, draft.seat, (id) => { draft.drivers[draft.seat] = id; render(); }),
        h('div', { class: 'team-create-budget' }, h('div', {}, label('FOUNDING BUDGET'), h('strong', { text: money(FOUNDING_BUDGET) })), h('div', {}, label('SIGNING FEES'), h('strong', { text: `−${money(fees)}` })), h('div', {}, label('AVAILABLE TO RUN THE TEAM'), h('strong', { text: money(FOUNDING_BUDGET - fees) }))))),
    status, h('footer', { class: 'team-create-footer' }, button('Main menu', back, { key: 'Esc' }), h('span', { text: `${money(FOUNDING_BUDGET - fees)} remaining after both driver signings.` }), launchButton),
  ] };
}
