import {
  aiDifficulty,
  carOrder,
  carRank,
  cleanName,
  driverStandings,
  lineup,
  newCareer,
  nextCars,
  nextRound,
  nextSeason,
  offers,
  playerCar,
  pointsFor,
  raceLaps,
  recordRound,
  roundFailures,
  roundWeather,
  setGrid,
  team as teamDef,
  teamStandings,
  tyreLife,
  yourSeason,
  type CareerSave,
  type Entrant,
  type RoundResult,
} from '../career/career.ts';
import { compoundLife } from '../car/tyres.ts';
import { takeOwnership } from '../career/owner.ts';
import { CAREER, YOU_ID, type RaceLength, type SeasonLength, type TeamDef } from '../config/career.ts';
import { AI, TYRES, type Compound } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import type { EventCar, EventResult, GameContext, RaceEventSpec, RaceSetup, Screen } from '../core/screen.ts';
import { settings } from '../core/settings.ts';
import { builtInTrack } from '../editor/pipeline.ts';
import { formatTime } from '../race/session.ts';
import { trackLapTime, trackTyreLife } from '../race/strategy.ts';
import { TrackOrbit } from '../render/orbit.ts';
import { Garage } from '../render/garage.ts';
import type { Track } from '../track/track.ts';
import { AssistsPanel, assistsSummary } from './assistsPanel.ts';
import { button, h, segmented, slider } from './dom.ts';
import { SetupPanel, setupSummary } from './setupPanel.ts';
import { ownerBody, ownerHeader, OWNER_TABS, type OwnerTab } from './ownerHub.ts';
import { teamsFor } from '../career/roster.ts';
import { freshTeamDraft, teamCreation } from './teamCreation.ts';
import { dynasty } from '../career/dynasty.ts';
import { campaignDebrief, campaignSeasonReview } from './careerCampaign.ts';

type Tab = OwnerTab;
const TABS: readonly Tab[] = OWNER_TABS.map(([id]) => id);
const LENGTHS: readonly RaceLength[] = ['short', 'medium', 'long'];
const SEASONS: readonly SeasonLength[] = ['short', 'standard', 'full'];

const colour = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const ord = (place: number) => STR.results.ordinals[place - 1] ?? String(place);

/** A team's colour as a dot. */
function dot(t: TeamDef): HTMLElement {
  const d = h('i', { class: 'car-dot' });
  d.style.background = colour(t.paint);
  return d;
}

/** A round just run, as the career screen shows it: the saved result, plus the times of the day. */
interface Shown {
  round: number;
  track: string;
  result: RoundResult;
  /** By driver id: race time (null: didn't finish, or stopped early) and laps done. */
  times: Map<string, { time: number | null; laps: number }>;
  estimated: boolean;
}

/**
 * CAREER state: the paddock. With no career, the form to start one (your
 * name, a team, how fast the AI is, how long the races and the season are).
 * With one: the next race (the track turning behind, the forecast, the grid
 * once you've qualified, your starting tyres, and Practice / Qualifying /
 * Start the race), the drivers' and constructors' standings, the calendar,
 * and the record of past seasons. After a race it shows the classification
 * with the points; after the last round, the champions and the teams that
 * want you for the next season. Everything is saved as it happens.
 */
export class CareerScreen implements Screen {
  readonly layer = '3d';
  private readonly game: GameContext;
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly orbit = new TrackOrbit();
  private garage: Garage | null = null;
  private readonly assistsPanel = new AssistsPanel();
  private readonly setupPanel = new SetupPanel();
  private tab: Tab = 'race';
  /** The race just run (shown once, on coming back from it). */
  private shown: Shown | null = null;
  /** Starting a new career: the choices so far. */
  private draft = { name: '', team: CAREER.teams[4].id, difficulty: 50, length: 'medium' as RaceLength, rounds: 'standard' as SeasonLength };
  private creationMode: 'custom' | 'takeover' = 'custom';
  private readonly customDraft = freshTeamDraft();
  /** The season review: the team picked for next season. */
  private pick = '';
  /** Abandon was tapped once (tap again to confirm). */
  private abandonArmed = false;
  /** The round whose starting tyres were last suggested (so a choice made since stays). */
  private tyresFor = '';
  private abort: AbortController | null = null;
  private restore: (() => void) | null = null;
  /** What Enter does in the view on show. */
  private primary: (() => void) | null = null;
  /** The next race's session buttons (Practice, Qualifying, Start the race), shown beside Back. */
  private sessions: HTMLElement[] = [];

  constructor(game: GameContext) {
    this.game = game;
    this.panel = h('div', { class: 'panel' });
    this.root = h('div', { class: 'screen overlay career' }, this.panel);
  }

  private get save(): CareerSave | null {
    return this.game.career.save;
  }

  enter(): void {
    this.abandonArmed = false;
    if (this.save && !this.save.owner) {
      takeOwnership(this.save);
      this.game.career.write();
    }
    if (this.save?.owner && !this.save.owner.world) { dynasty(this.save); this.game.career.write(); }
    this.game.ui.append(this.root);
    const v = this.game.view3d;
    if (v) {
      this.restore = v.hideExtras();
      v.setQuality(settings().graphics);
    }
    this.showTrack();
    this.render();
    this.abort = new AbortController();
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
        const panel = this.assistsPanel.isOpen ? this.assistsPanel : this.setupPanel.isOpen ? this.setupPanel : null;
        if (panel) {
          if (e.code === 'Escape') {
            e.preventDefault();
            panel.close();
          }
          return;
        }
        // Typing your name: only Enter and Esc are ours.
        const typing = e.target instanceof HTMLInputElement;
        // Focused controls use Enter themselves; do not also launch a session.
        if ((e.code === 'Enter' || e.code === 'NumpadEnter') && e.target instanceof HTMLElement && e.target.closest('button, summary')) return;
        if (typing && this.save && e.code !== 'Escape') return;
        if (e.code === 'Escape') {
          e.preventDefault();
          this.game.go('menu');
        } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          this.primary?.();
        } else if (!typing && this.save && !this.shown && nextRound(this.save) !== null) {
          const k = /^Digit([1-8])$/.exec(e.code);
          if (!k) return;
          e.preventDefault();
          this.tab = TABS[Number(k[1]) - 1];
          this.render();
        }
      },
      { signal: this.abort.signal },
    );
  }

  exit(): void {
    this.garage?.dispose();
    this.garage = null;
    this.assistsPanel.close();
    this.setupPanel.close();
    this.abort?.abort();
    this.abort = null;
    this.root.remove();
    this.shown = null;
    this.restore?.();
    this.restore = null;
    this.game.view3d?.setConditions(null);
    this.game.view3d?.setQuality(settings().graphics);
  }

  resize(): void {
    const s = this.game.surface;
    this.game.view3d?.resize(s.w, s.h);
  }

  frame(dt: number): void {
    const v = this.game.view3d;
    if (v && !this.save?.owner) this.orbit.frame(v, dt);
    this.garage?.frame(dt);
  }

  /** The track of the round on show (the next one; the last one once the season is over), or null with no career. */
  private roundTrack(): Track | null {
    const save = this.save;
    if (!save || !save.calendar.length) return null;
    const round = this.shown?.round ?? nextRound(save) ?? save.calendar.length - 1;
    return builtInTrack(save.calendar[round]);
  }

  /** Puts that track behind the panel (and makes it the game's track, ready to drive). */
  private showTrack(): void {
    const t = this.roundTrack() ?? this.game.track;
    if (t !== this.game.track) this.game.setTrack(t);
    const v = this.game.view3d;
    if (!v) return;
    this.orbit.show(v, t);
    const save = this.save;
    const round = save ? nextRound(save) : null;
    v.setConditions(save && round !== null && !this.shown ? { time: t.options.time, rain: roundWeather(save, round) === 'rain' } : null);
  }

  /** Draws the view the career is in: a new one, a race's result, the season's end, or the paddock. */
  private render(): void {
    const createScroll = this.panel.querySelector('.team-create-layout')?.scrollTop ?? 0;
    const marketScroll = this.panel.querySelector('.team-driver-market')?.scrollTop ?? 0;
    const oldTab = this.panel.querySelector('.owner-layout')?.getAttribute('data-tab');
    const contentScroll = this.panel.querySelector('.owner-overview, .owner-card')?.scrollTop ?? 0;
    const layoutScroll = this.panel.querySelector('.owner-layout')?.scrollTop ?? 0;
    const navScroll = this.panel.querySelector('.owner-nav')?.scrollLeft ?? 0;
    const save = this.save;
    if (save?.owner) {
      const identity = teamDef(save.team, save), accent = colour(identity.secondary ?? identity.paint);
      this.root.style.setProperty('--dynasty-accent', accent); this.root.style.setProperty('--dynasty-glow', `${accent}16`);
      this.root.style.setProperty('--team-primary', colour(identity.paint));
      this.root.style.setProperty('--team-secondary', accent);
      const luminance = [16, 8, 0].reduce((sum, shift, i) => {
        const channel = ((identity.paint >> shift) & 255) / 255;
        return sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
      }, 0);
      this.root.style.setProperty('--team-on-primary', luminance > .179 ? '#090c14' : '#ffffff');
    }
    this.primary = null;
    const view = !save ? 'new' : this.shown ? 'result' : nextRound(save) === null ? 'review' : 'hub';
    this.root.dataset.view = view;
    this.root.classList.toggle('owner-mode', !!save?.owner);
    this.root.classList.toggle('creating-team', !save && this.creationMode === 'custom');
    let body: (Node | null)[];
    if (!save) body = this.newCareer();
    else if (this.shown) body = this.result(save, this.shown);
    else if (nextRound(save) === null) body = this.review(save);
    else body = this.hub(save, nextRound(save) as number);
    this.panel.replaceChildren(...body.filter((x): x is Node => !!x));
    const creation = this.panel.querySelector('.team-create-layout');
    if (creation) creation.scrollTop = createScroll;
    const market = this.panel.querySelector('.team-driver-market');
    if (market) market.scrollTop = marketScroll;
    const content = this.panel.querySelector('.owner-overview, .owner-card');
    if (content && oldTab === this.tab) content.scrollTop = contentScroll;
    const layout = this.panel.querySelector('.owner-layout');
    if (layout && oldTab === this.tab) layout.scrollTop = layoutScroll;
    const nav = this.panel.querySelector('.owner-nav'), active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav) {
      nav.scrollLeft = navScroll;
      if (active) {
        const left = active.offsetLeft - (nav as HTMLElement).offsetLeft;
        if (left < nav.scrollLeft) nav.scrollLeft = left;
        else if (left + active.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = left + active.offsetWidth - nav.clientWidth;
      }
    }
    if (!save && this.creationMode === 'custom') this.panel.querySelectorAll('button').forEach((b) => b.tabIndex = 0);
    const target = this.panel.querySelector<HTMLElement>('.owner-garage');
    if (target && this.game.view3d) {
      try {
        const identity = save ? teamDef(save.team, save) : this.customDraft;
        this.garage ??= new Garage(identity.paint);
        this.garage.attach(target, identity.paint, identity.secondary);
      } catch {
        target.textContent = 'TEAM GARAGE';
      }
    }
  }

  // ---------------------------------------------------------------- a new career

  private newCareer(): (Node | null)[] {
    if (this.creationMode === 'custom') {
      const view = teamCreation(this.customDraft, () => this.render(), (save) => {
        this.game.career.start(save); this.tab = 'race'; this.tyresFor = ''; this.showTrack(); this.render();
      }, () => this.game.go('menu'), () => { this.creationMode = 'takeover'; this.render(); }, () => {
        const target = this.panel.querySelector<HTMLElement>('.team-create-garage');
        if (target) this.garage?.attach(target, this.customDraft.paint, this.customDraft.secondary);
      });
      this.primary = view.primary;
      return view.body;
    }
    const C = STR.career;
    const d = this.draft;
    const field = (label: string, ...children: (Node | null)[]) => h('div', { class: 'field' }, h('span', { class: 'label', text: label }), ...children);
    const name = h('input', { class: 'text-input career-name' });
    name.type = 'text';
    name.maxLength = 14;
    name.placeholder = C.namePlaceholder;
    name.spellcheck = false;
    name.autocomplete = 'off';
    name.value = d.name;
    name.setAttribute('aria-label', C.name);
    name.addEventListener('input', () => (d.name = name.value));
    // (The game's own keys stay out of the way while you type.)
    name.addEventListener('keydown', (e) => e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Escape' && e.stopPropagation());

    const fresh = { cars: Object.fromEntries(CAREER.teams.map((t) => [t.id, t.car])) };
    const teams = h('div', { class: 'career-teams' });
    teams.setAttribute('role', 'group');
    teams.setAttribute('aria-label', C.team);
    for (const t of CAREER.teams) {
      const mate = lineup({ team: t.id, name: '' }).find((e) => e.team.id === t.id && !e.you);
      const rank = carRank(fresh, t.id);
      const b = h(
        'button',
        { class: `career-team${t.id === d.team ? ' on' : ''}` },
        dot(t),
        h('span', { class: 'career-team-name', text: t.name }),
        h('span', { class: 'career-team-line', text: fmt(C.teamLine, { car: rank, mate: mate?.name ?? '' }) }),
        this.carBar(rank),
      );
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('aria-pressed', String(t.id === d.team));
      b.addEventListener('click', () => {
        d.team = t.id;
        this.render();
      });
      teams.append(b);
    }
    const speedHint = h('p', { class: 'setup-hint', text: C.aiSpeedHint });
    const speed = slider(1, 100, 1, (n) => (d.difficulty = n), () => {}, (n) => fmt(C.aiSpeedValue, { n }));
    speed.set(d.difficulty);
    const length = segmented<RaceLength>(LENGTHS.map((l) => [l, C.lengths[l]]), (l) => {
      d.length = l;
      this.render();
    });
    length.set(d.length);
    const season = segmented<SeasonLength>(SEASONS.map((s) => [s, C.seasons[s]]), (s) => {
      d.rounds = s;
      this.render();
    });
    season.set(d.rounds);
    const start = () => {
      const save = newCareer({ ...d, name: cleanName(d.name) });
      takeOwnership(save);
      this.game.career.start(save);
      this.tab = 'race';
      this.tyresFor = '';
      this.showTrack();
      this.render();
    };
    this.primary = start;
    return [
      button('Create my own team', () => { this.creationMode = 'custom'; this.render(); }),
      h('h2', { text: C.newTitle }),
      h(
        'div',
        { class: 'career-body' },
        h('p', { class: 'career-intro', text: C.intro }),
        h(
          'div',
          { class: 'career-new' },
          h('div', { class: 'career-new-col' }, field(C.name, name), field(C.team, teams, h('p', { class: 'setup-hint', text: fmt(C.teamExpect, { pos: ord(carRank(fresh, d.team)) }) }))),
          h(
            'div',
            { class: 'career-new-col' },
            field(C.aiSpeed, speed.el, speedHint),
            field(C.raceLength, length.el, h('p', { class: 'setup-hint', text: C.lengthHints[d.length] })),
            field(C.seasonLength, season.el),
          ),
        ),
      ),
      h(
        'div',
        { class: 'menu row setup-buttons career-foot' },
        button(C.back, () => this.game.go('menu'), { icon: '←', key: 'Esc' }),
        button(C.start, start, { icon: '▶', class: 'primary', key: 'Enter' }),
      ),
    ];
  }

  /** How good a car is, as ten pips: `rank` 1 (the quickest) lights them all. */
  private carBar(rank: number, total = 10): HTMLElement {
    const bar = h('span', { class: 'career-car' });
    bar.style.setProperty('--car', `${Math.max(0, Math.min(100, ((total + 1 - rank) / total) * 100))}%`);
    bar.title = `Car: ${rank} of ${total}`;
    return bar;
  }

  // ---------------------------------------------------------------- the paddock

  private header(save: CareerSave, sub: string): HTMLElement {
    const C = STR.career;
    const t = teamDef(save.team, save);
    const mine = yourSeason(save);
    const stripe = h('div', { class: 'career-head' });
    stripe.style.setProperty('--team', colour(t.paint));
    stripe.append(
      h('div', { class: 'career-head-main' }, h('div', { class: 'career-season', text: fmt(C.season, { n: save.season }) }), h('div', { class: 'career-round', text: sub })),
      h(
        'div',
        { class: 'career-head-you' },
        h('div', { class: 'career-you-name' }, dot(t), save.name),
        h('div', { class: 'career-you-line', text: fmt(C.yourPlace, { pos: ord(mine.position), pts: mine.points }) }),
        h('div', { class: 'career-you-line', text: fmt(C.teamPlace, { team: t.name, pos: ord(mine.teamPosition) }) }),
      ),
    );
    return stripe;
  }

  private hub(save: CareerSave, round: number): (Node | null)[] {
    const C = STR.career;
    const navigate = (tab: Tab) => { this.tab = tab; this.abandonArmed = false; this.render(); };
    const weekend = this.raceTab(save, round);
    return [
      ownerHeader(save, this.tab, navigate),
      ownerBody(save, round, this.tab, {
        navigate,
        changed: () => { this.game.career.write(); this.render(); },
        weekend,
        standings: [...this.teamsTab(save), h('h3', { text: 'Driver standings' }), ...this.driversTab(save)],
        calendar: this.calendarTab(save, round),
        settings: this.careerTab(save),
      }),
      h('footer', { class: 'owner-footer' },
        h('div', { class: 'owner-footer-links' }, button(C.back, () => this.game.go('menu'), { key: 'Esc' }), button('Calendar', () => navigate('calendar')), button('Career settings', () => navigate('career'))),
        h('div', { class: 'career-sessions' }, ...this.sessions)),
    ];
  }

  /** The next race: the track, the forecast, the grid (once qualified), your tyres, and the sessions. */
  private raceTab(save: CareerSave, round: number): (Node | null)[] {
    const C = STR.career;
    const t = this.roundTrack();
    if (!t) return [];
    const weather = roundWeather(save, round);
    const laps = raceLaps(save.length, trackLapTime(t));
    // The tyres to start on: wets when it's raining, never wets in the dry, until you choose.
    const key = `${save.season}:${round}`;
    if (this.tyresFor !== key) {
      this.tyresFor = key;
      const want: Compound = weather === 'rain' ? 'wet' : save.tyres === 'wet' ? 'medium' : save.tyres;
      if (want !== save.tyres) {
        save.tyres = want;
        this.game.career.write();
      }
    }
    const life = tyreLife(laps, trackTyreLife(t));
    const wetness = weather === 'rain' ? 1 : 0;
    const tyres = segmented<Compound>(
      TYRES.order.map((c) => [c, `${STR.tyres.names[c]} · ${fmt(C.tyreLaps, { n: compoundLife(c, wetness, life).toFixed(1) })}`]),
      (c) => {
        save.tyres = c;
        this.game.career.write();
        this.render();
      },
    );
    tyres.set(save.tyres);
    tyres.el.classList.add('career-tyres');
    TYRES.order.forEach((c, i) => {
      const b = tyres.el.children[i] as HTMLElement;
      b.classList.add('tyre-choice');
      b.dataset.compound = c;
    });

    const info = [t.def.place, fmt(C.km, { len: (t.center.length / 1000).toFixed(2) }), fmt(C.laps, { n: laps }), C.forecast[weather], t.options.time === 'day' ? null : C.times[t.options.time]].filter(Boolean).join(' · ');
    const grid = save.grid;
    const place = grid ? grid.indexOf(save.owner?.selected ?? YOU_ID) + 1 : 0;
    const names = new Map(lineup(save).map((e) => [e.id, e]));
    const gridList = grid
      ? h(
          'ol',
          { class: 'career-grid' },
          ...grid.map((id, i) => {
            const e = names.get(id);
            return h('li', { class: e?.you ? 'you' : '' }, h('span', { class: 'standing-pos', text: String(i + 1) }), e ? dot(e.team) : null, h('span', { class: 'standing-name', text: e?.name ?? id }));
          }),
        )
      : null;
    const go = (session: RaceEventSpec['session']) => () => this.drive(session);
    this.primary = go(grid ? 'race' : 'qualifying');
    this.sessions = grid
      ? [button(C.requalify, go('qualifying'), { icon: '⏱' }), button(C.practice, go('practice'), { icon: '⟳' }), button(C.race, go('race'), { icon: '🏁', class: 'primary', key: 'Enter' })]
      : [button(C.practice, go('practice'), { icon: '⟳' }), button(C.qualifying, go('qualifying'), { icon: '⏱', class: 'primary', key: 'Enter' })];
    const line = (label: string, summary: string, open: string, icon: string, act: () => void) =>
      h('div', { class: 'setup-assists' }, h('span', { class: 'label', text: label }), h('span', { class: 'assists-summary', text: summary }), button(open, act, { icon, class: 'compact' }));
    return [
      h('div', { class: 'career-track' }, h('div', { class: 'career-track-name', text: t.def.name }), h('div', { class: 'career-track-info', text: info })),
      h('p', { class: 'career-status', text: grid ? fmt(C.raceHint, { pos: ord(place), n: grid.length }) : fmt(C.qualifyingHint, { n: AI.qualifyingLaps }) }),
      gridList,
      h('div', { class: 'field' }, h('span', { class: 'label', text: C.tyres }), tyres.el),
      line(STR.assists.title, assistsSummary(settings().assists), STR.assists.open, '🛞', () => this.assistsPanel.open(this.game.ui, () => this.render())),
      line(STR.carSetup.title, setupSummary(settings().carSetup), STR.carSetup.open, '🔧', () => this.setupPanel.open(this.game.ui, t, () => this.render())),
      h('p', { class: 'setup-hint career-rules', text: C.rules }),
    ];
  }

  private driversTab(save: CareerSave): (Node | null)[] {
    const C = STR.career;
    const rows = driverStandings(save);
    return [
      h(
        'table',
        { class: 'career-table' },
        h('thead', {}, h('tr', {}, h('th', { text: C.pos }), h('th', { text: C.driver }), h('th', { text: C.teamCol }), h('th', { class: 'num', text: C.wins }), h('th', { class: 'num', text: C.pts }))),
        h(
          'tbody',
          {},
          ...rows.map((r, i) =>
            h(
              'tr',
              { class: r.you ? 'you' : '' },
              h('td', { class: 'pos', text: String(i + 1) }),
              h('td', { class: 'who' }, dot(r.team), r.name),
              h('td', { class: 'team', text: r.team.name }),
              h('td', { class: 'num', text: String(r.wins) }),
              h('td', { class: 'num pts', text: String(r.points) }),
            ),
          ),
        ),
      ),
    ];
  }

  private teamsTab(save: CareerSave): (Node | null)[] {
    const C = STR.career;
    const rows = teamStandings(save);
    return [
      h('p', { class: 'setup-hint career-target', text: fmt(C.target, { pos: ord(carRank(save, save.team)), car: carRank(save, save.team) }) }),
      h(
        'table',
        { class: 'career-table' },
        h('thead', {}, h('tr', {}, h('th', { text: C.pos }), h('th', { text: C.teamCol }), h('th', { text: C.driver }), h('th', { class: 'num', text: C.wins }), h('th', { class: 'num', text: C.pts }))),
        h(
          'tbody',
          {},
          ...rows.map((r, i) =>
            h(
              'tr',
              { class: r.yours ? 'you' : '' },
              h('td', { class: 'pos', text: String(i + 1) }),
              h('td', { class: 'who' }, dot(r.team), r.team.name),
              h('td', { class: 'team', text: r.drivers.map((d) => d.name).join(' · ') }),
              h('td', { class: 'num', text: String(r.wins) }),
              h('td', { class: 'num pts', text: String(r.points) }),
            ),
          ),
        ),
      ),
    ];
  }

  private calendarTab(save: CareerSave, round: number): (Node | null)[] {
    const C = STR.career;
    const names = new Map(lineup(save).map((e) => [e.id, e]));
    return [
      h(
        'ol',
        { class: 'career-calendar' },
        ...save.calendar.map((id, i) => {
          const t = builtInTrack(id);
          const done = save.done[i];
          let note = '';
          if (done) {
            const id = save.owner?.selected ?? YOU_ID;
            const mine = save.owner
              ? lineup(save).filter((e) => e.team.id === save.team).map((e) => `${e.name}: ${done.dnf.includes(e.id) ? 'DNF' : `P${done.order.indexOf(e.id) + 1}`}`).join(' · ')
              : done.dnf.includes(id) ? C.yourDnf : fmt(C.yourResult, { pos: ord(done.order.indexOf(id) + 1) });
            note = `${fmt(C.winner, { name: names.get(done.order[0])?.name ?? '' })} · ${mine}`;
          } else if (i === round) note = C.next;
          return h(
            'li',
            { class: done ? 'done' : i === round ? 'next' : '' },
            h('span', { class: 'standing-pos', text: String(i + 1) }),
            h('span', { class: 'career-cal-name', text: t ? (t.def.place ? `${t.def.name}, ${t.def.place}` : t.def.name) : id }),
            h('span', { class: 'career-cal-note', text: note }),
          );
        }),
      ),
    ];
  }

  /** The record of past seasons, the AI's speed, and abandoning the career. */
  private careerTab(save: CareerSave): (Node | null)[] {
    const C = STR.career;
    const titles = save.history.filter((x) => x.position === 1).length;
    const speed = slider(
      1,
      100,
      1,
      (n) => (save.difficulty = n),
      () => this.game.career.write(),
      (n) => fmt(C.aiSpeedValue, { n }),
    );
    speed.set(save.difficulty);
    const abandon = button(this.abandonArmed ? C.abandonConfirm : C.abandon, () => {
      if (!this.abandonArmed) {
        this.abandonArmed = true;
        this.render();
        return;
      }
      this.game.career.clear();
      this.abandonArmed = false;
      this.tab = 'race';
      this.render();
    }, { icon: '✕', class: this.abandonArmed ? 'small danger' : 'small' });
    return [
      h('div', { class: 'label', text: C.history }),
      titles ? h('p', { class: 'career-trophies', text: `🏆 ${titles === 1 ? C.trophy : fmt(C.trophies, { n: titles })}` }) : null,
      save.history.length
        ? h(
            'ol',
            { class: 'career-history' },
            ...save.history.map((x) =>
              h(
                'li',
                { class: x.position === 1 ? 'won' : '' },
                h('span', { text: fmt(C.historyLine, { n: x.season, team: teamDef(x.team, save).name, pos: ord(x.position), pts: x.points, wins: x.wins }) }),
                h('span', { class: 'career-cal-note', text: fmt(C.historyChampion, { name: x.champion }) }),
              ),
            ),
          )
        : h('p', { class: 'setup-hint', text: C.historyNone }),
      h('div', { class: 'label', text: C.settings }),
      h('div', { class: 'field' }, h('span', { class: 'label', text: C.aiSpeed }), speed.el, h('p', { class: 'setup-hint', text: C.aiSpeedHint })),
      h('div', { class: 'menu row career-abandon' }, abandon),
    ];
  }

  // ---------------------------------------------------------------- driving a round

  /** Hands the next round to the race screen: practice, qualifying (then the race), or the race from the saved grid. */
  private drive(session: RaceEventSpec['session']): void {
    const save = this.save;
    const round = save ? nextRound(save) : null;
    const t = this.roundTrack();
    if (!save || round === null || !t) return;
    const weather = roundWeather(save, round);
    const fails = roundFailures(save, round);
    const teams = teamsFor(save);
    const entrants = lineup(save);
    const field: EventCar[] = entrants
      .filter((e) => !e.you)
      .map((e) => ({ id: e.id, name: e.name, paint: e.team.paint, ...(e.team.secondary !== undefined ? { secondary: e.team.secondary } : {}), difficulty: aiDifficulty(save, round, e.id), box: teams.findIndex((t) => t.id === e.team.id), failAt: fails[e.id] }))
      .sort((a, b) => b.difficulty - a.difficulty);
    const practice = session === 'practice';
    const laps = raceLaps(save.length, trackLapTime(t));
    const setup: RaceSetup = {
      mode: practice ? 'practice' : 'race',
      laps,
      ghost: practice,
      opponents: field.length,
      difficulty: save.difficulty,
      grid: 'qualifying',
      startSlot: 1,
      weather,
      time: 'track',
      tyreWear: !practice,
      tyres: save.tyres,
      damage: !practice,
      safetyCar: true,
    };
    const mine = teamDef(save.team, save);
    const controlled = entrants.find((e) => e.you)!;
    const spec: RaceEventSpec = {
      setup,
      session,
      title: fmt(STR.career.roundOf, { round: round + 1, rounds: save.calendar.length }),
      you: { id: controlled.id, name: controlled.name, paint: mine.paint, ...(mine.secondary !== undefined ? { secondary: mine.secondary } : {}), box: teams.findIndex((t) => t.id === mine.id) },
      car: playerCar(save),
      tyreLife: tyreLife(laps, trackTyreLife(t)),
      field,
      // (Qualifying again starts from no grid.)
      grid: session === 'race' ? save.grid : null,
      qualified: (order) => {
        setGrid(save, order);
        this.game.career.write();
      },
      finished: (result) => this.finished(save, round, t, result),
      leave: () => this.game.go('career'),
    };
    this.game.setTrack(t);
    this.game.startEvent(spec);
  }

  /** The race is over: into the standings, saved, and its result on show. */
  private finished(save: CareerSave, round: number, t: Track, result: EventResult): void {
    if (nextRound(save) !== round) return;
    const saved = recordRound(save, result);
    if (saved) {
      this.game.career.write();
      const times = new Map(result.order.map((id, i) => [id, { time: result.times[i] ?? null, laps: result.laps[i] ?? 0 }]));
      this.shown = { round, track: t.def.name, result: saved, times, estimated: result.estimated };
    }
    this.tab = 'race';
    this.game.go('career');
  }

  // ---------------------------------------------------------------- a race's result

  private result(save: CareerSave, shown: Shown): (Node | null)[] {
    const C = STR.career;
    const r = shown.result;
    const names = new Map(lineup(save).map((e) => [e.id, e]));
    const winner = shown.times.get(r.order[0]);
    const place = r.order.indexOf(save.owner?.selected ?? YOU_ID) + 1;
    const out = r.dnf.includes(save.owner?.selected ?? YOU_ID);
    const pts = out ? 0 : pointsFor(place);
    const headline = out ? C.retired : place === 1 ? C.won : pts > 0 ? fmt(C.finishedPoints, { pos: ord(place), pts }) : fmt(C.finished, { pos: ord(place) });
    const rows = r.order.map((id, i) => {
      const e = names.get(id) as Entrant | undefined;
      const dnf = r.dnf.includes(id);
      const x = shown.times.get(id);
      let time = '';
      if (dnf) time = STR.results.dnf;
      else if (x && x.time !== null && winner && winner.time !== null) {
        const down = winner.laps - x.laps;
        time = i === 0 ? formatTime(x.time) : down > 0 ? fmt(down === 1 ? STR.results.lapDown : STR.results.lapsDown, { n: down }) : fmt(STR.results.gap, { t: (x.time - winner.time).toFixed(2) });
      }
      const got = dnf ? 0 : pointsFor(i + 1);
      return h(
        'tr',
        { class: `${e?.you ? 'you' : ''}${dnf ? ' dnf' : ''}`.trim() },
        h('td', { class: 'pos', text: dnf ? '–' : String(i + 1) }),
        h('td', { class: 'who' }, e ? dot(e.team) : null, e?.name ?? id, r.fastest === id ? h('span', { class: 'career-fl', title: C.fastestLap, text: '⏱' }) : null),
        h('td', { class: 'team', text: e?.team.name ?? '' }),
        h('td', { class: 'num time', text: time }),
        h('td', { class: 'num pts', text: got ? fmt(C.points, { n: got }) : '' }),
      );
    });
    const next = () => {
      this.shown = null;
      this.tab = nextRound(save) === null ? 'race' : 'drivers';
      this.showTrack();
      this.render();
    };
    this.primary = next;
    return [
      this.header(save, fmt(C.resultTitle, { round: shown.round + 1, track: shown.track })),
      h('p', { class: `career-headline${out ? ' bad' : place <= 3 ? ' good' : ''}`, text: headline }),
      shown.estimated ? h('p', { class: 'setup-hint', text: C.asItStood }) : null,
      save.owner ? campaignDebrief(save) : null,
      h(
        'div',
        { class: 'career-body' },
        h(
          'table',
          { class: 'career-table' },
          h('thead', {}, h('tr', {}, h('th', { text: C.pos }), h('th', { text: C.driver }), h('th', { text: C.teamCol }), h('th', { class: 'num', text: STR.results.total }), h('th', { class: 'num', text: C.pts }))),
          h('tbody', {}, ...rows),
        ),
      ),
      h('div', { class: 'menu row setup-buttons career-foot' }, button(C.continue, next, { icon: '▶', class: 'primary', key: 'Enter' })),
    ];
  }

  // ---------------------------------------------------------------- the season's end

  private review(save: CareerSave): (Node | null)[] {
    const C = STR.career;
    const drivers = driverStandings(save);
    const teams = teamStandings(save);
    const mine = yourSeason(save);
    const champion = drivers[0];
    const best = teams[0];
    const wanted = save.owner ? [teamDef(save.team, save)] : offers(save);
    if (!wanted.some((t) => t.id === this.pick)) this.pick = save.team;
    const next = { ...save, cars: nextCars(save) };
    const order = carOrder(next);
    const list = h('div', { class: 'career-teams career-offers' });
    list.setAttribute('role', 'group');
    for (const t of wanted) {
      const mate = lineup(save.owner ? save : { team: t.id, name: '' }).find((e) => e.team.id === t.id && !e.you);
      const rank = order.findIndex((other) => other.id === t.id) + 1;
      const b = h(
        'button',
        { class: `career-team${t.id === this.pick ? ' on' : ''}` },
        dot(t),
        h('span', { class: 'career-team-name', text: t.id === save.team ? `${t.name} (${C.stay})` : t.name }),
        h('span', { class: 'career-team-line', text: fmt(C.offerLine, { car: rank, mate: mate?.name ?? '' }) }),
        this.carBar(rank, order.length),
      );
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('aria-pressed', String(t.id === this.pick));
      b.addEventListener('click', () => {
        this.pick = t.id;
        this.render();
      });
      list.append(b);
    }
    const start = () => {
      nextSeason(save, this.pick);
      this.game.career.write();
      this.tab = 'race';
      this.tyresFor = '';
      this.showTrack();
      this.render();
    };
    this.primary = start;
    const big = (label: string, t: TeamDef, name: string, pts: number) =>
      h('div', { class: 'career-champ' }, h('div', { class: 'label', text: label }), h('div', { class: 'career-champ-name' }, dot(t), name), h('div', { class: 'career-champ-pts', text: `${pts} ${C.pts.toLowerCase()}` }));
    const target = carRank(save, save.team);
    return [
      this.header(save, C.seasonDone),
      h(
        'div',
        { class: 'career-body' },
        h('h2', { text: fmt(C.reviewTitle, { n: save.season }) }),
        save.owner ? campaignSeasonReview(save) : null,
        champion?.you ? h('p', { class: 'career-headline good', text: `🏆 ${C.youChampion}` }) : null,
        best?.yours ? h('p', { class: 'career-headline good', text: `🏆 ${C.teamChampion}` }) : null,
        h('div', { class: 'career-champs' }, champion ? big(C.champion, champion.team, champion.name, champion.points) : null, best ? big(C.constructors, best.team, best.team.name, best.points) : null),
        h('p', { class: 'career-status', text: fmt(C.yourSeason, { pos: ord(mine.position), pts: mine.points, wins: mine.wins, podiums: mine.podiums }) }),
        h('p', { class: `career-status${mine.teamPosition <= target ? ' good' : ''}`, text: fmt(C.yourTeam, { team: teamDef(save.team, save).name, pos: ord(mine.teamPosition), target: ord(target) }) }),
        h('div', { class: 'label', text: C.offers }),
        h('p', { class: 'setup-hint', text: C.offersHint }),
        list,
      ),
      h(
        'div',
        { class: 'menu row setup-buttons career-foot' },
        button(C.back, () => this.game.go('menu'), { icon: '←', key: 'Esc' }),
        button(fmt(C.nextSeason, { n: save.season + 1 }), start, { icon: '▶', class: 'primary', key: 'Enter' }),
      ),
    ];
  }
}
