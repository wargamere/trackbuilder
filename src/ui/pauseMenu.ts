import { STR } from '../config/strings.ts';
import { button, h } from './dom.ts';

export interface PauseActions {
  resume(): void;
  resetCar(): void;
  restart(): void;
  drawTrack(): void;
  myTracks(): void;
  toggleSound(): void;
}

/** Pause overlay: Resume, Reset car, Restart race, Draw your track, plus a controls reminder. */
export class PauseMenu {
  readonly root: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly sound: HTMLButtonElement;

  constructor(actions: PauseActions) {
    this.controls = h('p', { class: 'pause-controls' });
    this.sound = button(STR.buttons.soundOn, actions.toggleSound, { icon: '♪', key: 'M' });
    this.root = h(
      'div',
      { class: 'screen overlay pause' },
      h(
        'div',
        { class: 'panel' },
        h('h2', { text: STR.race.paused }),
        h(
          'div',
          { class: 'menu' },
          button(STR.buttons.resume, actions.resume, { icon: '▶', class: 'primary', key: 'Esc' }),
          button(STR.buttons.resetCar, actions.resetCar, { icon: '↺', key: 'R' }),
          button(STR.buttons.restart, actions.restart, { icon: '⟲' }),
          button(STR.buttons.drawTrack, actions.drawTrack, { icon: '✎' }),
          button(STR.buttons.myTracks, actions.myTracks, { icon: '☰' }),
          this.sound,
        ),
        h('div', { class: 'label', text: STR.race.controlsTitle }),
        this.controls,
      ),
    );
    this.root.hidden = true;
  }

  setSound(on: boolean): void {
    const label = this.sound.querySelector('.btn-label');
    if (label) label.textContent = on ? STR.buttons.soundOn : STR.buttons.soundOff;
  }

  show(controlsText: string): void {
    this.controls.textContent = controlsText;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}
