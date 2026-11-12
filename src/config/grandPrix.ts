import type { DriverDef, TeamDef } from './career.ts';

/** An unofficial, fictionalised modern GP grid. No licensed names, logos or artwork. */
export const GP_TEAMS: readonly TeamDef[] = [
  { id: 'gp-mersedes', name: 'Mersedes GP', paint: 0x29c8b8, secondary: 0xc7d1d9, car: 1, drivers: ['gp-roussel', 'gp-antonel'] },
  { id: 'gp-fiorano', name: 'Fiorano Racing', paint: 0xe42e3c, secondary: 0xf6d431, car: .95, drivers: ['gp-leclaire', 'gp-hamilford'] },
  { id: 'gp-redbison', name: 'Red Bison Racing', paint: 0x233f90, secondary: 0xf4c52c, car: .92, drivers: ['gp-verstallen', 'gp-hadjar'] },
  { id: 'gp-mclaren', name: 'McLarren Motorsport', paint: 0xf58b27, secondary: 0x202631, car: .9, drivers: ['gp-norrin', 'gp-piastra'] },
  { id: 'gp-bisons', name: 'Racing Bisons', paint: 0x4076e8, secondary: 0xf4f6ff, car: .68, drivers: ['gp-lawsley', 'gp-lindberg'] },
  { id: 'gp-alpine', name: 'Alpinevale Racing', paint: 0x2c8dd6, secondary: 0xea78ad, car: .62, drivers: ['gp-gasley', 'gp-colapino'] },
  { id: 'gp-haas', name: 'Haaswell Racing', paint: 0xe8e9ed, secondary: 0xc62b35, car: .55, drivers: ['gp-behrman', 'gp-camarro'] },
  { id: 'gp-audion', name: 'Audion Sport', paint: 0xc1c5c8, secondary: 0xec4637, car: .48, drivers: ['gp-hulkenber', 'gp-bortello'] },
  { id: 'gp-willford', name: 'Willford Racing', paint: 0x2257cc, secondary: 0xf7f9fa, car: .42, drivers: ['gp-sainzo', 'gp-alborne'] },
  { id: 'gp-astor', name: 'Astor Martin Racing', paint: 0x1d7765, secondary: 0xc9d849, car: .35, drivers: ['gp-alonzo', 'gp-strode'] },
  { id: 'gp-cadence', name: 'Cadence Racing', paint: 0xe0e0d9, secondary: 0x242936, car: .26, drivers: ['gp-peres', 'gp-bottan'] },
];

/** Ratings and fees are game balancing values, not real driver assessments or salaries. */
export const GP_DRIVERS: readonly DriverDef[] = [
  { id: 'gp-roussel', first: 'Georg', name: 'Roussel', code: 'ROU', skill: .95 },
  { id: 'gp-antonel', first: 'Kimo', name: 'Antonel', code: 'ANT', skill: .86 },
  { id: 'gp-leclaire', first: 'Charl', name: 'Leclaire', code: 'LEC', skill: .94 },
  { id: 'gp-hamilford', first: 'Lewin', name: 'Hamilford', code: 'HAM', skill: .91 },
  { id: 'gp-verstallen', first: 'Maxim', name: 'Verstallen', code: 'VER', skill: 1 },
  { id: 'gp-hadjar', first: 'Isak', name: 'Hadjard', code: 'HAD', skill: .8 },
  { id: 'gp-norrin', first: 'Landon', name: 'Norrin', code: 'NOR', skill: .9 },
  { id: 'gp-piastra', first: 'Oskar', name: 'Piastra', code: 'PIA', skill: .94 },
  { id: 'gp-lawsley', first: 'Leon', name: 'Lawsley', code: 'LAW', skill: .75 },
  { id: 'gp-lindberg', first: 'Arven', name: 'Lindberg', code: 'LIN', skill: .66 },
  { id: 'gp-gasley', first: 'Pier', name: 'Gasley', code: 'GAS', skill: .85 },
  { id: 'gp-colapino', first: 'Frans', name: 'Colapino', code: 'COL', skill: .72 },
  { id: 'gp-behrman', first: 'Ollie', name: 'Behrman', code: 'BEH', skill: .79 },
  { id: 'gp-camarro', first: 'Rafa', name: 'Camarro', code: 'CAM', skill: .65 },
  { id: 'gp-hulkenber', first: 'Niko', name: 'Hulkenber', code: 'HUL', skill: .84 },
  { id: 'gp-bortello', first: 'Gabrio', name: 'Bortello', code: 'BOR', skill: .74 },
  { id: 'gp-sainzo', first: 'Carlo', name: 'Sainzo', code: 'SAI', skill: .9 },
  { id: 'gp-alborne', first: 'Alec', name: 'Alborne', code: 'ALB', skill: .85 },
  { id: 'gp-alonzo', first: 'Ferran', name: 'Alonzo', code: 'ALO', skill: .92 },
  { id: 'gp-strode', first: 'Lars', name: 'Strode', code: 'STR', skill: .67 },
  { id: 'gp-peres', first: 'Serge', name: 'Peres', code: 'PER', skill: .83 },
  { id: 'gp-bottan', first: 'Valter', name: 'Bottan', code: 'BOT', skill: .84 },
];

export const RESERVE_DRIVERS: readonly DriverDef[] = [
  { id: 'reserve-reed', first: 'Jamie', name: 'Reed', code: 'REE', skill: .58 },
  { id: 'reserve-sato', first: 'Haru', name: 'Sato', code: 'SAT', skill: .55 },
  { id: 'reserve-costa', first: 'Enzo', name: 'Costa', code: 'COS', skill: .52 },
  { id: 'reserve-novak', first: 'Milan', name: 'Novak', code: 'NOV', skill: .5 },
];
