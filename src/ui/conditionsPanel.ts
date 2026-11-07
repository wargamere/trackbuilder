import { CONDITIONS } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import type { TimeOfDay } from '../config/track.ts';
import type { RaceSetup, Weather } from '../core/screen.ts';
import { button, h, segmented, type Choice } from './dom.ts';

/** The race conditions in a race setup. */
export type Conditions = Pick<RaceSetup, 'weather' | 'time' | 'tyreWear'>;

/** The time of day a run is driven at: the setup's, or the track's own. */
export function timeFor(c: Pick<RaceSetup, 'time'>, trackTime: TimeOfDay): TimeOfDay {
  return c.time === 'track' ? trackTime : c.time;
}

/** One line for the race setup, as in "Rain · night · tyre wear & pit stops". */
export function conditionsSummary(c: Conditions, trackTime: TimeOfDay): string {
  const C = STR.conditions;
  return [c.weather === 'rain' ? C.summaryRain : C.summaryDry, C.summaryTimes[timeFor(c, trackTime)], c.tyreWear ? C.summaryWear : C.summaryNoWear].join(' · ');
}

/**
 * The race conditions: dry or rain, the time of day (the track's own, day,
 * sunset or night), and tyre wear with pit stops on or off. They're part of
 * the race setup being made (not saved until it starts), so the panel works
 * on what it's given and reports each change. Opens over the race setup.
 */
export class ConditionsPanel {
  readonly root: HTMLElement;
  private readonly weather: Choice<Weather>;
  private readonly time: Choice<Conditions['time']>;
  private readonly tyres: Choice<boolean>;
  private readonly timeHint: HTMLElement;
  private get: () => Conditions = () => ({ weather: 'dry', time: 'track', tyreWear: false });
  private trackTime: TimeOfDay = 'day';
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
      ],
      (v) => set({ weather: v }),
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
    const field = (label: string, control: HTMLElement, hint: string | HTMLElement) => {
      control.setAttribute('aria-label', label);
      return h('div', { class: 'field' }, h('span', { class: 'label', text: label }), control, typeof hint === 'string' ? h('p', { class: 'setup-hint', text: hint }) : hint);
    };
    this.timeHint = h('p', { class: 'setup-hint' });
    const panel = h(
      'div',
      { class: 'panel assists-panel conditions-panel' },
      h('h2', { text: C.title }),
      h('p', { class: 'assists-intro', text: C.intro }),
      field(C.weather, this.weather.el, C.weatherHint),
      field(C.time, this.time.el, this.timeHint),
      field(C.tyres, this.tyres.el, fmt(C.tyresHint, { n: CONDITIONS.cliffLaps, s: CONDITIONS.service })),
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
  open(host: HTMLElement, opts: { get: () => Conditions; change: (patch: Partial<Conditions>) => void; trackTime: TimeOfDay; onClose?: () => void }): void {
    this.get = opts.get;
    this.change = opts.change;
    this.trackTime = opts.trackTime;
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
    this.timeHint.textContent = fmt(STR.conditions.timeHint, { time: STR.conditions.summaryTimes[this.trackTime] });
  }
}
