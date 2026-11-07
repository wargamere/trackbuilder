import { CONDITIONS, TYRES, type Compound } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import { settings } from '../core/settings.ts';
import { MEDALS, type MedalTimes } from '../race/medals.ts';
import { formatTime } from '../race/session.ts';
import { button, h } from './dom.ts';
import { Minimap } from './minimap.ts';

export interface HudActions {
  drawTrack(): void;
  pause(): void;
  /** From practice: open the race setup to start a proper race. */
  startRace(): void;
}

export type FlashKind = 'info' | 'good' | 'bad' | 'big';

/**
 * In-race HUD: "Draw your track", track info, pause button, lap timer with last
 * and best laps, countdown and messages in the centre, split deltas, speedometer
 * (gear, revs and, with tyre wear, the tyres' grip) and a controls hint.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly info: HTMLElement;
  private readonly lapLabel: HTMLElement;
  private readonly time: HTMLElement;
  private readonly lastBest: HTMLElement;
  private readonly split: HTMLElement;
  private readonly center: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly medals: HTMLElement;
  private readonly pos: HTMLElement;
  private readonly draft: HTMLElement;
  private draftOn = false;
  private readonly posValue: HTMLElement;
  private medalKey = '';
  readonly minimap = new Minimap();
  private lastSpeed = -1;
  private cut = false;
  private readonly speedUnit: HTMLElement;
  private readonly gearValue: HTMLElement;
  private readonly gearMode: HTMLElement;
  private readonly revFill: HTMLElement;
  private readonly revBar: HTMLElement;
  private lastGear = '';
  private lastRev = -1;
  private readonly tyres: HTMLElement;
  private readonly tyreChip: HTMLElement;
  private readonly tyreFill: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly pickerButtons = new Map<Compound, HTMLButtonElement>();
  private readonly tyreValue: HTMLElement;
  private lastTyres = '';
  private readonly raceBtn: HTMLButtonElement;
  private lastTime = '';
  private hintTimer = 0;
  private centerTimer = 0;
  private splitTimer = 0;

  constructor(actions: HudActions) {
    this.info = h('div', { class: 'hud-info' });
    this.raceBtn = button(STR.buttons.startRace, actions.startRace, { icon: '🏁', class: 'draw race-btn' });
    const pause = button('', actions.pause, { icon: 'Ⅱ', class: 'icon-btn' });
    pause.title = STR.buttons.pause;
    pause.setAttribute('aria-label', STR.buttons.pause);
    const top = h(
      'div',
      { class: 'hud-top' },
      button(STR.buttons.drawTrack, actions.drawTrack, { icon: '✎', class: 'draw' }),
      this.raceBtn,
      this.info,
      h('div', { class: 'spacer' }),
      pause,
    );
    this.lapLabel = h('div', { class: 'lap-label' });
    this.time = h('div', { class: 'lap-time', text: '0:00.00' });
    this.lastBest = h('div', { class: 'lap-sub' });
    this.split = h('div', { class: 'hud-split' });
    this.medals = h('div', { class: 'hud-medals' });
    this.posValue = h('span', { class: 'pos-value' });
    this.pos = h('div', { class: 'hud-pos' }, h('span', { class: 'pos-label', text: STR.race.position }), this.posValue);
    this.pos.hidden = true;
    const timer = h('div', { class: 'hud-timer' }, this.pos, this.lapLabel, this.time, this.lastBest, this.medals, this.split);
    this.center = h('div', { class: 'hud-center' });
    this.speedValue = h('span', { class: 'speed-value', text: '0' });
    this.speedUnit = h('span', { class: 'speed-unit', text: STR.race.speedUnit });
    this.gearValue = h('span', { class: 'gear-value', text: '1' });
    this.gearMode = h('span', { class: 'gear-mode', text: STR.race.gearAuto });
    this.revFill = h('div', { class: 'rev-fill' });
    this.revBar = h('div', { class: 'rev-bar' }, this.revFill);
    this.tyreChip = h('span', { class: 'tyre-chip' });
    this.tyreFill = h('div', { class: 'tyre-fill' });
    this.tyreValue = h('span', { class: 'tyre-value' });
    this.tyres = h('div', { class: 'hud-tyres', title: STR.race.tyresTitle }, this.tyreChip, h('div', { class: 'tyre-bar' }, this.tyreFill), this.tyreValue);
    this.tyres.hidden = true;
    this.picker = h('div', { class: 'tyre-picker' });
    this.picker.setAttribute('role', 'group');
    this.picker.setAttribute('aria-label', STR.race.pitPick);
    this.picker.hidden = true;
    const speed = h(
      'div',
      { class: 'hud-speed' },
      h('div', { class: 'hud-gear', title: STR.race.gearTitle }, this.gearValue, this.gearMode),
      h('div', { class: 'speed-main' }, this.speedValue, this.speedUnit),
      this.revBar,
      this.tyres,
    );
    this.draft = h('div', { class: 'hud-draft', text: STR.race.slipstream });
    this.hint = h('div', { class: 'hud-hint' });
    this.debug = h('div', { class: 'hud-debug' });
    this.root = h('div', { class: 'screen hud' }, top, timer, this.minimap.root, this.center, speed, this.draft, this.picker, this.hint, this.debug);
  }

  /** Medal targets under the timer; the ones your best lap has won are lit. */
  setMedals(m: MedalTimes | null, best: number | null): void {
    const key = m ? `${m.gold}|${m.silver}|${m.bronze}|${best}` : '';
    if (key === this.medalKey) return;
    this.medalKey = key;
    this.medals.replaceChildren();
    if (!m) return;
    for (const { id } of MEDALS) {
      const won = best !== null && best <= m[id];
      const chip = h('span', { class: `medal-chip ${id}${won ? ' won' : ''}`, title: STR.medals[id] }, h('i', { class: `medal ${id}` }), formatTime(m[id]));
      this.medals.append(chip);
    }
  }

  /** Rearranges the HUD around the on-screen touch controls. */
  setTouchLayout(on: boolean): void {
    this.root.classList.toggle('touch', on);
  }

  setTrackInfo(text: string): void {
    this.info.textContent = text;
  }

  setLap(text: string): void {
    if (this.lapLabel.textContent !== text) this.lapLabel.textContent = text;
  }

  setTime(text: string): void {
    if (text !== this.lastTime) {
      this.time.textContent = text;
      this.lastTime = text;
    }
  }

  /** Marks the lap being driven as invalid (track limits). */
  setCut(on: boolean): void {
    if (this.cut === on) return;
    this.cut = on;
    this.time.classList.toggle('cut', on);
    this.time.title = on ? STR.race.trackLimitsShort : '';
  }

  setLastBest(text: string): void {
    if (this.lastBest.textContent !== text) this.lastBest.textContent = text;
  }

  setSpeed(metresPerSecond: number): void {
    const mph = settings().units === 'mph';
    const v = Math.round(Math.abs(metresPerSecond) * (mph ? 2.23694 : 3.6));
    if (v !== this.lastSpeed) {
      this.speedValue.textContent = String(v);
      this.lastSpeed = v;
    }
    const unit = mph ? STR.race.speedUnitMph : STR.race.speedUnit;
    if (this.speedUnit.textContent !== unit) this.speedUnit.textContent = unit;
  }

  /**
   * The gear (R when reversing), AUTO or MAN under it, and the rev bar. With
   * manual gears the bar lights up from the shift point and flashes on the
   * limiter.
   */
  setGear(gear: number, rpm: number, speed: number, manual: boolean, shiftLight: number): void {
    const g = speed < -0.5 ? STR.race.gearReverse : String(gear);
    const mode = manual ? STR.race.gearManual : STR.race.gearAuto;
    const key = `${g}|${mode}`;
    if (key !== this.lastGear) {
      this.lastGear = key;
      this.gearValue.textContent = g;
      this.gearMode.textContent = mode;
    }
    const r = Math.round(Math.max(0, Math.min(1, rpm)) * 100) / 100;
    if (r !== this.lastRev) {
      this.lastRev = r;
      this.revFill.style.width = `${(r * 100).toFixed(0)}%`;
    }
    this.revBar.classList.toggle('shift', manual && r >= shiftLight);
    this.revBar.classList.toggle('limit', manual && r >= 0.99);
  }

  /**
   * Tyre wear: the kind of tyres on (S / M / H / W, in their colour) and how
   * much of their life is left, as a bar and a percentage: yellow when
   * they'll go off soon, red once they have; or the pit stop counting down
   * while the crew works. Null hides it (tyre wear off).
   */
  setTyres(compound: Compound | null, left = 1, pitLeft = 0): void {
    this.tyres.hidden = compound === null;
    if (compound === null) return;
    const state = pitLeft > 0 ? 'pit' : left <= 0 ? 'gone' : left < 1 - TYRES.wornAt ? 'worn' : 'ok';
    const fill = pitLeft > 0 ? 1 - pitLeft / CONDITIONS.service : Math.max(0, Math.min(1, left));
    const text = pitLeft > 0 ? fmt(STR.race.pitService, { s: pitLeft.toFixed(1) }) : `${Math.round(fill * 100)}%`;
    const key = `${compound}|${fill.toFixed(2)}|${state}|${text}`;
    if (key === this.lastTyres) return;
    this.lastTyres = key;
    this.tyreChip.textContent = STR.tyres.letters[compound];
    this.tyreChip.dataset.compound = compound;
    this.tyreChip.title = STR.tyres.names[compound];
    this.tyreFill.style.width = `${(fill * 100).toFixed(0)}%`;
    this.tyres.dataset.state = state;
    this.tyreValue.textContent = text;
  }

  /**
   * The tyre choice in a pit stop: each kind (key 1–4) with how long it lasts
   * here; `pick` gets a tap. Null hides it.
   */
  showTyrePicker(opts: { choices: { compound: Compound; laps: number }[]; selected: Compound; pick: (c: Compound) => void } | null): void {
    this.picker.hidden = !opts;
    if (!opts) return;
    this.pickerButtons.clear();
    const buttons = opts.choices.map(({ compound, laps }, i) => {
      const label = fmt(STR.conditions.lifeLaps, { name: STR.tyres.names[compound], n: laps.toFixed(1) });
      const b = button(label, () => opts.pick(compound), { class: 'compact tyre-pick', key: String(i + 1) });
      const chip = h('span', { class: 'tyre-chip', text: STR.tyres.letters[compound] });
      chip.dataset.compound = compound;
      b.prepend(chip);
      this.pickerButtons.set(compound, b);
      return b;
    });
    this.picker.replaceChildren(h('span', { class: 'tyre-picker-title', text: STR.race.pitPick }), ...buttons);
    this.setTyrePick(opts.selected);
  }

  /** Marks the tyres chosen in the pit stop. */
  setTyrePick(c: Compound): void {
    for (const [k, b] of this.pickerButtons) {
      b.classList.toggle('on', k === c);
      b.setAttribute('aria-pressed', String(k === c));
    }
  }

  /** Practice shows a "Start a race" button; a race doesn't. */
  setMode(mode: 'practice' | 'race'): void {
    this.raceBtn.hidden = mode !== 'practice';
  }

  /** Race position against the AI cars ("2/4"), or null to hide it. */
  setPosition(pos: number | null, of = 0): void {
    this.pos.hidden = pos === null;
    if (pos === null) return;
    const t = fmt(STR.race.positionValue, { pos, n: of });
    if (this.posValue.textContent !== t) this.posValue.textContent = t;
  }

  /**
   * Lights the "Slipstream" tag while you're in the slipstream of a car ahead
   * (`amount` above `show`); its bar fills with how strong the tow is (0..1).
   */
  setSlipstream(amount: number, show: number): void {
    const on = amount > show;
    if (on !== this.draftOn) {
      this.draftOn = on;
      this.draft.classList.toggle('on', on);
    }
    if (on) {
      const pct = String(Math.round(amount * 20) * 5);
      if (this.draftPct !== pct) {
        this.draftPct = pct;
        this.draft.style.setProperty('--draft', `${pct}%`);
      }
    }
  }
  private draftPct = '';

  /** Shows or hides the minimap (Display settings). */
  showMinimap(on: boolean): void {
    this.minimap.root.hidden = !on;
  }

  /** Big centred message (countdown digits, GO!, lap messages). `seconds` <= 0 keeps it up. */
  flash(text: string, kind: FlashKind = 'info', seconds = 1.6): void {
    this.center.textContent = text;
    this.center.className = `hud-center visible ${kind}`;
    // Restart the pop-in animation.
    void this.center.offsetWidth;
    this.center.classList.add('pop');
    this.centerTimer = seconds > 0 ? seconds : Infinity;
  }

  clearFlash(): void {
    this.centerTimer = 0;
    this.center.classList.remove('visible');
  }

  /** Split delta under the timer: green when ahead of your best, red when behind. */
  showSplit(text: string, ahead: boolean): void {
    this.split.textContent = text;
    this.split.className = `hud-split visible ${ahead ? 'ahead' : 'behind'}`;
    this.splitTimer = 2.2;
  }

  /** Shows a controls hint for `seconds`. */
  showHint(text: string, seconds = 8): void {
    this.hint.textContent = text;
    this.hint.classList.add('visible');
    this.hintTimer = seconds;
  }

  tick(dt: number): void {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hint.classList.remove('visible');
    }
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) this.center.classList.remove('visible');
    }
    if (this.splitTimer > 0) {
      this.splitTimer -= dt;
      if (this.splitTimer <= 0) this.split.classList.remove('visible');
    }
  }

  /** Dev-build performance line (fps, draw calls). */
  setDebug(text: string): void {
    this.debug.textContent = text;
  }
}
