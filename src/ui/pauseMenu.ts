import { keyLabel } from '../car/bindings.ts';
import { STR } from '../config/strings.ts';
import { settings } from '../core/settings.ts';
import { button, h } from './dom.ts';

export interface PauseActions {
  resume(): void;
  resetCar(): void;
  restart(): void;
  /** Opens the race setup (practice or race, laps, ghost, AI cars). */
  raceSettings(): void;
  /** Opens the driving assists (racing line, braking, steering, gears). */
  assists(): void;
  /** Opens the keyboard controls. */
  controls(): void;
  /** Qualifying: stop now and go to the grid. */
  skipQualifying(): void;
  mainMenu(): void;
  drawTrack(): void;
  myTracks(): void;
  toggleSound(): void;
}

/** Pause overlay: Resume, Reset car, Restart, Race settings, Draw your track, My tracks, Main menu, sound, plus a controls reminder. */
export class PauseMenu {
  readonly root: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly sound: HTMLButtonElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;

  constructor(actions: PauseActions) {
    this.controls = h('p', { class: 'pause-controls' });
    this.sound = button(STR.buttons.soundOn, actions.toggleSound, { icon: '♪', key: 'M' });
    this.restartBtn = button(STR.buttons.restart, actions.restart, { icon: '⟲' });
    this.skipBtn = button(STR.buttons.skipQualifying, actions.skipQualifying, { icon: '⏭' });
    this.skipBtn.hidden = true;
    this.resetBtn = button(STR.buttons.resetCar, actions.resetCar, { icon: '↺', key: 'R' });
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
          this.resetBtn,
          this.restartBtn,
          this.skipBtn,
          button(STR.buttons.raceSettings, actions.raceSettings, { icon: '🏁' }),
          button(STR.assists.open, () => {
            this.hide();
            actions.assists();
          }, { icon: '🛞' }),
          button(STR.controls.open, () => {
            this.hide();
            actions.controls();
          }, { icon: '⌨' }),
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

  /** Restart reads "Back to the grid" in practice, "Restart qualifying" (plus Skip) in qualifying and "Restart race" in a race. */
  setMode(mode: 'practice' | 'race' | 'qualifying'): void {
    const l = this.restartBtn.querySelector('.btn-label');
    if (l) l.textContent = mode === 'practice' ? STR.buttons.backToGrid : mode === 'qualifying' ? STR.buttons.restartQualifying : STR.buttons.restart;
    this.skipBtn.hidden = mode !== 'qualifying';
  }

  setSound(on: boolean): void {
    const label = this.sound.querySelector('.btn-label');
    if (label) label.textContent = on ? STR.buttons.soundOn : STR.buttons.soundOff;
  }

  show(controlsText: string): void {
    this.controls.textContent = controlsText;
    // The key hints on the buttons follow your key bindings.
    const keys = settings().keys;
    for (const [btn, code] of [
      [this.resetBtn, keys.reset[0]],
      [this.sound, keys.mute[0]],
    ] as const) {
      const kbd = btn.querySelector('kbd');
      if (!kbd) continue;
      kbd.textContent = code ? keyLabel(code) : '';
      kbd.hidden = !code;
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}
