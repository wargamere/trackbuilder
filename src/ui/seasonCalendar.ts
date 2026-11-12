import { CALENDAR_TRACKS, calendarOpen, setSeasonCalendar } from '../career/calendar.ts';
import { seasonCalendar, type CareerSave } from '../career/career.ts';
import type { SeasonLength } from '../config/career.ts';
import { button, h } from './dom.ts';

const control = (label: string, act: () => void, disabled = false, short?: string) => {
  const b = button(short ?? label, act, { ...(short ? { title: label } : {}), class: label === 'Save season calendar' ? 'primary' : '' }); b.tabIndex = 0; b.disabled = disabled; return b;
};

/** Unsaved edits stay separate from the active schedule and its race results. */
export class SeasonCalendarEditor {
  private key = '';
  private ids: string[] = [];

  view(save: CareerSave, render: () => void, committed: () => void): HTMLElement {
    const key = `${save.seed}:${save.team}:${save.season}`;
    if (this.key !== key) { this.key = key; this.ids = [...save.calendar]; }
    const changed = this.ids.join('|') !== save.calendar.join('|');
    const root = h('section', { class: 'season-calendar-editor' });
    root.setAttribute('aria-label', `Configure season ${save.season} calendar`);
    if (!calendarOpen(save)) return root;
    const replace = (ids: string[]) => { this.ids = ids; render(); };
    const presets = h('select'); presets.setAttribute('aria-label', 'Calendar preset');
    for (const [value, label] of [['', 'Choose a preset'], ['short', '8-round season'], ['standard', '16-round season'], ['full', '24-round season'], ['all', 'All 30 circuits']]) {
      const option = h('option', { text: label }); option.value = value; option.disabled = value === ''; presets.append(option);
    }
    presets.value = '';
    presets.addEventListener('change', () => { if (presets.value) replace(presets.value === 'all' ? CALENDAR_TRACKS.map(t => t.id) : seasonCalendar(presets.value as SeasonLength, save.season)); });
    root.append(h('div', { class: 'season-calendar-heading' }, h('div', {}, h('h3', { text: `Season ${save.season} · ${this.ids.length} rounds` }), h('p', { class: 'setup-hint', text: 'Choose your circuits and race order. The calendar locks when you start the first practice, qualifying or race session.' })), presets));
    const list = h('ol', { class: 'season-calendar-rounds' });
    this.ids.forEach((id, i) => {
      const track = CALENDAR_TRACKS.find(t => t.id === id)!;
      const move = (by: number) => { const next = [...this.ids]; [next[i], next[i + by]] = [next[i + by], next[i]]; replace(next); };
      list.append(h('li', { 'data-track': id }, h('b', { text: String(i + 1).padStart(2, '0') }), h('span', { class: 'season-calendar-track' }, h('strong', { text: track.name }), h('small', { text: track.place ?? '' })), h('div', { class: 'season-calendar-actions' }, control(`Move ${track.name} earlier`, () => move(-1), i === 0, '↑'), control(`Move ${track.name} later`, () => move(1), i === this.ids.length - 1, '↓'), control(`Remove ${track.name}`, () => replace(this.ids.filter(x => x !== id)), this.ids.length === 1, 'Remove'))));
    });
    const available = CALENDAR_TRACKS.filter(t => !this.ids.includes(t.id));
    const select = h('select'); select.setAttribute('aria-label', 'Circuit to add');
    for (const track of available) { const option = h('option', { text: track.place ? `${track.name} · ${track.place}` : track.name }); option.value = track.id; select.append(option); }
    select.disabled = available.length === 0;
    root.append(list, h('div', { class: 'season-calendar-add' }, select, control('Add circuit', () => { if (select.value) replace([...this.ids, select.value]); }, !available.length)), h('div', { class: 'season-calendar-save' }, h('span', { text: changed ? 'Unsaved calendar changes' : 'Calendar saved. Custom schedules carry into the next preseason.' }), control('Discard calendar changes', () => replace([...save.calendar]), !changed), control('Save season calendar', () => { if (setSeasonCalendar(save, this.ids)) committed(); }, !changed)));
    return root;
  }
}
