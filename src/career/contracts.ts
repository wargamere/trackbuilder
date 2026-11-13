import { carRating, type CareerSave } from './career.ts';
import { allDrivers, driverDef, driverFee, teamsFor } from './roster.ts';

export interface ContractTerms { fee: number; salary: number; years: number }
export interface DriverContract { driver: string; seat: 0 | 1; starts: number; ends: number; fee: number; salary: number }
export interface DriverTalk { driver: string; seat: 0 | 1; years: number; status: 'talking' | 'counter' | 'accepted' | 'cancelled'; expires: number; counter: ContractTerms }
export interface DriverContracts { season: number; active: [DriverContract, DriverContract]; next: [DriverContract | null, DriverContract | null]; talks: DriverTalk[]; payroll: string }
const ownTeam = (save: CareerSave) => teamsFor(save).find(t => t.id === save.team)!;
const rounded = (n: number) => Math.round(n / 1000) * 1000;
const termsOnly = ({ fee, salary, years }: ContractTerms): ContractTerms => ({ fee, salary, years });

export function driverContracts(save: CareerSave): DriverContracts {
  if (!save.owner) throw Error('Driver contracts require a team owner');
  return save.contracts ??= { season: save.season, active: ownTeam(save).drivers.map((driver, seat) => ({ driver, seat, starts: save.season, ends: save.season, fee: 0, salary: 0 })) as [DriverContract, DriverContract], next: [null, null], talks: [], payroll: '' };
}

/** Fees are paid now; salaries begin only when the new contract takes effect. */
export function contractQuote(save: CareerSave, driver: string, seat: 0 | 1, years = 1): ContractTerms & { buyout: number } {
  const d = driverDef(driver), renewal = ownTeam(save).drivers.includes(driver), reputation = save.owner?.world?.reputation ?? 15;
  const premium = 1 + Math.max(0, (d?.skill ?? .5) - carRating(save, save.team) - .2) * .8 - Math.min(.12, reputation / 1000);
  const old = save.contracts?.active[seat], remaining = Math.max(0, (old?.ends ?? save.season) - save.season);
  const retainedElsewhere = save.contracts?.next[1 - seat]?.driver === old?.driver;
  const buyout = old && old.driver !== driver && !renewal && !retainedElsewhere ? rounded(remaining * old.salary * save.calendar.length * .5) : 0;
  return { fee: rounded(driverFee(driver) * premium * (renewal ? .45 : 1) * (1 - (years - 1) * .04)) + buyout,
    salary: rounded((45_000 + 135_000 * (d?.skill ?? .5) ** 3) * premium * (renewal ? .92 : 1)), years, buyout };
}

export function openDriverTalk(save: CareerSave, driver: string, seat: 0 | 1, years = 1): boolean {
  if (!save.owner || ![0, 1].includes(seat) || ![1, 2, 3].includes(years) || !allDrivers.some(d => d.id === driver)) return false;
  const c = driverContracts(save);
  if (c.next.some(d => d?.driver === driver) || c.talks.some(t => t.driver === driver && t.seat === seat && t.years === years && t.status !== 'cancelled' && t.expires >= save.done.length)) return false;
  c.talks = c.talks.filter(t => t.driver !== driver || t.seat !== seat);
  c.talks.unshift({ driver, seat, years, status: 'talking', expires: Math.min(save.calendar.length, save.done.length + 3), counter: termsOnly(contractQuote(save, driver, seat, years)) });
  c.talks = c.talks.slice(0, 8); return true;
}

export function offerDriverContract(save: CareerSave, driver: string, seat: 0 | 1, terms: ContractTerms): 'accepted' | 'counter' | 'unavailable' | 'invalid' | 'funds' {
  if (!save.owner || ![0, 1].includes(seat) || ![1, 2, 3].includes(terms.years) || ![terms.fee, terms.salary].every(n => Number.isFinite(n) && n >= 0 && n <= 100_000_000)) return 'invalid';
  const c = driverContracts(save), talk = c.talks.find(t => t.driver === driver && t.seat === seat);
  if (!talk || talk.expires < save.done.length || talk.status === 'accepted' || talk.status === 'cancelled' || c.next[seat] || c.next.some(d => d?.driver === driver)) return 'unavailable';
  const ask = contractQuote(save, driver, seat, terms.years); talk.years = terms.years; talk.counter = termsOnly(ask);
  if (terms.fee < ask.fee || terms.salary < ask.salary) { talk.status = 'counter'; return 'counter'; }
  if (save.owner.cash < terms.fee + terms.salary * 2) return 'funds';
  save.owner.cash -= terms.fee; save.owner.spent += terms.fee;
  save.owner.ledger ??= []; save.owner.ledger.unshift({ label: `${driverDef(driver)!.name} · season ${save.season + 1} signing`, amount: -terms.fee, season: save.season, round: save.done.length }); save.owner.ledger = save.owner.ledger.slice(0, 20);
  c.next[seat] = { driver, seat, starts: save.season + 1, ends: save.season + terms.years, fee: terms.fee, salary: terms.salary };
  talk.status = 'accepted'; return 'accepted';
}

export function cancelFutureContract(save: CareerSave, seat: 0 | 1): boolean {
  if (!save.owner || ![0, 1].includes(seat) || !save.contracts?.next[seat]) return false;
  const c = save.contracts, driver = c.next[seat]!.driver; c.next[seat] = null;
  for (const t of c.talks) if (t.driver === driver && t.seat === seat) t.status = 'cancelled';
  return true;
}

export function projectedDrivers(save: CareerSave): [string, string] {
  const old = ownTeam(save).drivers, c = save.contracts;
  const ids: [string, string] = [c?.next[0]?.driver ?? old[0], c?.next[1]?.driver ?? old[1]];
  if (ids[0] === ids[1]) { const seat = c?.next[0] ? 1 : 0; ids[seat] = old[1 - seat]; }
  return ids;
}

/** Apply deals only after the scored season has been archived. */
export function activateDriverContracts(save: CareerSave): void {
  if (!save.owner) return;
  const c = driverContracts(save), old = ownTeam(save), selectedSeat = old.drivers.indexOf(save.owner.selected);
  if (c.season === save.season) return;
  const active = ([0, 1] as const).map(seat => {
    const future = c.next[seat]; if (future?.starts === save.season) return future;
    const previous = c.active[seat]; if (previous.ends >= save.season) return previous;
    return { driver: old.drivers[seat], seat, starts: save.season, ends: save.season, fee: 0, salary: rounded(contractQuote(save, old.drivers[seat], seat).salary * 1.15) };
  }) as [DriverContract, DriverContract];
  if (active[0].driver === active[1].driver) {
    const seat: 0 | 1 = c.next[0] ? 1 : 0, driver = old.drivers[1 - seat];
    const previous = c.active.find(d => d.driver === driver)!;
    active[seat] = previous.ends >= save.season ? { ...previous, seat } : { driver, seat, starts: save.season, ends: save.season, fee: 0, salary: contractQuote(save, driver, seat).salary };
  }
  if (save.entry || active.some((d, seat) => d.driver !== old.drivers[seat])) save.entry = { id: old.id, name: old.name, paint: old.paint, secondary: old.secondary ?? 0xffffff, drivers: [active[0].driver, active[1].driver] };
  save.owner.selected = active[selectedSeat < 0 ? 1 : selectedSeat].driver;
  c.season = save.season; c.active = active; c.next = [null, null]; c.talks = []; c.payroll = '';
}

export function settleDriverPayroll(save: CareerSave): void {
  if (!save.owner || !save.contracts) return;
  const c = save.contracts, key = `${save.season}:${save.done.length}`;
  if (c.payroll === key) return; c.payroll = key;
  const amount = Math.min(save.owner.cash, c.active.reduce((sum, d) => sum + d.salary, 0)); if (!amount) return;
  save.owner.cash -= amount; save.owner.spent += amount;
  save.owner.ledger ??= []; save.owner.ledger.unshift({ label: 'Driver contract salaries', amount: -amount, season: save.season, round: save.done.length }); save.owner.ledger = save.owner.ledger.slice(0, 20);
}

export function cleanDriverContracts(raw: unknown, save: CareerSave): DriverContracts | undefined {
  if (!raw || typeof raw !== 'object' || !save.owner) return undefined;
  const r = raw as Record<string, unknown>, valid = new Set(allDrivers.map(d => d.id));
  const number = (x: unknown, max: number) => typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(max, x)) : 0;
  const read = (x: unknown, seat: 0 | 1): DriverContract | null => {
    if (!x || typeof x !== 'object') return null; const d = x as Record<string, unknown>;
    if (typeof d.driver !== 'string' || !valid.has(d.driver) || !Number.isInteger(d.starts) || !Number.isInteger(d.ends)) return null;
    const starts = Math.max(1, Math.min(save.season + 1, d.starts as number)), ends = Math.max(starts, Math.min(save.season + 3, d.ends as number));
    return { driver: d.driver, seat, starts, ends, fee: number(d.fee, 1e8), salary: number(d.salary, 1e8) };
  };
  if (!Array.isArray(r.active) || r.active.length !== 2) return undefined;
  const active = [read(r.active[0], 0), read(r.active[1], 1)];
  if (active.some((d, i) => !d || d.driver !== ownTeam(save).drivers[i])) return undefined;
  const next: [DriverContract | null, DriverContract | null] = Array.isArray(r.next) ? [read(r.next[0], 0), read(r.next[1], 1)] : [null, null];
  for (const seat of [0, 1] as const) if (next[seat]?.starts !== save.season + 1) next[seat] = null;
  if (next[0]?.driver === next[1]?.driver) next[1] = null;
  const out: DriverContracts = { season: save.season, active: active as [DriverContract, DriverContract], next, talks: [], payroll: typeof r.payroll === 'string' ? r.payroll.slice(0, 40) : '' };
  for (const x of Array.isArray(r.talks) ? r.talks.slice(0, 8) : []) {
    if (!x || typeof x !== 'object' || !valid.has(x.driver) || ![0, 1].includes(x.seat) || ![1, 2, 3].includes(x.years) || !['talking', 'counter', 'accepted', 'cancelled'].includes(x.status)) continue;
    if (out.talks.some(t => t.driver === x.driver && t.seat === x.seat)) continue;
    out.talks.push({ driver: x.driver, seat: x.seat, years: x.years, status: x.status, expires: Math.floor(number(x.expires, 30)), counter: { fee: number(x.counter?.fee, 1e8), salary: number(x.counter?.salary, 1e8), years: x.years } });
  }
  return out;
}
