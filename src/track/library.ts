import { loadJSON, saveJSON } from '../platform/storage.ts';
import { decodeTrack, encodeTrack } from './code.ts';
import { contentId, type TrackDef } from './track.ts';

interface SavedTrack {
  code: string;
  savedAt: number;
}

export interface LibraryEntry {
  def: TrackDef;
  code: string;
  savedAt: number;
}

const KEY = 'library';
const MAX_TRACKS = 60;

/**
 * "My tracks": every track you race is saved here automatically (built-in
 * samples aren't). Stored as track codes, newest first.
 */
export class TrackLibrary {
  private items: SavedTrack[] = loadJSON<SavedTrack[]>(KEY, []).filter((t) => typeof t?.code === 'string');

  list(): LibraryEntry[] {
    const out: LibraryEntry[] = [];
    for (const t of this.items) {
      const d = decodeTrack(t.code);
      if (!d.ok) continue;
      out.push({ def: { id: contentId(d.dots, d.options), name: d.name, control: d.dots, options: d.options }, code: t.code, savedAt: t.savedAt });
    }
    return out;
  }

  /** Saves (or refreshes) a track; the same shape is only kept once. */
  save(def: TrackDef): void {
    if (def.builtIn) return;
    const code = encodeTrack(def.name, def.control, def.options);
    const id = contentId(def.control, def.options);
    this.items = this.items.filter((t) => {
      const d = decodeTrack(t.code);
      return !d.ok || contentId(d.dots, d.options) !== id;
    });
    this.items.unshift({ code, savedAt: Date.now() });
    if (this.items.length > MAX_TRACKS) this.items.length = MAX_TRACKS;
    saveJSON(KEY, this.items);
  }

  remove(id: string): void {
    this.items = this.items.filter((t) => {
      const d = decodeTrack(t.code);
      return d.ok && contentId(d.dots, d.options) !== id;
    });
    saveJSON(KEY, this.items);
  }
}
