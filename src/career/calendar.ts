import { WORLD_TRACKS } from '../track/data/world.ts';
import type { CareerSave } from './career.ts';

/** All 30 real circuits, including those outside the standard 24-round season. */
export const CALENDAR_TRACKS = WORLD_TRACKS.map(({ id, name, place }) => ({ id, name, place }));
const known = new Set(CALENDAR_TRACKS.map(t => t.id));

export function calendarOpen(save: CareerSave): boolean {
  const practice = save.owner?.engineering?.practice;
  return !save.calendarStarted && save.done.length === 0 && save.grid === null && !(practice?.key.startsWith(`${save.season}:`) && practice.laps > 0);
}

/** Commit a complete preseason schedule atomically; invalid edits change nothing. */
export function setSeasonCalendar(save: CareerSave, ids: readonly string[]): boolean {
  if (!calendarOpen(save) || ids.length < 1 || ids.length > CALENDAR_TRACKS.length || new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) return false;
  save.calendar = [...ids]; save.customCalendar = true;
  return true;
}
