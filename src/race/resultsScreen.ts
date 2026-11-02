import { STR, fmt } from '../config/strings.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { button, h } from '../ui/dom.ts';
import { ShareDialog } from '../ui/shareDialog.ts';
import { formatTime } from './session.ts';

/**
 * RESULTS state: the run's times and score over a slow orbit of the finished
 * car. "Race again" restarts on the same track (your best lap becomes the
 * ghost); "Draw new track" opens the editor.
 */
export class ResultsScreen implements Screen {
  readonly layer = '3d';
  private readonly game: GameContext;
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private angle = 0;
  private abort: AbortController | null = null;
  private readonly share = new ShareDialog();

  constructor(game: GameContext) {
    this.game = game;
    this.body = h('div', { class: 'results-body' });
    this.root = h(
      'div',
      { class: 'screen overlay results' },
      h(
        'div',
        { class: 'panel' },
        h('h2', { text: STR.results.title }),
        this.body,
        h(
          'div',
          { class: 'menu row' },
          button(STR.buttons.raceAgain, () => this.game.go('race'), { icon: '⟲', class: 'primary', key: 'Enter' }),
          button(STR.buttons.newTrack, () => this.game.go('editor'), { icon: '✎', key: 'E' }),
        ),
        h(
          'div',
          { class: 'menu row secondary' },
          button(STR.buttons.shareTrack, () => this.share.open(this.game.track.def, this.game.ui), { icon: '⧉' }),
          button(STR.buttons.myTracks, () => this.game.go('library'), { icon: '☰' }),
        ),
      ),
    );
  }

  enter(): void {
    const r = this.game.lastResult;
    this.body.replaceChildren();
    if (r) {
      const row = (label: string, value: string, badge?: string) =>
        h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: label }), h('span', { class: 'stat-value', text: value }), badge ? h('span', { class: 'badge', text: badge }) : null);
      this.body.append(
        h('div', { class: 'results-track', text: r.trackName }),
        h(
          'div',
          { class: 'score' },
          h('div', { class: 'score-label', text: STR.results.score }),
          h('div', { class: 'score-value', text: r.score.toLocaleString('en-US') }),
          r.newBestScore ? h('div', { class: 'badge big', text: STR.results.newBestScore }) : h('div', { class: 'score-best', text: `${STR.results.bestScore}: ${r.bestScore.toLocaleString('en-US')}` }),
        ),
        h(
          'div',
          { class: 'stats' },
          row(STR.results.total, formatTime(r.total)),
          row(STR.results.bestLap, formatTime(r.bestLap), r.newRecord ? STR.results.newRecord : undefined),
          r.newRecord ? null : row(STR.results.record, formatTime(r.recordLap)),
          row(STR.results.laps, r.laps.map((t) => formatTime(t)).join('  ·  ')),
          row(STR.results.avgSpeed, fmt(STR.results.kmh, { v: r.avgSpeedKmh.toFixed(1) })),
          row(STR.results.multiplier, `×${r.multiplier.toFixed(2)}`),
        ),
        h('p', { class: 'score-hint', text: STR.results.scoreHint }),
      );
    }
    this.game.ui.append(this.root);
    this.angle = 0;
    this.abort = new AbortController();
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || this.share.isOpen) return;
        if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
          e.preventDefault();
          this.game.go('race');
        } else if (e.code === 'KeyE') {
          e.preventDefault();
          this.game.go('editor');
        }
      },
      { signal: this.abort.signal },
    );
  }

  exit(): void {
    this.abort?.abort();
    this.abort = null;
    this.share.close();
    this.root.remove();
  }

  resize(): void {
    const s = this.game.surface;
    this.game.view3d?.resize(s.w, s.h);
  }

  frame(dt: number): void {
    const v = this.game.view3d;
    const r = this.game.lastResult;
    if (!v || !r) return;
    this.angle += dt * 0.25;
    const cam = v.camera;
    cam.position.set(r.carX + Math.cos(this.angle) * 11, 4.5, r.carZ + Math.sin(this.angle) * 11);
    cam.lookAt(r.carX, 0.8, r.carZ);
    if (Math.abs(cam.fov - 55) > 0.01) {
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }
    v.render();
  }
}
