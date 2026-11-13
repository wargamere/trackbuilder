import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--mode','web','--host','127.0.0.1','--port','5270','--strictPort'],{stdio:'ignore'});
const label=process.argv[2]||'current', seconds=Number(process.env.WET_RACE_SECONDS||25), rate=Number(process.env.WET_RACE_CPU||1);
assert.match(label,/^[a-z0-9-]+$/i);assert.ok(seconds>0 && seconds<=60 && rate>=1 && rate<=8);
let browser;
try {
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:5270')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:Number(process.env.RACE_PERF_DPR||1)});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5270/?autopilot');await page.waitForFunction(()=>window.__game);
  await page.evaluate(async()=>{
    const g=window.__game;
    g.setTrack((await import('/src/editor/pipeline.ts')).builtInTracks().find(t=>t.def.id==='world-us-2023').track());
    const r=g.screens.race, v=g.view3d, frames=[];window.rainFrames=frames;
    const frame=g.frame.bind(g), render=v.render.bind(v);let rendered=0;
    v.render=()=>{const t=performance.now();render();rendered+=performance.now()-t;};
    g.frame=(dt,t)=>{const start=performance.now(),tick=r.fixed.tick;rendered=0;frame(dt,t);frames.push({dt,cpu:performance.now()-start,render:rendered,ticks:r.fixed.tick-tick,s:r.car?.state.s,calls:v.stats().calls,triangles:v.stats().triangles});};
    g.start({mode:'race',opponents:23,difficulty:100,grid:'pick',startSlot:24,ghost:false,weather:'rain',time:'night',laps:10,damage:true});
  });
  const client=await page.context().newCDPSession(page);await client.send('Emulation.setCPUThrottlingRate',{rate});await client.send('Profiler.enable');await client.send('Profiler.start');
  await page.waitForTimeout(seconds*1000);
  const {profile}=await client.send('Profiler.stop');
  const result=await page.evaluate(()=>{
    const a=window.rainFrames,steady=a.slice(10),stats=x=>{const s=[...x].sort((a,b)=>a-b);return{mean:s.reduce((a,b)=>a+b,0)/s.length,p95:s[Math.floor(s.length*.95)],max:s.at(-1)};};
    const gl=window.__game.view3d.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {count:a.length,frame:stats(steady.map(f=>f.dt*1000)),cpu:stats(steady.map(f=>f.cpu)),render:stats(steady.map(f=>f.render)),ticks:stats(steady.map(f=>f.ticks)),worst:steady.toSorted((a,b)=>b.cpu-a.cpu).slice(0,8),gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,pixels:[gl.drawingBufferWidth,gl.drawingBufferHeight],trace:a};
  });
  const checks=await page.evaluate(()=>{
    const v=window.__game.view3d, initial=Object.fromEntries(Object.entries(v.mats).map(([k,m])=>[k,m.version]));
    v.setConditions({time:'night',rain:.45,wet:.6});v.render();
    v.setConditions({time:'night',rain:.8,wet:.4});v.render();
    const changingWeatherKeepsShaders=Object.entries(v.mats).every(([k,m])=>m.version===initial[k]);
    const roadVersion=v.mats.road.version;v.setConditions({time:'day',rain:.8,wet:.4});v.render();
    const nightToDayUpdatesShader=v.mats.road.version===roadVersion+1;
    v.setConditions({time:'night',rain:1,wet:1});v.render();
    const wheels=window.__game.screens.race.opponents.map(o=>o.model.wheels);
    const props=wheels.map(w=>v.renderer.properties.get(w.material)).filter(p=>p.programs);
    return {changingWeatherKeepsShaders,nightToDayUpdatesShader,oneWheelShader:props.length>0&&props.every(p=>p.programs.size===1),wheelCulling:wheels.every(w=>w.frustumCulled&&w.boundingSphere)};
  });
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:`test-results/wet-race-${label}.png`});
  await writeFile(`test-results/wet-race-${label}.json`,JSON.stringify({...result,rate,seconds,checks,errors},null,2));await writeFile(`test-results/wet-race-${label}.cpuprofile`,JSON.stringify(profile));
  const nodes=new Map(profile.nodes.map(n=>[n.id,n])),hits=new Map();for(let i=0;i<profile.samples.length;i++){const n=nodes.get(profile.samples[i]);const key=n.callFrame.functionName+' '+n.callFrame.url.split('/').at(-1);hits.set(key,(hits.get(key)||0)+profile.timeDeltas[i]);}
  delete result.trace;console.log(JSON.stringify({...result,rate,seconds,checks,errors,top:[...hits].sort((a,b)=>b[1]-a[1]).slice(0,22)},null,2));
  assert.deepEqual(errors,[],'wet-night race has no runtime errors');
  for(const [name,ok]of Object.entries(checks))assert.ok(ok,name);
}finally{await browser?.close();server.kill();}
