import type { Track } from '../track/track.ts';

const NS = 'http://www.w3.org/2000/svg';

/** A vector circuit map from the actual racing centre line. No downloaded assets. */
export function circuitMap(track: Track): SVGSVGElement {
  const points = track.center.points.filter((_, i) => i % 4 === 0);
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(240 / Math.max(1, maxX - minX), 150 / Math.max(1, maxY - minY));
  const ox = 150 - (minX + maxX) / 2 * scale, oy = 100 - (minY + maxY) / 2 * scale;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 200');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${track.def.name} circuit layout`);
  svg.classList.add('owner-circuit-map');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', points.map((p, i) => `${i ? 'L' : 'M'}${(p.x * scale + ox).toFixed(1)},${(p.y * scale + oy).toFixed(1)}`).join(' ') + 'Z');
  const road = path.cloneNode() as SVGPathElement;
  road.classList.add('circuit-road');
  path.classList.add('circuit-line');
  const start = document.createElementNS(NS, 'circle');
  start.setAttribute('cx', String(points[0].x * scale + ox));
  start.setAttribute('cy', String(points[0].y * scale + oy));
  start.setAttribute('r', '5');
  start.classList.add('circuit-start');
  svg.append(road, path, start);
  return svg;
}
