import type { CareerSave } from '../career/career.ts';
import { adaptPart, assignBlock, assignUpgrade, buildBlock, buildQuote, capSpent, carDevelopment, copiesNeeded, costCap, ENGINEERING_AREAS, engineering, engineeringCapacity, facilityPrice, improveEngineering, manufacture, PARTS, researchBlock, researchDays, researchPrice, resourceIncome, setWorkforce, startResearch } from '../career/engineering.ts';
import { money } from '../career/owner.ts';
import { driverDef, teamsFor } from '../career/roster.ts';
import { researchMultiplier } from '../career/dynasty.ts';
import { button, h } from './dom.ts';
import { partLapGain } from '../career/circuitPace.ts';
import { DEVELOPMENT } from '../config/development.ts';
import { builtInTrack } from '../editor/pipeline.ts';

/** The next round's circuit (the last one once the season's over). */
const nextTrack = (save: CareerSave) => builtInTrack(save.calendar[Math.min(save.done.length, save.calendar.length - 1)]);

/** What part `id` would save a lap on car `seat` at the next circuit, in words (null for durability, or no circuit). */
function lapGainText(save: CareerSave, id: string, seat: 0 | 1, multiplier = 1): string | null {
  const track = nextTrack(save), p = PARTS.find((x) => x.id === id);
  if (!track || !p || p.area === 'durability') return null;
  return `−${partLapGain(save, id, seat, track, multiplier).toFixed(3)} s a lap at ${track.def.name}`;
}

type Page = 'research' | 'production' | 'allocation' | 'history';
const selection = new WeakMap<CareerSave, string>(), rush = new WeakMap<CareerSave, boolean>();
const label = (text: string) => h('div', { class: 'owner-label', text });
const stat = (name: string, text: string) => h('div', { class: 'owner-stat' }, label(name), h('strong', { text }));
const action = (text: string, fn: () => void, disabled = false, primary = false) => { const b = button(text, fn, { class: primary ? 'primary' : '' }); b.tabIndex = 0; b.disabled = disabled; return b; };
const intro = (title: string, copy: string) => h('div', { class: 'owner-section-intro' }, label('ENGINEERING'), h('h1', { text: title }), h('p', { class: 'owner-muted', text: copy }));
function progress(days: number, total: number): HTMLElement {
  const el = h('progress'); el.max = total; el.value = total - days; el.setAttribute('aria-label', `${days} days remaining`); return el;
}
function jobs(save: CareerSave, type: 'research' | 'production'): HTMLElement {
  const e = engineering(save), list = h('div', { class: 'engineering-jobs' });
  for (const j of e[type]) list.append(h('article', {}, h('strong', { text: PARTS.find((p) => p.id === j.part)!.name }), h('span', { text: `${j.days} days remaining${j.copies ? ` · ${j.copies} copies` : ''}` }), progress(j.days, j.total)));
  if (!e[type].length) list.append(h('p', { class: 'owner-muted', text: type === 'research' ? 'No active research. Choose a design below.' : 'No active manufacturing orders.' }));
  return list;
}
export function engineeringView(save: CareerSave, page: Page, changed: () => void, navigate: (tab: 'development' | 'manufacturing' | 'upgrades' | 'facilities') => void): HTMLElement {
  const e = engineering(save), selected = PARTS.find((p) => p.id === selection.get(save)) ?? PARTS[0];
  const root = h('section', { class: `owner-card engineering-page engineering-${page}` });
  if (page === 'research') {
    root.append(intro('Research', 'Spend resource points to unlock designs. Research alone does not upgrade a car: build copies in Development, then fit them in Assign upgrades.'),
      h('div', { class: 'owner-status-strip' }, stat('RESOURCE POINTS', e.rp.toLocaleString()), stat('NEXT WEEKEND INCOME', `+${resourceIncome(save)} RP`), stat('SEASON PROGRAMME', `${e.researched.length} / 16`), stat('RESEARCH SLOTS', `${e.research.length} / ${engineeringCapacity(save, 'research')}`)),
      h('p', { class: 'owner-muted', text: `Season ${save.season} research starts with minor upgrades. Previous seasons’ retained fitted gains are integrated into your car foundations; completing this tree is not the limit of your whole career.` }), jobs(save, 'research'));
    if (save.owner!.project) root.append(h('p', { class: 'engineering-regulation', text: `Your previously paid upgrade is retained. It will finish after ${save.owner!.research?.remaining ?? 1} more race(s) and improve both cars. New upgrades use the research, manufacturing and fitting process below.` }));
    const areas = h('div', { class: 'engineering-areas segmented' }); areas.setAttribute('role', 'group'); areas.setAttribute('aria-label', 'Research department');
    for (const area of ENGINEERING_AREAS) { const b = action(area.name, () => { selection.set(save, `${area.id}-1`); changed(); }); b.classList.toggle('on', selected.area === area.id); b.setAttribute('aria-pressed', String(selected.area === area.id)); areas.append(b); }
    const tree = h('div', { class: 'engineering-tree' }); tree.setAttribute('aria-label', `${ENGINEERING_AREAS.find((a) => a.id === selected.area)!.name} research tree`);
    for (const p of PARTS.filter((p) => p.area === selected.area)) {
      const done = e.researched.includes(p.id), pending = e.research.some((j) => j.part === p.id), locked = p.requires && !e.researched.includes(p.requires);
      const b = action('', () => { selection.set(save, p.id); changed(); }); b.className += ` engineering-node${p.id === selected.id ? ' selected' : ''}${done ? ' complete' : ''}`;
      b.setAttribute('aria-label', `Select ${p.name}`); b.setAttribute('aria-pressed', String(p.id === selected.id));
      b.append(label(['MINOR', 'MAJOR', 'MAJOR', 'ULTIMATE'][p.tier - 1]), h('strong', { text: p.name }), h('span', { text: done ? '✓ Researched' : pending ? 'In research' : locked ? 'Prerequisite required' : `${researchPrice(save, p.id)} RP` })); tree.append(b);
    }
    const multiplier = e.designs[selected.id] ?? e.research.find((j) => j.part === selected.id)?.multiplier ?? researchMultiplier(save);
    // (In performance-index points, on the same scale as every car on the grid: see Vehicle.)
    const areaPI = Math.round(selected.effect * multiplier * DEVELOPMENT.partScale * 700);
    const blocker = researchBlock(save, selected.id), effect = selected.area === 'durability' ? `${(selected.effect * multiplier * 100).toFixed(2)} percentage points less AI failure risk` : `+${areaPI} PI in ${ENGINEERING_AREAS.find((a) => a.id === selected.area)!.name.toLowerCase()} on each car it’s fitted to (+${Math.round(areaPI / 3)} PI overall)`;
    // (What it would give each car it isn't fitted to yet.)
    const gains = selected.area === 'durability' ? null : ([0, 1] as const).map((seat) => (e.fitted[seat].includes(selected.id) ? 'fitted' : lapGainText(save, selected.id, seat, multiplier)));
    const gainText = !gains || !gains[0] ? null : gains[0] === 'fitted' && gains[1] === 'fitted' ? 'Fitted to both cars' : gains[0] === gains[1] ? `${gains[0]}, on either car` : `Car 1: ${gains[0]} · Car 2: ${gains[1]}`;
    root.append(areas, tree, h('section', { class: 'engineering-detail' }, h('div', {}, label(ENGINEERING_AREAS.find((a) => a.id === selected.area)!.name), h('h2', { text: selected.name }), h('p', { text: ENGINEERING_AREAS.find((a) => a.id === selected.area)!.effect }), h('p', { text: effect }),
      gainText ? h('p', { class: 'engineering-lap-gain', text: gainText }) : null,
      h('div', { class: 'owner-stats' }, stat('RESEARCH COST', `${researchPrice(save, selected.id)} RP`), stat('RESEARCH TIME', `${researchDays(save, selected.id)} days`))),
      h('div', { class: 'engineering-detail-action' }, action(blocker ?? `Research ${selected.name}`, () => { if (startResearch(save, selected.id)) changed(); }, !!blocker, true), e.researched.includes(selected.id) ? action('Go to Development', () => navigate('manufacturing')) : h('p', { class: 'owner-muted', text: 'Time advances in 14-day steps when you advance to each race weekend. Research and manufacturing run independently.' }))));
    if (e.regulation) {
      const affected = PARTS.filter((p) => p.area === e.regulation!.area && e.researched.includes(p.id));
      const box = h('section', { class: 'engineering-regulation' }, h('h2', { text: `Season ${e.regulation.season} regulation change` }), h('p', { text: `${ENGINEERING_AREAS.find((a) => a.id === e.regulation!.area)!.name} upgrades must be adapted before the final race or they will be removed next season.` }));
      for (const p of affected) { const adapted = e.regulation.adapted.includes(p.id), cost = Math.ceil(p.rp * .45); box.append(action(adapted ? `${p.name} · protected` : `Adapt ${p.name} · ${cost} RP`, () => { if (adaptPart(save, p.id)) changed(); }, adapted || e.rp < cost || !!save.grid)); }
      if (!affected.length) box.append(h('p', { text: 'You have no researched designs affected by this change.' })); root.append(box);
    }
  } else if (page === 'production') {
    root.append(intro('Development', 'Manufacture researched designs. One copy arrives sooner; two copies together cost less per car and take longer. Each copy must pass quality control.'), jobs(save, 'production'));
    const mode = h('div', { class: 'segmented engineering-build-mode' });
    for (const [value, name] of [[false, 'Standard production'], [true, 'Rushed production']] as const) { const b = action(name, () => { rush.set(save, value); changed(); }); b.classList.toggle('on', !!rush.get(save) === value); b.setAttribute('aria-pressed', String(!!rush.get(save) === value)); mode.append(b); }
    root.append(mode, h('p', { class: 'owner-muted', text: 'Rushing costs 40% more and adds 15 percentage points to failure risk. Failed copies must be ordered again; the research is retained.' }));
    const list = h('div', { class: 'engineering-build-list' });
    for (const p of PARTS.filter((p) => e.researched.includes(p.id))) {
      const card = h('article', { class: 'engineering-build-card' }, label(ENGINEERING_AREAS.find((a) => a.id === p.area)!.name), h('h2', { text: p.name }), h('p', { text: `${e.stock[p.id] ?? 0} in stock · ${e.fitted.filter((car) => car.includes(p.id)).length}/2 cars fitted · ${copiesNeeded(save, p.id)} copies still needed` }));
      const choices = h('div', { class: 'engineering-build-choices' });
      for (const count of [1, 2] as const) {
        const q = buildQuote(save, p.id, count, rush.get(save)), blocked = buildBlock(save, p.id, count, rush.get(save));
        const b = action(blocked ?? `Build ${count === 1 ? 'one copy' : 'two copies'} · ${money(q.cost)}`, () => { if (manufacture(save, p.id, count, rush.get(save))) changed(); }, !!blocked, true);
        b.setAttribute('aria-label', `Build ${count} ${p.name}`);
        choices.append(h('div', {}, h('strong', { text: `${count === 1 ? 'One car' : 'Both cars'} · ${q.days} days` }), h('p', { text: `${money(q.cost)} total · ${(q.risk * 100).toFixed(1)}% failure risk per copy` }), b));
      }
      card.append(choices); list.append(card);
    }
    if (!e.researched.length) list.append(h('p', { class: 'owner-empty', text: 'No designs are ready to manufacture. Complete research first.' }), action('Open Research', () => navigate('development')));
    root.append(list);
  } else if (page === 'allocation') {
    root.append(intro('Assign upgrades', 'A design improves only the car it is fitted to. Giving the first copy to one driver costs the other driver 3 morale. Balance their equipment to keep the team working together.'));
    const columns = h('div', { class: 'engineering-car-columns' }), team = teamsFor(save).find((t) => t.id === save.team)!;
    for (const seat of [0, 1] as const) {
      const d = driverDef(team.drivers[seat])!, effects = carDevelopment(save, d.id);
      const card = h('section', {}, label(`CAR ${seat + 1}`), h('h2', { text: `${d.first} ${d.name}` }), h('p', { text: `${e.fitted[seat].length} upgrades fitted · ${Math.round(save.owner!.world?.drivers[d.id]?.morale ?? 65)}% morale` }), h('div', { class: 'engineering-car-effects' }, ...ENGINEERING_AREAS.map((a) => stat(a.name, a.id === 'durability' ? (effects[a.id] > 0 ? `−${(effects[a.id] * 100).toFixed(1)}% risk` : '—') : `+${Math.round(effects[a.id] * DEVELOPMENT.partScale * 700)} PI`))));
      for (const p of PARTS.filter((p) => e.researched.includes(p.id))) {
        const blocked = assignBlock(save, p.id, seat), fitted = e.fitted[seat].includes(p.id);
        const gain = fitted ? null : lapGainText(save, p.id, seat, e.designs[p.id] ?? 1);
        card.append(h('div', { class: 'engineering-fit-row' }, h('div', {}, h('strong', { text: p.name }), h('small', { text: fitted ? 'Fitted to this car' : `${e.stock[p.id] ?? 0} available in stock${gain ? ` · ${gain}` : ''}` })), action(blocked ?? 'Fit upgrade', () => { if (assignUpgrade(save, p.id, seat)) changed(); }, !!blocked)));
      }
      if (!e.researched.length) card.append(h('p', { class: 'owner-muted', text: 'No upgrades yet. Research a design, then manufacture copies.' })); columns.append(card);
    }
    root.append(columns);
  } else {
    root.append(intro('Progress history', 'Research, deliveries, manufacturing failures, practice rewards and regulation changes are recorded here.'));
    const list = h('ol', { class: 'engineering-history' }); for (const item of e.history) list.append(h('li', {}, label(`SEASON ${item.season} / ROUND ${item.round}`), h('strong', { text: item.title }), h('p', { text: item.detail })));
    if (!e.history.length) list.append(h('li', { text: 'No engineering activity yet.' })); root.append(list);
  }
  return root;
}

export function engineeringFacilities(save: CareerSave, changed: () => void): HTMLElement {
  const e = engineering(save), root = h('section', { class: 'engineering-facilities' }, h('h2', { text: 'Engineering workforce' }), h('p', { class: 'owner-muted', text: 'More staff generate resource points and shorten new projects. Recruitment costs $10k per person. Engineering payroll is $4.5k per person after each race.' }));
  root.append(h('div', { class: 'owner-status-strip' }, stat('WORKFORCE', `${e.workforce} people`), stat('PAYROLL / RACE', money(e.workforce * 4500)), stat('SEASON COST CAP', `${money(capSpent(save))} / ${money(costCap(save))}`)));
  root.append(h('div', { class: 'menu row' }, action('Reduce workforce by 10', () => { if (setWorkforce(save, e.workforce - 10)) changed(); }, !!save.grid || e.workforce <= 20), action('Hire 10 engineers · $100k', () => { if (setWorkforce(save, e.workforce + 10)) changed(); }, !!save.grid || e.workforce >= 100 || save.owner!.cash < 100_000 || capSpent(save) + 100_000 > costCap(save))));
  const grid = h('div', { class: 'engineering-facility-grid' });
  for (const [id, name, detail] of [['research', 'Research centre', 'Each level reduces new research time by 8%. Level 2 opens a second research slot.'], ['manufacturing', 'Manufacturing centre', 'Each level reduces new build time by 8%. Level 2 opens a second manufacturing slot.'], ['quality', 'Quality control', 'Each level reduces per-copy manufacturing failure risk by 1.8 percentage points.']] as const) {
    const cost = facilityPrice(save, id), max = e.facilities[id] >= 3;
    grid.append(h('article', {}, label(`LEVEL ${e.facilities[id]} / 3`), h('h3', { text: name }), h('p', { text: detail }), action(max ? 'Fully upgraded' : `Improve ${name} · ${money(cost)}`, () => { if (improveEngineering(save, id)) changed(); }, max || !!save.grid || save.owner!.cash < cost || capSpent(save) + cost > costCap(save), true)));
  }
  root.append(grid); return root;
}

export function practiceProgrammes(save: CareerSave): HTMLElement {
  const p = engineering(save).practice, current = p.key === `${save.season}:${save.done.length}`;
  return h('section', { class: 'engineering-practice' }, h('h3', { text: 'Practice programmes' }), h('p', { class: 'owner-muted', text: 'Earn RP through valid practice laps. Each programme pays once per race weekend; restarting practice does not reset rewards.' }),
    ...[['clean-lap', 'Complete one valid lap', '100 RP'], ['qualifying-pace', 'Lap within 112% of the reference pace', '150 RP'], ['race-run', 'Complete three valid practice laps', '200 RP']].map(([id, name, reward]) => h('div', {}, h('span', { text: current && p.rewards.includes(id) ? '✓' : '○' }), h('span', { text: name }), h('strong', { text: reward }))));
}
