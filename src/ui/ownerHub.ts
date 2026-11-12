import { carRank, driverStandings, lineup, raceLaps, roundWeather, team, teamStandings, type CareerSave } from '../career/career.ts';
import { money, RESEARCH, selectDriver, sponsorFor } from '../career/owner.ts';
import { driverDef, teamsFor } from '../career/roster.ts';
import { builtInTrack } from '../editor/pipeline.ts';
import { trackLapTime } from '../race/strategy.ts';
import { button, h } from './dom.ts';
import { circuitMap } from './ownerGraphics.ts';
import { developmentView, facilitiesView, financeView, ownerLabel as label, ownerStat as stat, vehicleView } from './ownerOperations.ts';
import { identityView, recruitmentView } from './teamManagement.ts';
import { campaignPulse, driverDevelopmentView, inboxView, legacyView, personnelView, weekendPlanView } from './careerCampaign.ts';
import { currentDecision, driverRating, dynasty, managementOpen, operatingCosts } from '../career/dynasty.ts';

export type OwnerTab = 'race' | 'drivers' | 'development' | 'facilities' | 'vehicle' | 'teams' | 'finance' | 'identity' | 'calendar' | 'career' | 'inbox' | 'personnel' | 'legacy';
export const OWNER_TABS: [OwnerTab, string][] = [['race', 'Overview'], ['drivers', 'Drivers'], ['development', 'Development'], ['facilities', 'Facilities'], ['vehicle', 'Vehicle'], ['teams', 'Standings'], ['finance', 'Finance'], ['identity', 'My team'], ['inbox', 'Team inbox'], ['personnel', 'Personnel'], ['legacy', 'Legacy']];
interface Actions {
  navigate(tab: OwnerTab): void;
  changed(): void;
  weekend: (Node | null)[];
  standings: (Node | null)[];
  calendar: (Node | null)[];
  settings: (Node | null)[];
}

const focusable = (b: HTMLButtonElement) => { b.tabIndex = 0; return b; };

export function ownerHeader(save: CareerSave, active: OwnerTab, navigate: Actions['navigate']): HTMLElement {
  const nav = h('nav', { class: 'owner-nav' });
  nav.setAttribute('aria-label', 'Team management');
  for (const [i, [id, name]] of OWNER_TABS.entries()) {
    const b = focusable(button(name, () => navigate(id), { class: active === id ? 'on' : '' }));
    const index = h('span', { class: 'owner-nav-index', text: String(i + 1).padStart(2, '0') });
    index.setAttribute('aria-hidden', 'true');
    b.prepend(index);
    if (id === 'inbox' && managementOpen(save) && currentDecision(save)) b.append(h('i', { class: 'campaign-nav-dot' }));
    if (active === id) b.setAttribute('aria-current', 'page');
    nav.append(b);
  }
  return h('header', { class: 'owner-top' },
    h('div', { class: 'owner-brand' }, h('b', { text: 'TB' }), h('span', {}, 'TEAM OWNER', h('small', { text: `CHAMPIONSHIP / SEASON ${String(save.season).padStart(2, '0')}` }))), nav,
    h('div', { class: 'owner-account' }, h('strong', { text: team(save.team, save).name }), h('span', { text: `${save.name} · Team principal` }), focusable(button(`FUNDS ${money(save.owner!.cash)}`, () => navigate('finance'), { class: 'owner-funds' }))));
}

function driverCards(save: CareerSave, changed: Actions['changed']): HTMLElement {
  const drivers = lineup(save).filter((d) => d.team.id === save.team);
  const standings = driverStandings(save);
  const group = h('div', { class: 'owner-drivers' });
  group.setAttribute('aria-label', 'Choose your race driver');
  for (const [i, d] of drivers.entries()) {
    const rating = driverDef(d.id)!;
    const row = standings.find((x) => x.id === d.id)!;
    const b = focusable(button('', () => { selectDriver(save, d.id); changed(); }, { class: `owner-driver${d.you ? ' selected' : ''}` }));
    b.setAttribute('aria-label', `Race as ${d.name}`);
    b.setAttribute('aria-pressed', String(d.you));
    const meter = h('div', { class: 'owner-meter driver-rating' }, h('i'));
    (meter.firstElementChild as HTMLElement).style.width = `${driverRating(save, d.id) * 100}%`;
    b.append(h('div', { class: 'owner-driver-top' }, label(`DRIVER 0${i + 1}`), h('span', { class: 'owner-driver-check', text: d.you ? '✓' : '+' })),
      h('div', { class: 'owner-driver-identity' }, h('span', { class: 'owner-driver-code', text: d.code }), h('div', {}, h('small', { text: rating.first }), h('strong', { text: d.name }))),
      h('div', { class: 'owner-driver-stats' }, h('span', {}, h('b', { text: String(row.points) }), ' PTS'), h('span', {}, h('b', { text: `P${standings.indexOf(row) + 1}` }), ' WDC'), h('span', {}, h('b', { text: String(Math.round(driverRating(save, d.id) * 100)) }), ' RATING')),
      meter, h('span', { class: 'owner-driver-role', text: d.you ? '● YOU WILL DRIVE' : 'AI DRIVER · SELECT TO DRIVE' }));
    group.append(b);
  }
  return group;
}

function operations(save: CareerSave, navigate: Actions['navigate']): HTMLElement {
  const o = save.owner!;
  const project = RESEARCH.find((r) => r.id === o.research?.id) ?? RESEARCH[1];
  const tile = (title: string, value: string, detail: string, tab: OwnerTab, icon: string) => {
    const b = focusable(button('', () => navigate(tab), { class: 'owner-operation' }));
    b.append(h('span', { class: 'owner-operation-icon', text: icon }), label(title), h('strong', { text: value }), h('small', { text: detail }), h('span', { class: 'owner-operation-arrow', text: '↗' }));
    return b;
  };
  return h('div', { class: 'owner-operations' },
    tile('DEVELOPMENT', o.project ? project.name : 'Workshop ready', o.project ? `Delivery in ${o.research?.remaining ?? 1} round(s)` : `${o.development}/5 packages this season`, 'development', '↗'),
    tile('YOUR PEOPLE', `${Object.keys(dynasty(save).staff).length} specialists appointed`, `${money(operatingCosts(save))} operations / race`, 'personnel', '◈'),
    tile('HEADQUARTERS', `Level ${o.facilities} facilities`, `${money(o.facilities * 250_000)} additional / race`, 'facilities', '▥'));
}

export function ownerBody(save: CareerSave, round: number, tab: OwnerTab, actions: Actions): HTMLElement {
  const o = save.owner!;
  const mine = team(save.team, save);
  const track = builtInTrack(save.calendar[round]);
  const constructors = teamStandings(save);
  const row = constructors.find((t) => t.yours)!;
  const position = constructors.indexOf(row) + 1;
  const selected = lineup(save).find((e) => e.you)!;
  const weather = roundWeather(save, round);
  const ahead = constructors[position - 2];
  const target = o.target ?? teamsFor(save).findIndex((t) => t.id === save.team) + 1;
  const side = h('aside', { class: 'owner-timeline' }, label('YOUR SEASON'),
    h('h2', {}, `ROUND ${String(round + 1).padStart(2, '0')}`, h('small', { text: `/ ${save.calendar.length}` })),
    h('div', { class: 'owner-season-progress' }, ...save.calendar.map((_, i) => h('i', { class: i < round ? 'done' : i === round ? 'current' : '' }))));
  const events = h('ol');
  for (let i = Math.max(0, round - 1); i < Math.min(save.calendar.length, round + 4); i++) {
    const t = builtInTrack(save.calendar[i]);
    const b = focusable(button('', () => actions.navigate('calendar'), { class: `owner-event${i === round ? ' current' : ''}` }));
    b.setAttribute('aria-label', `View calendar: ${t?.def.name ?? 'Race'}`);
    b.append(h('span', { class: 'owner-event-index', text: save.done[i] ? '✓' : String(i + 1).padStart(2, '0') }),
      h('span', {}, h('strong', { text: t?.def.name ?? 'Race weekend' }), h('small', { text: save.done[i] ? 'RACE COMPLETED' : i === round ? 'RACE WEEKEND · UP NEXT' : t?.def.place?.toUpperCase() ?? 'UPCOMING GRAND PRIX' })));
    events.append(h('li', {}, b));
  }
  side.append(events, focusable(button('Full calendar ↗', () => actions.navigate('calendar'), { class: 'owner-text-button' })),
    h('div', { class: 'owner-team-position' }, label('CONSTRUCTORS’ CHAMPIONSHIP'), h('strong', {}, `P${position}`, h('small', { text: `/ ${constructors.length}` })),
      h('p', { text: `${row.points} POINTS · ${row.wins} WINS` }), h('span', { class: 'owner-gap', text: save.done.length ? ahead ? `${ahead.points - row.points} pts to ${ahead.team.name}` : 'Leading the championship' : 'A new season. A fresh opportunity.' })),
    h('div', { class: 'owner-objective' }, label('SEASON OBJECTIVE'), h('strong', { text: `Finish P${target} or better` }), h('p', { text: save.done.length ? position <= target ? '● Currently on target' : `${position - target} position(s) to gain` : 'Make your mark in the constructors’ championship.' })));

  let content: HTMLElement;
  if (tab === 'race') {
    const prep = h('details', { class: 'owner-preparation' }, h('summary', { text: 'Weekend setup & starting grid' }), ...actions.weekend);
    const event = h('section', { class: 'owner-next-event' },
      h('div', { class: 'owner-race-copy' }, label(`ROUND ${round + 1} / ${save.calendar.length} · ${track?.def.place?.toUpperCase() ?? 'GRAND PRIX'}`),
        h('h2', {}, track?.def.name ?? 'Race', h('span', { text: 'GRAND PRIX' })),
        h('div', { class: 'owner-race-status', text: save.grid ? '● GRID CONFIRMED · READY TO RACE' : '● NEXT SESSION · QUALIFYING' })),
      track ? h('div', { class: 'owner-map-wrap' }, circuitMap(track), h('span', { text: '● START / FINISH' })) : null,
      h('div', { class: 'owner-race-facts' }, stat('FORECAST', weather === 'rain' ? 'RAIN' : weather === 'changing' ? 'CHANGING' : 'DRY'), stat('CIRCUIT', track ? `${(track.center.length / 1000).toFixed(2)} KM` : '—'), stat('RACE DISTANCE', track ? `${raceLaps(save.length, trackLapTime(track))} LAPS` : '—'), stat('YOUR DRIVER', selected.code)));
    content = h('section', { class: 'owner-overview' },
      h('div', { class: 'owner-page-heading' }, h('div', {}, label('TEAM PRINCIPAL OVERVIEW'), h('h1', { text: 'Race weekend.' })), h('span', { class: 'owner-live', text: '● ALL SYSTEMS READY' })),
      campaignPulse(save, actions.navigate), event, weekendPlanView(save, actions.changed), h('div', { class: 'owner-section-heading' }, label('CHOOSE YOUR RACE DRIVER'), h('span', { text: 'Your other car runs with the AI' })), driverCards(save, actions.changed),
      operations(save, actions.navigate),
      h('div', { class: 'owner-briefing' }, h('span', { class: 'owner-briefing-icon', text: '◉' }), h('div', {}, label('RACE ENGINEER’S BRIEFING'), h('p', { text: weather === 'rain' ? 'Wet conditions expected. Start on wets, brake earlier and protect the car. Both drivers’ points count.' : weather === 'changing' ? 'Rain is on the way. Watch the wetness indicator and be ready to switch tyres as conditions change.' : 'Dry conditions expected. Check your starting tyres and car setup before qualifying. Bring both cars home.' }))), prep);
  } else if (tab === 'drivers') {
    const form = h('div', { class: 'owner-driver-form' });
    for (const d of lineup(save).filter((e) => e.team.id === save.team)) {
      const standing = driverStandings(save).find((r) => r.id === d.id)!;
      form.append(h('section', {}, label(`${d.name.toUpperCase()} · RECENT FORM`), h('div', {}, ...Array.from({ length: 5 }, (_, i) => {
        const place = standing.results.slice(-5)[i];
        return h('span', { class: place && place <= 3 ? 'podium' : '', text: place === undefined ? '—' : place === 0 ? 'DNF' : `P${place}` });
      })), h('p', { text: `${standing.wins} wins · ${standing.podiums} podiums · ${standing.dnfs} retirements` })));
    }
    content = h('section', { class: 'owner-card' }, label('DRIVER MANAGEMENT'), h('h1', { text: 'Two drivers. One ambition.' }), h('p', { class: 'owner-muted', text: 'Choose who you control each weekend. Both drivers keep their own points and qualifying positions when you switch seats.' }), driverCards(save, actions.changed), driverDevelopmentView(save, actions.changed), form, recruitmentView(save, actions.changed));
  } else if (tab === 'inbox') content = inboxView(save, actions.changed);
  else if (tab === 'personnel') content = personnelView(save, actions.changed);
  else if (tab === 'legacy') content = legacyView(save);
  else if (tab === 'development') content = developmentView(save, actions.changed);
  else if (tab === 'finance') content = financeView(save, actions.changed);
  else if (tab === 'facilities') content = facilitiesView(save, actions.changed);
  else if (tab === 'vehicle') content = vehicleView(save, () => actions.navigate('development'));
  else if (tab === 'identity') content = identityView(save, actions.changed);
  else {
    const body = tab === 'teams' ? actions.standings : tab === 'calendar' ? actions.calendar : actions.settings;
    content = h('section', { class: 'owner-card owner-data' }, label('TEAM MANAGEMENT'), h('h1', { text: tab === 'teams' ? 'Every point matters.' : tab === 'calendar' ? 'The road ahead.' : 'Your career.' }), ...body);
  }

  const hero = h('aside', { class: 'owner-hero' },
    h('div', { class: 'owner-garage-top' }, label('TEAM GARAGE'), h('span', { class: 'owner-garage-badge', text: 'CAR READY' })),
    h('div', { class: 'owner-team-wordmark', text: mine.name }), h('div', { class: 'owner-garage' }),
    h('div', { class: 'owner-hero-caption' }, h('span', { text: `TB–${String(save.season).padStart(2, '0')}` }), label('DRAG TO INSPECT')),
    h('div', { class: 'owner-hero-rule' }),
    h('div', { class: 'owner-stats' }, stat('CAR PERFORMANCE', `P${carRank(save, save.team)}`), stat('CAR RATING', `${Math.round(save.cars[save.team] * 100)}%`), stat('TEAM POINTS', String(row.points))),
    h('div', { class: 'owner-garage-note' }, label(o.project ? 'DEVELOPMENT IN PROGRESS' : 'WORKSHOP STATUS'), h('p', { text: o.project ? `${RESEARCH.find((r) => r.id === o.research?.id)?.name ?? 'Performance package'} · ${o.research?.remaining ?? 1} round(s) to delivery` : 'No active project. Find your next performance advantage.' }), focusable(button(o.project ? 'View project ↗' : 'Explore development ↗', () => actions.navigate('development'), { class: 'owner-text-button' }))),
    h('div', { class: 'owner-partner' }, label('OFFICIAL TEAM PARTNER'), h('strong', { text: sponsorFor(save).name.toUpperCase() })));
  return h('div', { class: `owner-layout${['teams', 'calendar', 'career', 'finance', 'personnel', 'inbox', 'legacy', 'drivers'].includes(tab) ? ' owner-layout-wide' : ''}`, 'data-tab': tab }, side, content, hero);
}
