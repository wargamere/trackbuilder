import { seasonReport, type CareerSave } from '../career/career.ts';
import { money } from '../career/owner.ts';
import { CALENDAR_TRACKS } from '../career/calendar.ts';
import { dynasty } from '../career/dynasty.ts';
import { h } from './dom.ts';
import { recruitmentView } from './teamManagement.ts';

const negotiating = new WeakMap<CareerSave, boolean>();
const label = (text: string) => h('div', { class: 'owner-label', text });
const stat = (name: string, text: string) => h('div', { class: 'owner-stat' }, label(name), h('strong', { text }));

export function seasonReviewView(save: CareerSave, changed: () => void): HTMLElement {
  const r = seasonReport(save), w = dynasty(save), previous = save.history.at(-1), met = r.teamPosition <= r.target;
  const title = r.teamPosition === 1 ? 'Champions. Built by you.' : previous && r.teamPosition < previous.teamPosition ? 'Your team is moving forward.' : met ? 'A season to build on.' : 'The next chapter starts here.';
  const hero = h('section', { class: `season-review-hero${r.teamPosition === 1 ? ' champion' : ''}` }, label(`SEASON ${save.season} COMPLETE`), h('h1', { text: title }), h('p', { text: `${r.teamName} finished P${r.teamPosition} with ${r.teamPoints} points. ${r.teamWins} wins. ${r.teamPodiums} podiums.` }),
    h('div', { class: 'season-review-stats' }, stat('CONSTRUCTORS', `P${r.teamPosition}`), stat('TEAM POINTS', String(r.teamPoints)), stat('CHAMPIONSHIP PRIZE', `+${money(r.prize)}`), stat('CAR PERFORMANCE', `${r.endIndex} PI`)));
  const drivers = h('div', { class: 'season-review-drivers' });
  for (const d of r.drivers) drivers.append(h('article', {}, label(`DRIVERS’ CHAMPIONSHIP · P${d.position}`), h('h2', { text: d.name }), h('p', { text: `${d.points} points · ${d.wins} wins · ${d.podiums} podiums` }), d.position === 1 ? h('strong', { class: 'season-review-award', text: 'Drivers’ World Champion' }) : null));
  const gain = r.endIndex - r.startIndex, track = CALENDAR_TRACKS.find(t => t.id === r.bestTrack)?.name ?? r.bestTrack;
  const progress = h('section', { class: 'season-review-progress' }, h('h2', { text: 'What your season achieved' }), h('div', { class: 'season-review-stats' }, stat(r.baselineRound >= save.calendar.length ? 'RECORDED CAR INDEX' : r.baselineRound ? `CAR GAIN SINCE ROUND ${r.baselineRound + 1}` : 'SEASON CAR GAIN', r.baselineRound >= save.calendar.length ? `${r.endIndex} PI` : `${gain >= 0 ? '+' : ''}${gain} PI`), stat('DESIGNS RESEARCHED', `${r.research} / 16`), stat('UPGRADES FITTED', String(r.fitted)), stat('BEST WEEKEND', `${track} · ${r.bestPoints} pts`)),
    h('p', { class: 'season-review-objective', text: met ? `Board target achieved: P${r.teamPosition} against a P${r.target} objective. Your board bonus is already in the ledger.` : `Board target: P${r.target}. You finished P${r.teamPosition}; your team, facilities and earned progress continue.` }),
    h('p', { text: `Champions this year: ${r.champion} and ${r.championTeam}. Your team rivalry ended ${w.rival.won}–${w.rival.lost}.` }));
  const carry = h('section', { class: 'season-review-carry' }, label('NEXT SEASON'), h('h2', { text: 'A fresh programme. An established foundation.' }),
    h('p', { text: 'Retained fitted upgrades become the foundation of next season’s cars. The 16-design research tree and seasonal spending cap reset, so you start with minor upgrades again. Unadapted regulation-affected parts are excluded.' }),
    h('p', { class: 'owner-muted', text: 'Cash, resource points, facilities, staff and driver development carry forward. Unfinished manufacturing returns its remaining cost, unused research work returns RP, and unfitted stock is recycled for 50% of its standard price. New salaries start with next season.' }));
  const contracts = h('details', { class: 'season-review-contracts' }, h('summary', { text: `Review driver agreements for season ${save.season + 1}` }));
  contracts.open = negotiating.get(save) ?? false; contracts.addEventListener('toggle', () => negotiating.set(save, contracts.open));
  contracts.append(recruitmentView(save, changed));
  return h('div', { class: 'career-body season-review-body' }, hero, drivers, progress, carry, contracts);
}
