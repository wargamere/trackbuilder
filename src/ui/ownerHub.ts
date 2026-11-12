import { carRank, carRating, driverStandings, lineup, raceLaps, roundWeather, team, teamStandings, type CareerSave } from '../career/career.ts';
import { money, selectDriver } from '../career/owner.ts';
import { driverDef } from '../career/roster.ts';
import { builtInTrack } from '../editor/pipeline.ts';
import { trackLapTime } from '../race/strategy.ts';
import { button, h } from './dom.ts';
import { circuitMap } from './ownerGraphics.ts';
import { facilitiesView, financeView, ownerLabel as label, ownerStat as stat, vehicleView } from './ownerOperations.ts';
import { identityView, recruitmentView } from './teamManagement.ts';
import { driverDevelopmentView, inboxView, legacyView, personnelView } from './careerCampaign.ts';
import { currentDecision, driverRating, dynasty, managementOpen } from '../career/dynasty.ts';
import { engineering, PARTS } from '../career/engineering.ts';
import { engineeringView, practiceProgrammes } from './engineeringScreen.ts';
import { calendarOpen } from '../career/calendar.ts';

export type OwnerTab = 'race' | 'drivers' | 'development' | 'manufacturing' | 'upgrades' | 'engineeringHistory' | 'facilities' | 'vehicle' | 'teams' | 'finance' | 'identity' | 'calendar' | 'career' | 'inbox' | 'personnel' | 'legacy';
export const OWNER_TABS: [OwnerTab, string][] = [['race', 'Overview'], ['development', 'Engineering'], ['drivers', 'Drivers'], ['teams', 'Championship'], ['finance', 'Team'], ['inbox', 'Inbox']];
const GROUPS: { root: OwnerTab; tabs: [OwnerTab, string][] }[] = [
  { root: 'race', tabs: [] },
  { root: 'development', tabs: [['development', 'Research'], ['manufacturing', 'Development'], ['upgrades', 'Assign upgrades'], ['engineeringHistory', 'Progress history'], ['facilities', 'Facilities'], ['vehicle', 'Vehicle']] },
  { root: 'drivers', tabs: [['drivers', 'Driver lineup'], ['personnel', 'Personnel']] },
  { root: 'teams', tabs: [['teams', 'Standings'], ['calendar', 'Calendar'], ['legacy', 'Legacy']] },
  { root: 'finance', tabs: [['finance', 'Finance'], ['identity', 'My team'], ['career', 'Career settings']] },
  { root: 'inbox', tabs: [] },
];
interface Actions { navigate(tab: OwnerTab): void; changed(): void; weekend: (Node | null)[]; standings: (Node | null)[]; calendar: (Node | null)[]; settings: (Node | null)[] }
const focusable = (b: HTMLButtonElement) => { b.tabIndex = 0; return b; };

export function ownerHeader(save: CareerSave, active: OwnerTab, navigate: Actions['navigate']): HTMLElement {
  const group = GROUPS.find((g) => g.root === active || g.tabs.some(([id]) => id === active)) ?? GROUPS[0];
  const nav = h('nav', { class: 'owner-nav segmented' }); nav.setAttribute('aria-label', 'Team management');
  for (const [id, name] of OWNER_TABS) {
    const b = focusable(button(name, () => navigate(id), { class: group.root === id ? 'on' : '' }));
    b.setAttribute('aria-label', name);
    if (group.root === id) b.setAttribute('aria-current', 'page');
    if (id === 'inbox' && managementOpen(save) && currentDecision(save)) b.append(h('span', { class: 'owner-notification', text: '1' }));
    nav.append(b);
  }
  const sub = h('nav', { class: 'owner-subnav' }); sub.setAttribute('aria-label', 'Section pages');
  for (const [id, name] of group.tabs) { const b = focusable(button(name, () => navigate(id), { class: active === id ? 'on' : '' })); b.setAttribute('aria-pressed', String(active === id)); sub.append(b); }
  const e = engineering(save);
  return h('header', { class: 'owner-top' },
    h('div', { class: 'owner-titlebar' }, h('div', { class: 'owner-brand' }, label(`TEAM OWNER / SEASON ${save.season}`), h('strong', { text: team(save.team, save).name }), h('span', { text: `${save.name} · Team principal` })),
      h('div', { class: 'owner-account' }, focusable(button(`${money(save.owner!.cash)} available`, () => navigate('finance'))), h('span', { text: `${e.rp.toLocaleString()} RP` }))),
    nav, group.tabs.length ? sub : null);
}

function driverCards(save: CareerSave, changed: Actions['changed']): HTMLElement {
  const standings = driverStandings(save), group = h('div', { class: 'owner-drivers' }); group.setAttribute('aria-label', 'Choose your race driver');
  for (const [i, d] of lineup(save).filter((e) => e.team.id === save.team).entries()) {
    const definition = driverDef(d.id)!, row = standings.find((x) => x.id === d.id)!;
    const b = focusable(button('', () => { selectDriver(save, d.id); changed(); }, { class: `owner-driver${d.you ? ' selected' : ''}` }));
    b.setAttribute('aria-label', `Race as ${d.name}`); b.setAttribute('aria-pressed', String(d.you));
    b.append(h('div', { class: 'owner-driver-top' }, label(`CAR ${i + 1}`), h('span', { class: 'owner-driver-check', text: d.you ? '✓ Selected' : 'Select driver' })),
      h('div', { class: 'owner-driver-identity' }, h('span', { class: 'owner-driver-code', text: d.code }), h('div', {}, h('small', { text: definition.first }), h('strong', { text: d.name }))),
      h('div', { class: 'owner-driver-stats', text: `${row.points} points · P${standings.indexOf(row) + 1} · ${Math.round(driverRating(save, d.id) * 100)} rating` }),
      h('span', { class: 'owner-driver-role', text: d.you ? 'You drive this car' : 'AI-controlled teammate' })); group.append(b);
  }
  return group;
}

export function ownerBody(save: CareerSave, round: number, tab: OwnerTab, actions: Actions): HTMLElement {
  const track = builtInTrack(save.calendar[round]), e = engineering(save), w = dynasty(save);
  const standings = teamStandings(save), yours = standings.find((r) => r.yours)!, position = standings.indexOf(yours) + 1;
  const side = h('aside', { class: 'owner-timeline' }, label(`SEASON ${save.season}`), h('h2', { text: `Round ${round + 1} of ${save.calendar.length}` }));
  const events = h('ol');
  for (let i = round; i < Math.min(save.calendar.length, round + 3); i++) {
    const t = builtInTrack(save.calendar[i]); const b = focusable(button('', () => actions.navigate('calendar'), { class: `owner-event${i === round ? ' current' : ''}` }));
    b.setAttribute('aria-label', `View calendar: ${t?.def.name ?? 'Race'}`);
    b.append(h('span', { class: 'owner-event-index', text: String(i + 1) }), h('span', {}, h('strong', { text: t?.def.name ?? 'Race' }), h('small', { text: i === round ? 'Next race weekend' : t?.def.place ?? 'Upcoming' }))); events.append(h('li', {}, b));
  }
  side.append(events, h('div', { class: 'owner-team-position' }, label('CONSTRUCTORS'), h('strong', { text: `P${position} · ${yours.points} points` }), h('p', { text: `Board target: P${save.owner!.target ?? carRank(save, save.team)} or better` })),
    h('p', { class: 'owner-muted', text: 'Plan upgrades before advancing to the race weekend. Research, manufacturing and fitting are separate steps.' }));
  let content: HTMLElement;
  if (tab === 'race') {
    const pending = managementOpen(save) ? currentDecision(save) : null, weather = roundWeather(save, round);
    const prep = h('details', { class: 'owner-preparation' }, h('summary', { text: 'Weekend setup, practice programmes & starting grid' }), practiceProgrammes(save), ...actions.weekend);
    const ready = Object.values(e.stock).reduce((sum, n) => sum + n, 0);
    const inbox = h('section', { class: 'owner-next-decision' }, label('TEAM INBOX'), h('h2', { text: pending?.title ?? 'Team up to date' }),
      h('p', { text: pending ? 'Review the options before qualifying. Your choice affects the team.' : 'Read recent updates and see the consequences of your decisions.' }),
      focusable(button(pending ? 'Review team decision' : 'Open team inbox', () => actions.navigate('inbox'))));
    if (ready) inbox.append(h('p', { class: 'owner-ready-parts', text: `${ready} manufactured ${ready === 1 ? 'part is' : 'parts are'} ready to fit.` }), focusable(button('Assign ready upgrades', () => actions.navigate('upgrades'))));
    const atRisk = e.regulation ? e.researched.filter((id) => PARTS.find((p) => p.id === id)?.area === e.regulation!.area && !e.regulation!.adapted.includes(id)).length : 0;
    if (atRisk) inbox.append(h('p', { class: 'owner-ready-parts', text: `${atRisk} ${atRisk === 1 ? 'design needs' : 'designs need'} regulation adaptation before the final qualifying session.` }), focusable(button('Review regulation changes', () => actions.navigate('development'))));
    content = h('section', { class: 'owner-overview' }, h('div', { class: 'owner-page-heading' }, h('h1', { text: 'Team headquarters' }), h('p', { text: 'Prepare both cars, choose your driver, then go racing.' })),
      calendarOpen(save) ? h('div', { class: 'season-calendar-invite' }, h('span', { text: `Preseason · ${save.calendar.length} rounds scheduled` }), focusable(button('Configure season calendar', () => actions.navigate('calendar')))) : null,
      h('div', { class: 'owner-overview-grid' }, h('section', { class: 'owner-next-event' },
        h('div', { class: 'owner-race-copy' }, label(`ROUND ${round + 1} / ${track?.def.place ?? 'GRAND PRIX'}`), h('h2', {}, track?.def.name ?? 'Race', h('span', { text: 'Grand Prix' })), h('p', { class: 'owner-race-status', text: save.grid ? 'Grid confirmed' : e.advanced === `${save.season}:${round}` ? 'At the race weekend' : 'Planning before the race weekend' })),
        track ? h('div', { class: 'owner-map-wrap' }, circuitMap(track)) : null,
        h('div', { class: 'owner-race-facts' }, stat('FORECAST', weather), stat('DISTANCE', track ? `${raceLaps(save.length, trackLapTime(track))} laps` : '—'), stat('CAR RATING', `${Math.round(carRating(save, save.team) * 100)}%`))), inbox),
      h('div', { class: 'owner-section-heading' }, h('h2', { text: 'Choose your race driver' }), h('span', { text: 'Both cars score for your team' })), driverCards(save, actions.changed),
      h('section', { class: 'owner-status-strip', 'data-testid': 'campaign-command' }, stat('BOARD CONFIDENCE', `${Math.round(w.confidence)}%`), stat('RESEARCH', `${e.research.length} active`), stat('MANUFACTURING', `${e.production.length} active`), stat('PARTS TO FIT', String(ready))), prep);
  } else if (['development', 'manufacturing', 'upgrades', 'engineeringHistory'].includes(tab)) {
    content = engineeringView(save, tab === 'manufacturing' ? 'production' : tab === 'upgrades' ? 'allocation' : tab === 'engineeringHistory' ? 'history' : 'research', actions.changed, actions.navigate);
  } else if (tab === 'drivers') content = h('section', { class: 'owner-card' }, label('DRIVERS'), h('h1', { text: 'Your driver lineup' }), h('p', { class: 'owner-muted', text: 'Choose which car to drive. Training, morale and development stay with your team.' }), driverCards(save, actions.changed), driverDevelopmentView(save, actions.changed), recruitmentView(save, actions.changed));
  else if (tab === 'personnel') content = personnelView(save, actions.changed);
  else if (tab === 'inbox') content = inboxView(save, actions.changed);
  else if (tab === 'legacy') content = legacyView(save);
  else if (tab === 'finance') content = financeView(save, actions.changed);
  else if (tab === 'facilities') content = facilitiesView(save, actions.changed);
  else if (tab === 'vehicle') content = vehicleView(save, () => actions.navigate('development'));
  else if (tab === 'identity') content = identityView(save, actions.changed);
  else content = h('section', { class: 'owner-card owner-data' }, h('h1', { text: tab === 'teams' ? 'Championship standings' : tab === 'calendar' ? 'Season calendar' : 'Career settings' }), ...(tab === 'teams' ? actions.standings : tab === 'calendar' ? actions.calendar : actions.settings));
  return h('div', { class: 'owner-layout', 'data-tab': tab }, side, content);
}
