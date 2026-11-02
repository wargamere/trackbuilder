import { STR } from '../config/strings.ts';
import { button, h } from './dom.ts';

export interface HudActions {
  drawTrack(): void;
}

/** In-race HUD. Phase 1 only has the track info and the "Draw your track" button. */
export class Hud {
  readonly root: HTMLElement;
  private readonly top: HTMLElement;
  private readonly info: HTMLElement;
  private readonly note: HTMLElement;
  private readonly debug: HTMLElement;

  constructor(actions: HudActions) {
    this.info = h('div', { class: 'hud-info' });
    this.note = h('div', { class: 'hud-note' });
    this.top = h(
      'div',
      { class: 'hud-top' },
      button(STR.buttons.drawTrack, actions.drawTrack, { icon: '✎', class: 'draw' }),
      this.info,
    );
    this.debug = h('div', { class: 'hud-debug' });
    this.root = h('div', { class: 'screen hud' }, this.top, this.note, this.debug);
  }

  insets(): { top: number; bottom: number } {
    return { top: this.top.offsetHeight + 8, bottom: this.note.offsetHeight + 8 };
  }

  setTrackInfo(text: string): void {
    this.info.textContent = text;
  }

  /** Dev-build performance line (fps, draw calls). */
  setDebug(text: string): void {
    this.debug.textContent = text;
  }

  setNote(text: string): void {
    this.note.textContent = text;
    this.note.hidden = !text;
  }
}
