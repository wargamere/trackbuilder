import { STR, fmt } from '../config/strings.ts';
import { button, h } from './dom.ts';

export interface PauseActions {
  resume(): void;
  resetCar(): void;
  restart(): void;
  /** Practice -> race, or race -> practice. */
  switchMode(): void;
  mainMenu(): void;
  drawTrack(): void;
  myTracks(): void;
  toggleSound(): void;
}

/** Pause overlay: Resume, Reset car, race/practice switch, Restart, Draw your track, My tracks, Main menu, sound, plus a controls reminder. */
export class PauseMenu {
  readonly root: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly sound: HTMLButtonElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly modeBtn: HTMLButtonElement;

  constructor(actions: PauseActions) {
    this.controls = h('p', { class: 'pause-controls' });
    this.sound = button(STR.buttons.soundOn, actions.toggleSound, { icon: '♪', key: 'M' });
    this.restartBtn = button(STR.buttons.restart, actions.restart, { icon: '⟲' });
    this.modeBtn = button(STR.buttons.startRace, actions.switchMode, { icon: '🏁' });
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
          this.modeBtn,
          this.restartBtn,
          button(STR.buttons.drawTrack, actions.drawTrack, { icon: '✎' }),
          button(STR.buttons.myTracks, actions.myTracks, { icon: '☰' }),
          button(STR.buttons.mainMenu, actions.mainMenu, { icon: '⌂' }),
          this.sound,
        ),
        h('div', { class: 'label', text: STR.race.controlsTitle }),
        this.controls,
      ),
    );
    this.root.hidden = true;
  }

  /** Labels for practice (start a race / back to the grid) or a race (practise instead / restart race). */
  setMode(mode: 'practice' | 'race', laps: number): void {
    const set = (b: HTMLButtonElement, t: string) => {
      const l = b.querySelector('.btn-label');
      if (l) l.textContent = t;
    };
    set(this.modeBtn, mode === 'practice' ? fmt(STR.buttons.startRaceLaps, { n: laps }) : STR.buttons.practice);
    set(this.restartBtn, mode === 'practice' ? STR.buttons.backToGrid : STR.buttons.restart);
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
