import { STR, fmt } from '../config/strings.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { builtInTrack, builtInTracks, trackFromCode } from '../editor/pipeline.ts';
import { drawPaper, fitView, PAPER } from '../editor/render2d.ts';
import { medalFor, medalTimes } from '../race/medals.ts';
import { formatTime } from '../race/session.ts';
import { sampleClosedCatmullRom } from '../track/spline.ts';
import type { TrackGroup } from '../track/catalog.ts';
import { WORLD_TRACKS_LICENCE } from '../track/data/notices.ts';
import { buildTrack, type TrackDef } from '../track/track.ts';
import { button, h, segmented } from './dom.ts';
import { ShareDialog } from './shareDialog.ts';

/** Length per track id (building a track for its stats isn't free). */
const statsCache = new Map<string, { len: number }>();

/** Draws a track's outline into a small canvas, fitted with a margin. */
function drawThumbnail(canvas: HTMLCanvasElement, dots: TrackDef['control']): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = 160;
  const hgt = 90;
  canvas.width = w * dpr;
  canvas.height = hgt * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#e8efd9';
  ctx.fillRect(0, 0, w, hgt);
  const pts = sampleClosedCatmullRom(dots, 4);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const s = Math.min((w - 16) / Math.max(1, maxX - minX), (hgt - 16) / Math.max(1, maxY - minY));
  const ox = w / 2 - ((minX + maxX) / 2) * s;
  const oy = hgt / 2 - ((minY + maxY) / 2) * s;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(ox + p.x * s, oy + p.y * s) : ctx.moveTo(ox + p.x * s, oy + p.y * s)));
  ctx.closePath();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(3.5, 14 * s);
  ctx.stroke();
  ctx.strokeStyle = PAPER.asphalt;
  ctx.lineWidth = Math.max(2.5, 12 * s);
  ctx.stroke();
  const st = dots[0];
  ctx.fillStyle = PAPER.close;
  ctx.beginPath();
  ctx.arc(ox + st.x * s, oy + st.y * s, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * LIBRARY state: three lists in tabs (your saved tracks, the game's own, and
 * the real-world circuits), with thumbnails and personal bests. Race, edit,
 * share (track code) or delete each one, or paste a friend's code to load
 * their track.
 */
export class LibraryScreen implements Screen {
  readonly layer = '2d';
  private readonly game: GameContext;
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly message: HTMLElement;
  private readonly share = new ShareDialog();
  private abort: AbortController | null = null;
  /** The list shown (null until first opened: yours if you have any, else the game's). */
  private tab: TrackGroup | null = null;

  constructor(game: GameContext) {
    this.game = game;
    this.input = h('input', { class: 'text-input' });
    this.input.type = 'text';
    this.input.placeholder = STR.library.importPlaceholder;
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.importCode(false);
    });
    this.message = h('div', { class: 'library-message' });
    this.list = h('div', { class: 'library-list' });
    this.root = h(
      'div',
      { class: 'screen library' },
      h(
        'div',
        { class: 'library-head' },
        button(STR.buttons.back, () => this.game.go('menu'), { icon: '✕', key: 'Esc', class: 'compact' }),
        h('h2', { text: STR.library.title }),
        h('div', { class: 'spacer' }),
        button(STR.buttons.newTrack, () => this.game.go('editor'), { icon: '✎', class: 'primary' }),
      ),
      h(
        'div',
        { class: 'library-import' },
        h('span', { class: 'label', text: STR.library.importLabel }),
        h(
          'div',
          { class: 'row' },
          this.input,
          button(STR.library.loadRace, () => this.importCode(false), { icon: '▶' }),
          button(STR.library.saveCode, () => this.importCode(true), { icon: '⬇' }),
        ),
        this.message,
      ),
      this.list,
    );
  }

  enter(): void {
    this.message.textContent = '';
    this.input.value = '';
    this.render();
    this.game.ui.append(this.root);
    this.abort = new AbortController();
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && !this.share.isOpen && !(e.target instanceof HTMLInputElement)) {
          e.preventDefault();
          this.game.go('menu');
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

  resize(): void {}

  frame(): void {
    const s = this.game.surface;
    const ctx = s.begin();
    drawPaper(ctx, fitView(s.w, s.h, 0, 0), s.w, s.h);
  }

  private say(text: string, kind: 'ok' | 'error'): void {
    this.message.textContent = text;
    this.message.className = `library-message ${kind}`;
  }

  /** Races a pasted code, or (with `save`) adds it to My tracks. */
  private importCode(save: boolean): void {
    const text = this.input.value;
    if (!text.trim()) return;
    const res = trackFromCode(text);
    if (!res.ok) {
      const e = res.error;
      const msg =
        e === 'format' || e === 'checksum'
          ? STR.library.codeErrors[e]
          : fmt(STR.library.invalidTrack, { reason: STR.editor.errors[e].toLowerCase() });
      this.say(msg, 'error');
      return;
    }
    if (save) {
      this.game.library.save(res.track.def);
      this.say(STR.library.saved, 'ok');
      this.input.value = '';
      this.render();
      return;
    }
    this.say(STR.library.loaded, 'ok');
    this.race(res.track.def);
  }

  private race(def: TrackDef): void {
    this.game.setTrack((def.builtIn && builtInTrack(def.id)) || buildTrack(def));
    this.game.openSetup();
  }

  private edit(def: TrackDef): void {
    this.game.setTrack((def.builtIn && builtInTrack(def.id)) || buildTrack(def));
    this.game.go('editor');
  }

  private card(def: TrackDef, deletable: boolean): HTMLElement {
    let info = statsCache.get(def.id);
    if (!info) {
      const t = (def.builtIn && builtInTrack(def.id)) || buildTrack(def);
      info = { len: t.center.length };
      statsCache.set(def.id, info);
    }
    const thumb = h('canvas', { class: 'thumb' });
    drawThumbnail(thumb, def.control);
    const rec = this.game.records.summary(def.id);
    const stats = fmt(STR.library.stats, { len: Math.round(info.len).toLocaleString('en-US') });
    const medal = rec.best && rec.author ? medalFor(rec.best.time, medalTimes(rec.author)) : null;
    const best = rec.best
      ? fmt(STR.library.best, { time: formatTime(rec.best.time), score: rec.bestScore.toLocaleString('en-US') })
      : STR.library.notRaced;
    const actions = h(
      'div',
      { class: 'card-actions' },
      button(STR.buttons.race, () => this.race(def), { icon: '▶', class: 'primary' }),
      button(STR.buttons.edit, () => this.edit(def), { icon: '✎', class: 'compact' }),
      button(STR.buttons.share, () => this.share.open(def, this.game.ui), { icon: '⧉', class: 'compact' }),
    );
    if (deletable) {
      let armed = false;
      const del = button(
        STR.buttons.delete,
        () => {
          if (!armed) {
            armed = true;
            del.classList.add('danger');
            del.querySelector('.btn-label')!.textContent = STR.buttons.confirmDelete;
            return;
          }
          this.game.library.remove(def.id);
          this.game.records.forget(def.id);
          this.say(STR.library.deleted, 'ok');
          this.render();
        },
        { icon: '🗑', class: 'compact' },
      );
      actions.append(del);
    }
    return h(
      'div',
      { class: 'track-card' },
      thumb,
      h('div', { class: 'card-name', text: def.name }),
      def.place ? h('div', { class: 'card-place', text: def.place }) : null,
      h('div', { class: 'card-stats', text: stats }),
      h('div', { class: `card-best${rec.best ? '' : ' none'}` }, medal ? h('i', { class: `medal ${medal}`, title: STR.medals[medal] }) : null, best),
      actions,
    );
  }

  private render(): void {
    const mine = this.game.library.list();
    const all = builtInTracks();
    const lists: Record<TrackGroup, TrackDef[]> = {
      mine: mine.map((e) => e.def),
      builtIn: all.filter((b) => b.group === 'builtIn').map((b) => b.def),
      world: all.filter((b) => b.group === 'world').map((b) => b.def),
    };
    this.tab ??= mine.length ? 'mine' : 'builtIn';
    const tab = this.tab;
    const order: TrackGroup[] = ['mine', 'builtIn', 'world'];
    const tabs = segmented<TrackGroup>(
      order.map((g) => [g, `${STR.groups[g]} (${lists[g].length})`]),
      (g) => {
        this.tab = g;
        this.render();
      },
    );
    tabs.el.classList.add('library-tabs');
    tabs.set(tab);
    const grid = h('div', { class: 'card-grid' });
    for (const def of lists[tab]) grid.append(this.card(def, tab === 'mine'));
    if (tab === 'mine' && !mine.length) grid.append(h('p', { class: 'help', text: STR.library.empty }));
    const head: (HTMLElement | null)[] = [];
    if (tab === 'mine') {
      // "Delete all" needs a second tap to confirm.
      let armed = false;
      const delAll = button(
        STR.library.deleteAll,
        () => {
          if (!armed) {
            armed = true;
            delAll.classList.add('danger');
            delAll.querySelector('.btn-label')!.textContent = fmt(STR.library.confirmDeleteAll, { n: mine.length });
            return;
          }
          for (const e of mine) this.game.records.forget(e.def.id);
          this.game.library.clear();
          this.say(STR.library.allDeleted, 'ok');
          this.render();
        },
        { icon: '🗑', class: 'compact' },
      );
      delAll.hidden = mine.length === 0;
      head.push(h('div', { class: 'label-row' }, h('div', { class: 'label', text: STR.library.yours }), delAll));
    }
    if (tab === 'world') {
      head.push(h('p', { class: 'help', text: STR.library.worldNote }));
      const credit = h('details', { class: 'credit' }, h('summary', { text: STR.library.worldCredit }), h('pre', { text: WORLD_TRACKS_LICENCE }));
      head.push(credit);
    }
    this.list.replaceChildren(tabs.el, ...head.filter((x): x is HTMLElement => !!x), grid);
  }
}
