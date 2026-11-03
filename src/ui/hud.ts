import { STR, fmt } from '../config/strings.ts';
import { settings } from '../core/settings.ts';
import { MEDALS, type MedalTimes } from '../race/medals.ts';
import { formatTime } from '../race/session.ts';
import { button, h } from './dom.ts';
import { Minimap } from './minimap.ts';

export interface HudActions {
  drawTrack(): void;
  pause(): void;
  /** From practice: start a proper race. */
  startRace(): void;
}

export type FlashKind = 'info' | 'good' | 'bad' | 'big';

/**
 * In-race HUD: "Draw your track", track info, pause button, lap timer with last
 * and best laps, countdown and messages in the centre, split deltas, speedometer
 * and a controls hint.
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
  private medalKey = '';
  readonly minimap = new Minimap();
  private lastSpeed = -1;
  private readonly speedUnit: HTMLElement;
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
    const timer = h('div', { class: 'hud-timer' }, this.lapLabel, this.time, this.lastBest, this.medals, this.split);
    this.center = h('div', { class: 'hud-center' });
    this.speedValue = h('span', { class: 'speed-value', text: '0' });
    this.speedUnit = h('span', { class: 'speed-unit', text: STR.race.speedUnit });
    const speed = h('div', { class: 'hud-speed' }, this.speedValue, this.speedUnit);
    this.hint = h('div', { class: 'hud-hint' });
    this.debug = h('div', { class: 'hud-debug' });
    this.root = h('div', { class: 'screen hud' }, top, timer, this.minimap.root, this.center, speed, this.hint, this.debug);
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

  /** Practice shows a "Start race" button; a race doesn't. */
  setMode(mode: 'practice' | 'race', laps: number): void {
    this.raceBtn.hidden = mode !== 'practice';
    const label = this.raceBtn.querySelector('.btn-label');
    if (label) label.textContent = fmt(STR.buttons.startRaceLaps, { n: laps });
  }

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
