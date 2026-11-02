import { STR } from '../config/strings.ts';
import { button, h } from './dom.ts';

export interface HudActions {
  drawTrack(): void;
  pause(): void;
}

/** In-race HUD: track info, "Draw your track", pause button, speedometer and a controls hint. */
export class Hud {
  readonly root: HTMLElement;
  private readonly info: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly debug: HTMLElement;
  private lastSpeed = -1;
  private hintTimer = 0;

  constructor(actions: HudActions) {
    this.info = h('div', { class: 'hud-info' });
    const top = h(
      'div',
      { class: 'hud-top' },
      button(STR.buttons.drawTrack, actions.drawTrack, { icon: '✎', class: 'draw' }),
      this.info,
      h('div', { class: 'spacer' }),
      button('', actions.pause, { icon: 'Ⅱ', class: 'icon-btn' }),
    );
    top.lastElementChild?.setAttribute('title', STR.buttons.pause);
    top.lastElementChild?.setAttribute('aria-label', STR.buttons.pause);
    this.speedValue = h('span', { class: 'speed-value', text: '0' });
    const speed = h('div', { class: 'hud-speed' }, this.speedValue, h('span', { class: 'speed-unit', text: STR.race.speedUnit }));
    this.hint = h('div', { class: 'hud-hint' });
    this.debug = h('div', { class: 'hud-debug' });
    this.root = h('div', { class: 'screen hud' }, top, speed, this.hint, this.debug);
  }

  /** Rearranges the HUD around the on-screen touch controls. */
  setTouchLayout(on: boolean): void {
    this.root.classList.toggle('touch', on);
  }

  setTrackInfo(text: string): void {
    this.info.textContent = text;
  }

  setSpeed(metresPerSecond: number): void {
    const kmh = Math.round(Math.abs(metresPerSecond) * 3.6);
    if (kmh !== this.lastSpeed) {
      this.speedValue.textContent = String(kmh);
      this.lastSpeed = kmh;
    }
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
  }

  /** Dev-build performance line (fps, draw calls). */
  setDebug(text: string): void {
    this.debug.textContent = text;
  }
}
