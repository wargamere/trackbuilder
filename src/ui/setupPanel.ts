import { DEFAULT_SETUP, type BrakeBalance, type CarSetup, type GearSet, type WingLevel } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import { settings, updateSettings } from '../core/settings.ts';
import { suggestedSetup, wingLapTimes } from '../race/strategy.ts';
import type { Track } from '../track/track.ts';
import { button, h, segmented, type Choice } from './dom.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One line for the race setup: "Low wing · short gears · balanced brakes", or "Standard". */
export function setupSummary(s: CarSetup): string {
  if (s.wing === DEFAULT_SETUP.wing && s.gears === DEFAULT_SETUP.gears && s.brakes === DEFAULT_SETUP.brakes) return STR.carSetup.summaryStandard;
  const L = STR.carSetup.lower;
  return cap(fmt(STR.carSetup.summary, { wing: L[s.wing], gears: L[s.gears], brakes: L[s.brakes] }));
}

/** "−0.08" / "+0.23": seconds against medium wing. */
const signed = (x: number) => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(2)}`;

/**
 * The car setup: wing, gears and brake balance, with what each wing is worth
 * on this track and the setup suggested for it. Changes apply straight away
 * and are remembered. Opens over the race setup.
 */
export class SetupPanel {
  readonly root: HTMLElement;
  private readonly wing: Choice<WingLevel>;
  private readonly gears: Choice<GearSet>;
  private readonly brakes: Choice<BrakeBalance>;
  private readonly wingLine: HTMLElement;
  private readonly suggested: HTMLElement;
  private track: Track | null = null;
  private onClose: () => void = () => {};

  constructor() {
    const C = STR.carSetup;
    const set = (patch: Partial<CarSetup>) => {
      updateSettings({ carSetup: { ...settings().carSetup, ...patch } });
      this.render();
    };
    this.wing = segmented<WingLevel>(
      (['low', 'medium', 'high'] as const).map((v) => [v, C.wings[v]] as [WingLevel, string]),
      (v) => set({ wing: v }),
    );
    this.gears = segmented<GearSet>(
      (['short', 'medium', 'long'] as const).map((v) => [v, C.gearSets[v]] as [GearSet, string]),
      (v) => set({ gears: v }),
    );
    this.brakes = segmented<BrakeBalance>(
      (['front', 'balanced', 'rear'] as const).map((v) => [v, C.balances[v]] as [BrakeBalance, string]),
      (v) => set({ brakes: v }),
    );
    const field = (label: string, control: HTMLElement, ...hints: HTMLElement[]) => {
      control.setAttribute('aria-label', label);
      return h('div', { class: 'field' }, h('span', { class: 'label', text: label }), control, ...hints);
    };
    const hint = (text: string) => h('p', { class: 'setup-hint', text });
    this.wingLine = h('p', { class: 'setup-hint setup-numbers' });
    this.suggested = h('span', { class: 'setup-suggested' });
    const panel = h(
      'div',
      { class: 'panel assists-panel car-setup-panel' },
      h('h2', { text: C.title }),
      h('p', { class: 'assists-intro', text: C.intro }),
      field(C.wing, this.wing.el, hint(C.wingHint), this.wingLine),
      field(C.gears, this.gears.el, hint(C.gearsHint)),
      field(C.brakes, this.brakes.el, hint(C.brakesHint)),
      h(
        'div',
        { class: 'setup-suggest-row' },
        this.suggested,
        button(C.useSuggested, () => this.track && set(suggestedSetup(this.track)), { icon: '★', class: 'compact' }),
        button(C.reset, () => set(DEFAULT_SETUP), { icon: '↺', class: 'compact' }),
      ),
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

  /** Shows it over `host` for `track`; `onClose` runs when it's closed. */
  open(host: HTMLElement, track: Track, onClose: () => void = () => {}): void {
    this.track = track;
    this.onClose = onClose;
    this.render();
    host.append(this.root);
    this.root.hidden = false;
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.root.remove();
    this.onClose();
  }

  private render(): void {
    const s = settings().carSetup;
    this.wing.set(s.wing);
    this.gears.set(s.gears);
    this.brakes.set(s.brakes);
    const t = this.track;
    if (!t) return;
    const laps = wingLapTimes(t);
    this.wingLine.textContent = fmt(STR.carSetup.wingLine, { low: signed(laps.low - laps.medium), high: signed(laps.high - laps.medium) });
    this.suggested.textContent = fmt(STR.carSetup.suggested, { wing: STR.carSetup.lower[suggestedSetup(t).wing] });
  }
}
