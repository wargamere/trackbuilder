import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRIVER } from '../src/config/race.ts';
import { FixedStep } from '../src/core/fixedStep.ts';
import { builtInTracks } from '../src/editor/pipeline.ts';
import { aiPace, AiDriver } from '../src/race/ai.ts';
import { RacingDriver } from '../src/race/driver.ts';
import { brakingDecel, cornerSpeed } from '../src/race/racingLine.ts';
import { RainEffect } from '../src/render/rain.ts';
import { DynamicDrawUsage, Vector3, type BufferAttribute } from 'three';
import { TrafficPlanner } from '../src/race/traffic.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';

test('full-grid planning keeps the first reaction immediate and spreads later decisions at the existing cadence', t => {
  const track=getSampleTrack(0), counts=Array(40).fill(0), calls:number[][]=Array.from({length:24},()=>[]), slots=new WeakMap();let tick=0;
  t.mock.method(TrafficPlanner.prototype,'plan',function(this:TrafficPlanner){counts[tick]++;calls[slots.get(this)].push(tick);return{offset:0};});
  const drivers=Array.from({length:24},(_,slot)=>new AiDriver(track,{name:String(slot),paint:0,difficulty:1,laps:2,slot}));
  drivers.forEach((d,slot)=>{d.session.phase='racing';slots.set(Reflect.get(d,'planner'),slot);});
  const states=drivers.map(d=>d.car.state);
  for(;tick<counts.length;tick++)for(const d of drivers)d.drive(states,d.car.dt);
  assert.equal(counts[0],24,'every car makes its original first decision at the start');
  assert.ok(Math.max(...counts.slice(1))<=5,`later planning is spread across the grid: ${counts}`);
  for(const times of calls){assert.equal(times[0],0);assert.ok(times.length>=7);for(let i=2;i<times.length;i++)assert.equal(times[i]-times[i-1],5);}
});

test('rain streams its animated buffer and changing intensity does not reset its velocity history', () => {
  const rain=new RainEffect(), cam=new Vector3();rain.show(true);rain.configure('full',true);
  rain.update(cam,.1);cam.x=2;rain.update(cam,.1);
  const before=Reflect.get(rain,'vel').x;
  assert.ok(before>0);rain.configure('full',true,.7);rain.show(true);
  assert.ok(Reflect.get(rain,'last').ok);
  cam.x=4;rain.update(cam,.1);assert.ok(Reflect.get(rain,'vel').x>before);
  assert.equal((rain.mesh.geometry.getAttribute('position') as BufferAttribute).usage,DynamicDrawUsage);
  rain.show(false);assert.equal(Reflect.get(rain,'last').ok,false);rain.dispose();
});

test('expensive catch-up ticks yield without leaving a backlog or skipping shared simulation ticks', t => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const fixed = new FixedStep(120); let simulated = 0;
  const alpha = fixed.advance(.1, () => { simulated++; clock += 7; }, 12, 8);
  assert.equal(simulated, 2, 'runs the normal two ticks, then yields instead of doing twelve');
  assert.equal(fixed.tick, 2);
  assert.ok(alpha >= 0 && alpha <= 1);
  fixed.advance(1 / 60, () => { simulated++; }, 12, 8);
  assert.equal(simulated, 4, 'the next frame has no old catch-up burst');
  assert.equal(fixed.tick, 4);
});

test('a slow normal frame still runs both physics ticks; cheap variable-rate frames keep identical ticks', t => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const slow = new FixedStep(120);
  for (let i = 0; i < 60; i++) slow.advance(1 / 60, () => { clock += 10; }, 12, 8);
  assert.equal(slow.tick, 120, 'the budget never cuts a normal 60 Hz frame in half');
  const budgeted = new FixedStep(120), normal = new FixedStep(120);
  for (const dt of [1/144, 1/60, 1/30, .05, 1/240, .01]) {
    const a = budgeted.advance(dt, () => { clock += .2; }, 12, 8);
    const b = normal.advance(dt, () => {}, 12);
    assert.equal(budgeted.tick, normal.tick); assert.equal(a, b);
  }
});

test('rolling path windows keep exact speed limits while sampling less geometry in wheel-to-wheel routes', () => {
  for (const id of ['world-us-2023', 'world-au-1953']) {
    const track = builtInTracks().find(t => t.def.id === id)!.track();
    const driver = new RacingDriver(track, aiPace(1, track)), c = track.center;
    const sample = (arr: Float32Array, s: number) => {
      const n=arr.length, f=(((s/c.spacing)%n)+n)%n, i=Math.floor(f), u=f-i;
      return arr[i]*(1-u)+arr[(i+1)%n]*u;
    };
    for (const start of [-.1, 50.123, c.length-.01]) for (const onRoad of [true, false]) {
      const path=(s:number) => driver.lateralAt(s) + Math.sin((s-start)/40)*3;
      const worldAt=Reflect.get(driver,'worldAt'); let samples=0;
      Reflect.set(driver,'worldAt',function(this:RacingDriver,...args:unknown[]){samples++;return worldAt.apply(this,args);});
      try {
        let expected=Infinity;
        for(let d=0;d<=DRIVER.pathLook;d+=DRIVER.pathStep){
          const s=start+d, k=driver.pathCurvature(s,path,onRoad,true);
          const vc=Math.min(driver.pace.maxSpeed,cornerSpeed(k,sample(c.bank,s),driver.pace.grip*DRIVER.offLineGrip,driver.pace.downforce));
          expected=Math.min(expected,Math.sqrt(vc*vc+2*brakingDecel(driver.pace.brake,vc,sample(c.grade,s),driver.pace.drag)*d));
        }
        const referenceSamples=samples; samples=0;
        assert.equal(driver.pathLimit(start,path,onRoad),expected);
        assert.ok(samples < referenceSamples*.7, `${samples} vs ${referenceSamples} world samples`);
      } finally { Reflect.set(driver,'worldAt',worldAt); }
    }
  }
});
