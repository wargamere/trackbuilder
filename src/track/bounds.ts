import { WORLD } from '../config/track.ts';
import type { Vec2 } from '../core/math.ts';

export interface PaperSize { width:number; height:number }
export interface Bounds { x0:number; x1:number; z0:number; z1:number }
export function pointBounds(points:readonly Vec2[],margin=0):Bounds {
  let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
  for(const p of points){x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);z0=Math.min(z0,p.y);z1=Math.max(z1,p.y);}
  return {x0:x0-margin,x1:x1+margin,z0:z0-margin,z1:z1+margin};
}
/** The normal drawing paper, expanded only when a loaded circuit needs it. */
export function paperFor(points:readonly Vec2[]):PaperSize {
  if(!points.length)return {width:WORLD.width,height:WORLD.height};
  const b=pointBounds(points,20);
  return {width:Math.max(WORLD.width,2*Math.max(Math.abs(b.x0),Math.abs(b.x1))),height:Math.max(WORLD.height,2*Math.max(Math.abs(b.z0),Math.abs(b.z1)))};
}
