import { STR } from '../config/strings.ts';
import { button, h } from './dom.ts';

export interface HudActions {
  drawTrack(): void;
  pause(): void;
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
  private lastSpeed = -1;
  private lastTime = '';
  private hintTimer = 0;
  private centerTimer = 0;
  private splitTimer = 0;

  constructor(actions: HudActions) {
    this.info = h('div', { class: 'hud-info' });
    const pause = button('', actions.pause, { icon: 'Ⅱ', class: 'icon-btn' });
    pause.title = STR.buttons.pause;
    pause.setAttribute('aria-label', STR.buttons.pause);
    const top = h(
      'div',
      { class: 'hud-top' },
      button(STR.buttons.drawTrack, actions.drawTrack, { icon: '✎', class: 'draw compact' }),
      this.info,
      h('div', { class: 'spacer' }),
      pause,
    );
    this.lapLabel = h('div', { class: 'lap-label' });
    this.time = h('div', { class: 'lap-time', text: '0:00.00' });
    this.lastBest = h('div', { class: 'lap-sub' });
    this.split = h('div', { class: 'hud-split' });
    const timer = h('div', { class: 'hud-timer' }, this.lapLabel, this.time, this.lastBest, this.split);
    this.center = h('div', { class: 'hud-center' });
    this.speedValue = h('span', { class: 'speed-value', text: '0' });
    const speed = h('div', { class: 'hud-speed' }, this.speedValue, h('span', { class: 'speed-unit', text: STR.race.speedUnit }));
    this.hint = h('div', { class: 'hud-hint' });
    this.debug = h('div', { class: 'hud-debug' });
    this.root = h('div', { class: 'screen hud' }, top, timer, this.center, speed, this.hint, this.debug);
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
    const kmh = Math.round(Math.abs(metresPerSecond) * 3.6);
    if (kmh !== this.lastSpeed) {
      this.speedValue.textContent = String(kmh);
      this.lastSpeed = kmh;
    }
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
