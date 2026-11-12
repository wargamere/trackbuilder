import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarOpen, CALENDAR_TRACKS, setSeasonCalendar } from '../src/career/calendar.ts';
import { cleanCareer, lineup, newCareer, nextSeason, recordRound, seasonCalendar, setGrid } from '../src/career/career.ts';
import { takeOwnership } from '../src/career/owner.ts';
import { engineering, advanceToWeekend } from '../src/career/engineering.ts';
const start = () => { const s = newCareer({ name: 'Owner', team: 'kestrel', difficulty: 110, length: 'short', rounds: 'short' }, 123); takeOwnership(s); engineering(s); return s; };
const result = (s: ReturnType<typeof start>) => ({ order: lineup(s).map(e => e.id), dnf: [], fastest: null });

test('preseason schedules support all real circuits and persist their exact order', () => {
  const s = start(), ids = [...CALENDAR_TRACKS].reverse().map(t => t.id);
  assert.equal(ids.length, 30); assert.ok(calendarOpen(s));
  assert.ok(setSeasonCalendar(s, ids));
  assert.deepEqual(cleanCareer(JSON.parse(JSON.stringify(s))), s);
  assert.deepEqual(s.calendar, ids); ids.pop(); assert.equal(s.calendar.length, 30, 'the caller cannot mutate the saved schedule');
  assert.equal(s.difficulty, 110);
});
test('invalid calendars cannot partially change the active schedule', () => {
  const s = start(), before = [...s.calendar];
  for (const ids of [[], ['bad'], [before[0], before[0]], [...CALENDAR_TRACKS.map(t => t.id), before[0]]]) {
    assert.equal(setSeasonCalendar(s, ids), false); assert.deepEqual(s.calendar, before);
  }
  assert.ok(setSeasonCalendar(s, [before[0]]));
});
test('the first session locks the schedule even before a valid practice lap or race result', () => {
  const s = start(); advanceToWeekend(s);
  assert.ok(calendarOpen(s), 'administration before the first session still permits calendar changes');
  s.calendarStarted = true;
  assert.equal(setSeasonCalendar(s, [s.calendar[1]]), false);
  assert.equal(calendarOpen(cleanCareer(JSON.parse(JSON.stringify(s)))!), false);
  const qualified = start(); setGrid(qualified, []); assert.equal(calendarOpen(qualified), false);
});
test('a custom schedule carries into the next preseason and reopens for editing', () => {
  const s = start(), id = CALENDAR_TRACKS.at(-1)!.id;
  assert.ok(setSeasonCalendar(s, [id])); recordRound(s, result(s));
  assert.equal(calendarOpen(s), false); nextSeason(s, s.team);
  assert.equal(s.season, 2); assert.ok(calendarOpen(s)); assert.deepEqual(s.calendar, [id]);
  assert.ok(setSeasonCalendar(s, ['world-it-1922', 'world-au-1953']));
  assert.deepEqual(cleanCareer(JSON.parse(JSON.stringify(s))), s);
});
test('default calendars still rotate by season and malformed saves remove duplicate or unknown circuits', () => {
  const s = start(); while (s.done.length < s.calendar.length) recordRound(s, result(s));
  nextSeason(s, s.team); assert.deepEqual(s.calendar, seasonCalendar('short', 2)); assert.ok(calendarOpen(s));
  const restored = cleanCareer({ ...start(), calendar: ['world-pt-2008', 'bad', 'world-pt-2008', 'world-au-1953'] })!;
  assert.deepEqual(restored.calendar, ['world-pt-2008', 'world-au-1953']);
});
