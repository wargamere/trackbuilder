import { STR } from '../config/strings.ts';
import { CAPS } from '../platform/platform.ts';
import { trackLink } from '../platform/web.ts';
import { encodeTrack } from '../track/code.ts';
import type { TrackDef } from '../track/track.ts';
import { button, h } from './dom.ts';

/**
 * Copies text to the clipboard. The async Clipboard API can be blocked inside
 * iframes, so it falls back to a temporary textarea + execCommand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Modal with a track's code (selectable), a Copy button and, in the web build
 * only, Copy link. Closes on its button, Escape or a click outside the panel.
 */
export class ShareDialog {
  readonly root: HTMLElement;
  private readonly code: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly linkBtn: HTMLButtonElement;
  private current = '';
  private abort: AbortController | null = null;

  constructor() {
    this.code = h('textarea', { class: 'code-box' });
    this.code.readOnly = true;
    this.code.rows = 4;
    this.code.addEventListener('focus', () => this.code.select());
    this.status = h('div', { class: 'share-status' });
    this.linkBtn = button(STR.buttons.copyLink, () => this.copy(trackLink(this.current)), { icon: '🔗' });
    this.linkBtn.hidden = !CAPS.links;
    const panel = h(
      'div',
      { class: 'panel share' },
      h('h2', { text: STR.share.title }),
      h('p', { class: 'help', text: STR.share.text }),
      this.code,
      this.status,
      h(
        'div',
        { class: 'menu row' },
        button(STR.buttons.copy, () => this.copy(this.current), { icon: '⧉', class: 'primary' }),
        this.linkBtn,
        button(STR.buttons.close, () => this.close(), { icon: '✕' }),
      ),
    );
    this.root = h('div', { class: 'screen overlay share-overlay' }, panel);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.root.hidden = true;
  }

  open(def: TrackDef, host: HTMLElement): void {
    this.current = encodeTrack(def.name, def.control, def.options);
    this.code.value = this.current;
    this.status.textContent = '';
    host.append(this.root);
    this.root.hidden = false;
    this.abort = new AbortController();
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.close();
        }
      },
      { signal: this.abort.signal, capture: true },
    );
  }

  close(): void {
    this.abort?.abort();
    this.abort = null;
    this.root.hidden = true;
    this.root.remove();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  private async copy(text: string): Promise<void> {
    const ok = await copyText(text);
    this.status.textContent = ok ? STR.share.copied : STR.share.copyFailed;
    this.status.className = `share-status ${ok ? 'ok' : 'warn'}`;
    if (!ok) {
      this.code.focus();
      this.code.select();
    }
  }
}
