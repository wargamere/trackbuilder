import { compoundLife } from '../car/tyres.ts';
import { CONDITIONS, TYRES, type Compound } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import type { TimeOfDay } from '../config/track.ts';
import type { RaceSetup, Weather } from '../core/screen.ts';
import { button, h, segmented, type Choice } from './dom.ts';

/** The race conditions in a race setup. */
export type Conditions = Pick<RaceSetup, 'weather' | 'time' | 'tyreWear' | 'tyres'>;

/** The time of day a run is driven at: the setup's, or the track's own. */
export function timeFor(c: Pick<RaceSetup, 'time'>, trackTime: TimeOfDay): TimeOfDay {
  return c.time === 'track' ? trackTime : c.time;
}

/** One line for the race setup, as in "Rain · night · tyre wear, wet tyres". */
export function conditionsSummary(c: Conditions, trackTime: TimeOfDay): string {
  const C = STR.conditions;
  const wear = c.tyreWear ? fmt(C.summaryWearOn, { tyres: STR.tyres.lower[c.tyres] }) : C.summaryNoWear;
  const weather = c.weather === 'rain' ? C.summaryRain : c.weather === 'changing' ? C.summaryChanging : C.summaryDry;
  return [weather, C.summaryTimes[timeFor(c, trackTime)], wear].join(' · ');
}

/** Changing the weather puts on the tyres for it: wets in the rain, mediums (from wets) in the dry. */
export function withWeather(c: Conditions, weather: Conditions['weather']): Partial<Conditions> {
  if (weather === 'rain' && c.tyres !== 'wet') return { weather, tyres: 'wet' };
  // (Changing weather starts dry.)
  if (weather !== 'rain' && c.tyres === 'wet') return { weather, tyres: 'medium' };
  return { weather };
}

/**
 * The race conditions: dry or rain, the time of day (the track's own, day,
 * sunset or night), and tyre wear with pit stops on or off, with the tyres
 * you start on (and how long each kind lasts on this track). They're part of
 * the race setup being made (not saved until it starts), so the panel works
 * on what it's given and reports each change. Opens over the race setup.
 */
export class ConditionsPanel {
  readonly root: HTMLElement;
  private readonly weather: Choice<Weather>;
  private readonly time: Choice<Conditions['time']>;
  private readonly tyres: Choice<boolean>;
  private readonly start: Choice<Compound>;
  private readonly startField: HTMLElement;
  private readonly startHint: HTMLElement;
  private readonly lifeLine: HTMLElement;
  private readonly timeHint: HTMLElement;
  private readonly weatherHint: HTMLElement;
  private get: () => Conditions = () => ({ weather: 'dry', time: 'track', tyreWear: false, tyres: 'medium' });
  private trackTime: TimeOfDay = 'day';
  private mediumLife = 5;
  private change: (patch: Partial<Conditions>) => void = () => {};
  private onClose: () => void = () => {};

  constructor() {
    const C = STR.conditions;
    const set = (patch: Partial<Conditions>) => {
      this.change(patch);
      this.render();
    };
    this.weather = segmented<Weather>(
      [
        ['dry', C.dry, '☀'],
        ['rain', C.rain, '🌧'],
        ['changing', C.changing, '🌦'],
      ],
      (v) => set(withWeather(this.get(), v)),
    );
    this.time = segmented<Conditions['time']>(
      [
        ['track', C.times.track],
        ['day', C.times.day],
        ['sunset', C.times.sunset],
        ['night', C.times.night],
      ],
      (v) => set({ time: v }),
    );
    this.tyres = segmented<boolean>(
      [
        [false, C.off],
        [true, C.on],
      ],
      (v) => set({ tyreWear: v }),
    );
    this.start = segmented<Compound>(
      TYRES.order.map((c) => [c, STR.tyres.names[c]] as [Compound, string]),
      (v) => set({ tyres: v }),
    );
    // Each kind's colour on its button.
    TYRES.order.forEach((c, i) => {
      const b = this.start.el.children[i] as HTMLElement;
      b.classList.add('tyre-choice');
      b.dataset.compound = c;
    });
    const field = (label: string, control: HTMLElement, hint: string | HTMLElement) => {
      control.setAttribute('aria-label', label);
      return h('div', { class: 'field' }, h('span', { class: 'label', text: label }), control, typeof hint === 'string' ? h('p', { class: 'setup-hint', text: hint }) : hint);
    };
    this.timeHint = h('p', { class: 'setup-hint' });
    this.weatherHint = h('p', { class: 'setup-hint' });
    this.startHint = h('p', { class: 'setup-hint' });
    this.lifeLine = h('p', { class: 'setup-hint tyre-life' });
    this.startField = field(C.startTyres, this.start.el, h('div', {}, this.startHint, this.lifeLine));
    const panel = h(
      'div',
      { class: 'panel assists-panel conditions-panel' },
      h('h2', { text: C.title }),
      h('p', { class: 'assists-intro', text: C.intro }),
      field(C.weather, this.weather.el, this.weatherHint),
      field(C.time, this.time.el, this.timeHint),
      field(C.tyres, this.tyres.el, fmt(C.tyresHint, { s: CONDITIONS.service })),
      this.startField,
      h('div', { class: 'menu row' }, button(C.done, () => this.close(), { icon: '✓', class: 'primary', key: 'Esc' })),
    );
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', C.title);
    this.root = h('div', { class: 'screen overlay assists-overlay' }, panel);
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * Shows it over `host` for the conditions `get` returns (on a track whose
   * own time of day is `trackTime`); `change` gets each change, `onClose`
   * runs when it's closed.
   */
  open(host: HTMLElement, opts: { get: () => Conditions; change: (patch: Partial<Conditions>) => void; trackTime: TimeOfDay; mediumLife: number; onClose?: () => void }): void {
    this.get = opts.get;
    this.change = opts.change;
    this.trackTime = opts.trackTime;
    this.mediumLife = opts.mediumLife;
    this.onClose = opts.onClose ?? (() => {});
    this.render();
    host.append(this.root);
    this.root.hidden = false;
    (this.root.querySelector('.segmented .btn') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.root.remove();
    this.onClose();
  }

  private render(): void {
    const c = this.get();
    this.weather.set(c.weather);
    this.time.set(c.time);
    this.tyres.set(c.tyreWear);
    this.start.set(c.tyres);
    this.startField.hidden = !c.tyreWear;
    this.startHint.textContent = STR.tyres.hints[c.tyres];
    this.weatherHint.textContent = c.weather === 'changing' ? STR.conditions.changingHint : STR.conditions.weatherHint;
    const wet = c.weather === 'rain';
    const list = TYRES.order.map((k) => fmt(STR.conditions.lifeItem, { name: STR.tyres.names[k], n: compoundLife(k, wet ? 1 : 0, this.mediumLife).toFixed(1) })).join(' · ');
    this.lifeLine.textContent = fmt(STR.conditions.lifeLine, { weather: wet ? STR.conditions.lifeRain : STR.conditions.lifeDry, list });
    this.timeHint.textContent = fmt(STR.conditions.timeHint, { time: STR.conditions.summaryTimes[this.trackTime] });
  }
}
