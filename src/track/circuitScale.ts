import { dist, type Dot } from '../core/math.ts';
import { sampleClosedCatmullRom } from './spline.ts';

/** Metres. Source: bacinger/f1-circuits (MIT), file SHA f9cc33f0e461ebc1a3777240bba9f5b2125ca252.
 * Current Barcelona, Singapore, Qatar and Austin lengths use Formula1.com's 2025 circuit pages.
 * These restore physical scale to the existing approximate outlines; they do not add new survey detail. */
export const CIRCUIT_LENGTHS: Readonly<Record<string,number>> = {
  'world-bh-2002':5412,'world-sa-2021':6175,'world-au-1953':5278,'world-jp-1962':5807,
  'world-cn-2004':5451,'world-us-2022':5412,'world-it-1953':4909,'world-mc-1929':3337,
  'world-ca-1978':4361,'world-es-1991':4657,'world-at-1969':4318,'world-gb-1948':5891,
  'world-hu-1986':4381,'world-be-1925':7004,'world-nl-1948':4259,'world-it-1922':5793,
  'world-az-2016':6003,'world-sg-2008':4940,'world-us-2012':5513,'world-mx-1962':4304,
  'world-br-1940':4309,'world-us-2023':6201,'world-qa-2004':5419,'world-ae-2009':5281,
  'world-pt-2008':4653,'world-tr-2005':5338,'world-my-1999':5543,'world-de-1932':4574,
  'world-de-1927':5148,'world-it-1914':5245,
};

function lengthOf(dots:readonly Dot[]):number {
  const dense=sampleClosedCatmullRom(dots,1);let length=0;
  for(let i=0;i<dense.length;i++)length+=dist(dense[i],dense[(i+1)%dense.length]);
  return length;
}

/** Keep half-metre coordinates compatible with share codes and retain bridge elevations. */
export function circuitScale(dots:Dot[],id:string):Dot[] {
  const length=CIRCUIT_LENGTHS[id];if(!length)return dots;
  let scale=length/lengthOf(dots),out=dots;
  for(let i=0;i<3;i++){
    out=dots.map(p=>({...p,x:Math.round(p.x*scale*2)/2,y:Math.round(p.y*scale*2)/2}));
    scale*=length/lengthOf(out);
  }
  return out;
}
