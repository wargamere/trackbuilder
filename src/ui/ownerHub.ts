import { carRank, driverStandings, lineup, team, teamStandings, type CareerSave } from '../career/career.ts';
import { commissionDevelopment, developmentCost, expandFacilities, facilityCost, money, selectDriver } from '../career/owner.ts';
import { CAREER } from '../config/career.ts';
import { builtInTrack } from '../editor/pipeline.ts';
import { button, h } from './dom.ts';

export type OwnerTab = 'race' | 'drivers' | 'development' | 'facilities' | 'vehicle' | 'teams' | 'calendar' | 'career';
export const OWNER_TABS: [OwnerTab, string][] = [['race', 'Overview'], ['drivers', 'Drivers'], ['development', 'Development'], ['facilities', 'Facilities'], ['vehicle', 'Vehicle'], ['teams', 'Standings']];
interface Actions {
  navigate(tab: OwnerTab): void;
  changed(): void;
  weekend: (Node | null)[];
  standings: (Node | null)[];
  calendar: (Node | null)[];
  settings: (Node | null)[];
}

const label = (text: string) => h('div', { class: 'owner-label', text });
const stat = (name: string, value: string) => h('div', { class: 'owner-stat' }, label(name), h('strong', { text: value }));
const card = (title: string, ...body: (Node | null)[]) => h('section', { class: 'owner-card' }, label('TEAM OPERATIONS'), h('h2', { text: title }), ...body);

export function ownerHeader(save: CareerSave, active: OwnerTab, navigate: Actions['navigate']): HTMLElement {
  const nav = h('nav', { class: 'owner-nav' });
  nav.setAttribute('aria-label', 'Team management');
  for (const [id, name] of OWNER_TABS) {
    const b = button(name, () => navigate(id), { class: active === id ? 'on' : '' });
    b.tabIndex = 0;
    if (active === id) b.setAttribute('aria-current', 'page');
    nav.append(b);
  }
  return h('header', { class: 'owner-top' },
    h('div', { class: 'owner-brand' }, h('b', { text: 'TB' }), h('span', {}, 'TEAM OWNER', h('small', { text: `CHAMPIONSHIP / SEASON ${String(save.season).padStart(2, '0')}` }))),
    nav,
    h('div', { class: 'owner-account' }, h('strong', { text: team(save.team).name }), h('span', { text: `${save.name} · Team principal` }), h('span', { class: 'owner-funds', text: `FUNDS ${money(save.owner!.cash)}` })),
  );
}

function driverCards(save: CareerSave, changed: Actions['changed']): HTMLElement {
  const drivers = lineup(save).filter((d) => d.team.id === save.team);
  const standings = driverStandings(save);
  const group = h('div', { class: 'owner-drivers' });
  group.setAttribute('aria-label', 'Choose your race driver');
  for (const [i, d] of drivers.entries()) {
    const rating = CAREER.drivers.find((x) => x.id === d.id)!;
    const row = standings.find((x) => x.id === d.id)!;
    const b = button('', () => { selectDriver(save, d.id); changed(); }, { class: `owner-driver${d.you ? ' selected' : ''}` });
    b.tabIndex = 0;
    b.setAttribute('aria-label', `Race as ${d.name}`);
    b.setAttribute('aria-pressed', String(d.you));
    b.append(label(`SEAT ${String(i + 1).padStart(2, '0')}`),
      h('span', { class: 'owner-driver-code', text: d.code }),
      h('strong', { text: `${rating.first} ${d.name}` }),
      h('span', { class: 'owner-driver-stats', text: `P${standings.indexOf(row) + 1} · ${row.points} PTS · ${Math.round(rating.skill * 100)} RATING` }),
      h('span', { class: 'owner-driver-role', text: d.you ? '● YOU WILL DRIVE' : 'AI DRIVER · SELECT TO DRIVE' }));
    group.append(b);
  }
  return group;
}

export function ownerBody(save: CareerSave, round: number, tab: OwnerTab, actions: Actions): HTMLElement {
  const o = save.owner!;
  const mine = team(save.team);
  const track = builtInTrack(save.calendar[round]);
  const constructors = teamStandings(save);
  const row = constructors.find((t) => t.yours)!;
  const selected = lineup(save).find((e) => e.you)!;
  const side = h('aside', { class: 'owner-timeline' }, label('SEASON TIMELINE'),
    h('h2', { text: `ROUND ${String(round + 1).padStart(2, '0')}` }),
    h('p', { class: 'owner-muted', text: `${save.done.length} of ${save.calendar.length} races completed` }));
  const events = h('ol');
  for (let i = Math.max(0, round - 1); i < Math.min(save.calendar.length, round + 3); i++) {
    const t = builtInTrack(save.calendar[i]);
    const done = save.done[i];
    const b = button('', () => actions.navigate('calendar'), { class: `owner-event${i === round ? ' current' : ''}` });
    b.tabIndex = 0;
    b.setAttribute('aria-label', `View calendar: ${t?.def.name ?? 'Race'}`);
    b.append(h('span', { class: 'owner-event-index', text: String(i + 1).padStart(2, '0') }),
      h('span', {}, h('strong', { text: t?.def.name ?? 'Race weekend' }), h('small', { text: done ? 'RACE COMPLETED' : i === round ? 'RACE WEEKEND · UP NEXT' : 'UPCOMING GRAND PRIX' })));
    events.append(h('li', {}, b));
  }
  side.append(events, button('Full calendar ↗', () => actions.navigate('calendar'), { class: 'owner-text-button' }),
    h('div', { class: 'owner-team-position' }, label('CONSTRUCTORS’ POSITION'), h('strong', {}, `P${constructors.indexOf(row) + 1}`, h('small', { text: `/ ${constructors.length}` })), h('p', { text: `${row.points} POINTS · ${row.wins} WINS` })));

  let content: HTMLElement;
  if (tab === 'race') {
    const prep = h('details', { class: 'owner-preparation' }, h('summary', { text: 'Weekend setup & starting grid' }), ...actions.weekend);
    content = h('section', { class: 'owner-overview' },
      label(`ROUND ${round + 1} / ${save.calendar.length} · ${track?.def.place ?? 'GRAND PRIX'}`),
      h('h1', {}, 'BUILD A TEAM.', h('br'), h('em', { text: 'LEAVE A LEGACY.' })),
      h('p', { class: 'owner-intro', text: 'Your team. Your decisions. Two drivers, one ambition.' }),
      h('section', { class: 'owner-next-event' }, label('NEXT EVENT'), h('h2', { text: `${track?.def.name ?? 'Race'} Grand Prix` }),
        h('p', { text: save.grid ? `The grid is set. You’ll race as ${selected.name}.` : 'Choose your driver, prepare the car, and take on qualifying.' }),
        h('div', { class: 'owner-event-strip' }, h('span', { text: save.grid ? '● READY TO RACE' : '● QUALIFYING AWAITS' }), h('span', { text: '20 CARS / 10 TEAMS' }))),
      driverCards(save, actions.changed), prep);
  } else if (tab === 'drivers') {
    content = card('Two seats. One team.', h('p', { class: 'owner-muted', text: 'Pick the driver you control this weekend. Your other driver races with the AI. Both keep their own points, qualifying slots and results.' }), driverCards(save, actions.changed),
      h('div', { class: 'owner-stats' }, ...lineup(save).filter((d) => d.team.id === save.team).map((d) => stat(d.name, `${driverStandings(save).find((r) => r.id === d.id)!.points} PTS`))));
  } else if (tab === 'development') {
    const start = button(o.project ? 'Development in progress' : o.development >= 5 ? 'Programme complete' : `Commission upgrade · ${money(developmentCost(save))}`, () => { if (commissionDevelopment(save)) actions.changed(); }, { class: 'primary' });
    start.disabled = o.project || o.development >= 5 || o.cash < developmentCost(save);
    content = card('Find the next tenth.', h('p', { class: 'owner-muted', text: 'Fund a performance package for both cars. It arrives after the next completed race and adds 3.5 percentage points to the car rating, up to 100%.' }),
      h('div', { class: 'owner-stats' }, stat('PACKAGES DELIVERED', `${o.development} / 5`), stat('CAR RATING', `${Math.round(save.cars[save.team] * 100)}%`)),
      h('div', { class: 'owner-progress' }, h('i', { 'data-level': String(o.development) })),
      h('p', { text: o.project ? 'IN DEVELOPMENT · Delivery after this round' : 'No active project. Your next move starts here.' }), start);
  } else if (tab === 'facilities') {
    const expand = button(o.facilities >= 3 ? 'Headquarters fully expanded' : `Expand headquarters · ${money(facilityCost(save))}`, () => { if (expandFacilities(save)) actions.changed(); }, { class: 'primary' });
    expand.disabled = o.facilities >= 3 || o.cash < facilityCost(save);
    content = card('Invest beyond the circuit.', h('p', { class: 'owner-muted', text: 'Expand your commercial headquarters. Each level adds $250,000 to your team’s income after every race, starting with the next completed round.' }),
      h('div', { class: 'owner-stats' }, stat('HEADQUARTERS', `LEVEL ${o.facilities}`), stat('BASE RACE INCOME', money(1_000_000 + o.facilities * 250_000))), expand);
  } else if (tab === 'vehicle') {
    content = card(`${mine.name} / Season ${save.season}`, h('p', { class: 'owner-muted', text: 'Both cars share your team’s performance. Development improves your controlled car and your AI teammate together.' }),
      h('div', { class: 'owner-stats' }, stat('PERFORMANCE RANK', `${carRank(save, save.team)} / 10`), stat('CAR RATING', `${Math.round(save.cars[save.team] * 100)}%`)),
      button('Develop the car ↗', () => actions.navigate('development')));
  } else {
    const body = tab === 'teams' ? actions.standings : tab === 'calendar' ? actions.calendar : actions.settings;
    content = h('section', { class: 'owner-card owner-data' }, label('TEAM MANAGEMENT'), h('h2', { text: tab === 'teams' ? 'Championship standings' : tab === 'calendar' ? 'The road ahead.' : 'Your career' }), ...body);
  }

  const hero = h('aside', { class: 'owner-hero' },
    label('THE NEXT CHAPTER IS YOURS'), h('div', { class: 'owner-team-wordmark', text: mine.name }),
    h('div', { class: 'owner-garage' }),
    h('div', { class: 'owner-hero-caption' }, h('span', { text: `TB–${String(save.season).padStart(2, '0')}` }), label('BUILT TO COMPETE')),
    h('div', { class: 'owner-hero-rule' }),
    h('div', { class: 'owner-stats' }, stat('AVAILABLE FUNDS', money(o.cash)), stat('CAR PERFORMANCE', `P${carRank(save, save.team)}`)),
    h('p', { class: 'owner-muted', text: o.project ? '↗ Performance package in development' : '● Headquarters operational' }));
  return h('div', { class: 'owner-layout' }, side, content, hero);
}
