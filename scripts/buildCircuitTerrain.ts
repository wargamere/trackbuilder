/** Offline circuit terrain import. Runtime never contacts an elevation service.
 * Run with --refresh to requery Mapzen/Open Topo Data (one request per circuit).
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { builtInTracks } from '../src/editor/pipeline.ts';
import { resampleClosed } from '../src/track/spline.ts';
import type { Vec2 } from '../src/core/math.ts';
import { buildTrack } from '../src/track/track.ts';
import { WORLD_TRACKS } from '../src/track/data/world.ts';

const cache = 'data/circuits/elevation-samples.json';
const entries = builtInTracks().filter(t => t.group === 'world');
const count = 96, N = 256;
/** Published relative spans: Formula1.com "Highs and lows", 21 October 2016.
 * Constrains DEM vegetation/building noise, particularly on flat street circuits. */
const ranges: Record<string, number> = {
  'world-be-1925':102.2,'world-at-1969':63.5,'world-br-1940':43,'world-mc-1929':42,
  'world-jp-1962':40.4,'world-hu-1986':34.7,'world-us-2012':30.9,'world-es-1991':29.6,
  'world-az-2016':26.8,'world-my-1999':22,'world-bh-2002':16.9,'world-it-1922':12.8,
  'world-gb-1948':11.3,'world-ae-2009':10.7,'world-cn-2004':7.4,'world-sg-2008':5.3,
  'world-ca-1978':5.2,'world-de-1932':4.3,'world-mx-1962':2.8,'world-au-1953':2.6,
};
/** Bank locations registered against the cached geographic outline. Angles from
 * the circuit operators: Zandvoort T3/T14 18 degrees, Jeddah T13 12 degrees.
 * Fractions are specific to the game's existing start line, not F1 turn numbers. */
const bankWindows: Record<string, number[][]> = {
  'world-nl-1948': [[19/96,20/96,22.5/96,24/96,18],[80/96,83/96,88/96,91/96,18]],
  'world-sa-2021': [[36/96,37.5/96,40/96,42/96,12]],
};
interface Samples { id: string; sourceHash: string; fitRms: number; locations: number[][]; elevation: number[] }
const lerpPoint = (a: Vec2[], at: number): Vec2 => {
  const f = ((at % a.length) + a.length) % a.length, i = Math.floor(f), u = f - i;
  return { x: a[i].x * (1 - u) + a[(i + 1) % a.length].x * u, y: a[i].y * (1 - u) + a[(i + 1) % a.length].y * u };
};
let samples: Samples[];
if (fs.existsSync(cache) && !process.argv.includes('--refresh')) samples = JSON.parse(fs.readFileSync(cache, 'utf8')).circuits;
else {
  samples = [];
  for (const entry of entries) {
    const name = entry.def.id.slice(6), file = `data/circuits/${name}.geojson`;
    if (!fs.existsSync(file)) {
      const response = await fetch(`https://raw.githubusercontent.com/bacinger/f1-circuits/master/circuits/${name}.geojson`);
      if (!response.ok) throw Error(`${name}: GeoJSON ${response.status}`);
      fs.writeFileSync(file, await response.text());
    }
    const source = fs.readFileSync(file, 'utf8'), feature = JSON.parse(source).features[0];
    const coords: number[][] = feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates[0] : feature.geometry.coordinates;
    const lat = coords.reduce((s, p) => s + p[1], 0) / coords.length, lon = coords.reduce((s, p) => s + p[0], 0) / coords.length;
    const kx = 111320 * Math.cos(lat * Math.PI / 180);
    const outline = coords.map(p => ({ x: (p[0] - lon) * kx, y: -(p[1] - lat) * 110540 }));
    if (Math.hypot(outline[0].x - outline.at(-1)!.x, outline[0].y - outline.at(-1)!.y) < 1) outline.pop();
    const length = outline.reduce((s, p, i) => s + Math.hypot(p.x - outline[(i + 1) % outline.length].x, p.y - outline[(i + 1) % outline.length].y), 0);
    const gps = resampleClosed(outline, length / N).points;
    const c = buildTrack(entry.def).center;
    const game = Array.from({ length: N }, (_, i) => lerpPoint(c.points, i * c.points.length / N));
    const mean = (p: Vec2[]) => ({ x: p.reduce((s, p) => s + p.x, 0) / p.length, y: p.reduce((s, p) => s + p.y, 0) / p.length });
    const ga = mean(game), gb = mean(gps);
    const a = game.map(p => ({ x: p.x - ga.x, y: p.y - ga.y }));
    const aa = a.reduce((s, p) => s + p.x * p.x + p.y * p.y, 0);
    const fit = (shift: number, direction: number) => {
      let dot = 0, cross = 0, bb = 0;
      for (let i = 0; i < N; i++) {
        const p = lerpPoint(gps, shift + direction * i), x = p.x - gb.x, y = p.y - gb.y;
        dot += a[i].x * x + a[i].y * y; cross += a[i].x * y - a[i].y * x; bb += x * x + y * y;
      }
      return Math.sqrt(Math.max(0, (bb - (dot * dot + cross * cross) / aa) / N));
    };
    let best = { rms: Infinity, shift: 0, direction: 1 };
    for (const direction of [1, -1]) for (let shift = 0; shift < N; shift++) {
      const rms = fit(shift, direction); if (rms < best.rms) best = { rms, shift, direction };
    }
    const coarse = best.shift;
    for (let shift = coarse - 1; shift <= coarse + 1; shift += .02) {
      const rms = fit(shift, best.direction); if (rms < best.rms) best = { ...best, rms, shift };
    }
    if (best.rms > 65) throw Error(`${name}: outline registration error ${best.rms.toFixed(1)} m`);
    const locations = Array.from({ length: count }, (_, i) => {
      const p = lerpPoint(gps, best.shift + best.direction * i * N / count);
      return [Number((lat - p.y / 110540).toFixed(6)), Number((lon + p.x / kx).toFixed(6))];
    });
    const response = await fetch('https://api.opentopodata.org/v1/mapzen?locations=' + locations.map(p => p.join(',')).join('|') + '&interpolation=bilinear');
    const result = await response.json();
    if (!response.ok || result.status !== 'OK' || result.results.length !== count || result.results.some((r: { elevation: unknown }) => typeof r.elevation !== 'number' || !Number.isFinite(r.elevation))) throw Error(`${name}: elevation response ${JSON.stringify(result).slice(0,200)}`);
    samples.push({ id: entry.def.id, sourceHash: createHash('sha256').update(source).digest('hex'), fitRms: Number(best.rms.toFixed(2)), locations, elevation: result.results.map((r: { elevation: number }) => r.elevation) });
    fs.writeFileSync(cache, JSON.stringify({ dataset: 'Mapzen v1.1 via Open Topo Data, bilinear, 96 samples/circuit; terrain estimates, not a road survey', source: 'https://www.opentopodata.org/datasets/mapzen/', fetched: new Date().toISOString().slice(0,10), circuits: samples }, null, 2));
    console.log(entry.def.name, 'fit', best.rms.toFixed(1), 'range', Math.max(...samples.at(-1)!.elevation) - Math.min(...samples.at(-1)!.elevation));
    await new Promise(r => setTimeout(r, 1100));
  }
}
if (samples.length !== entries.length) throw Error('Incomplete terrain cache; refresh it before building');
const profiles: Record<string, { heights: number[]; banks: number[] }> = {};
for (const entry of entries) {
  const source = samples.find(s => s.id === entry.def.id)!;
  // Reject isolated vegetation/building spikes while keeping the broad terrain.
  const raw = source.elevation, median = raw.map((_, i) => [-1,0,1].map(k => raw[(i + k + count) % count]).sort((a,b) => a-b)[1]);
  const smoothed = median.map((v,i) => (median[(i+count-1)%count] + 2*v + median[(i+1)%count])/4);
  const low = Math.min(...smoothed), span = Math.max(...smoothed) - low, c = buildTrack(entry.def).center;
  const bridges = WORLD_TRACKS.find(t => t.id === entry.def.id)?.hs;
  const scale = ranges[entry.def.id] ? ranges[entry.def.id] / Math.max(.1, span) : 1;
  const heights: number[] = [], banks: number[] = [];
  for (const [controlIndex,dot] of entry.def.control.entries()) {
    let near = 0, d = Infinity;
    c.points.forEach((p, i) => { const q = (dot.x-p.x)**2+(dot.y-p.y)**2; if(q<d){d=q;near=i;} });
    const f = near / c.points.length, index = f * count, i = Math.floor(index), u = index - i;
    // Relative datum leaves banked inner edges above the outer flat base.
    const h = (smoothed[i%count]*(1-u)+smoothed[(i+1)%count]*u-low)*scale+4+(bridges?.[controlIndex]??0);
    let bank = 0;
    for (const [from, full, until, end, angle] of bankWindows[entry.def.id] ?? []) {
      const ramp = Math.min(1, Math.max(0, (f-from)/(full-from)), Math.max(0, (end-f)/(end-until)));
      bank = Math.max(bank, angle * ramp);
    }
    heights.push(Math.round(h*2)/2); banks.push(Math.round(bank*Math.sign(c.curvature[near])*2)/2);
  }
  profiles[entry.def.id] = { heights, banks };
}
fs.writeFileSync('src/track/data/worldTerrain.ts', '/** Generated by scripts/buildCircuitTerrain.ts. Mapzen DEM terrain estimates; see data/circuits/elevation-samples.json and THIRD_PARTY_NOTICES.md. */\nexport const WORLD_TERRAIN: Record<string,{heights:number[];banks:number[]}> = {\n'+Object.entries(profiles).map(([id, profile])=>'  '+JSON.stringify(id)+': '+JSON.stringify(profile)+',').join('\n')+'\n};\n');
console.log('Built terrain for', Object.keys(profiles).length, 'circuits');
