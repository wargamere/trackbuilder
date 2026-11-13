import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carPerformance, carRating, cleanCareer, ensureSeasonStart, lineup, newCareer, nextSeason, performanceIndex, recordRound, roundWeather, seasonReport, setGrid, settleSeasonAwards, team } from '../src/career/career.ts';
import { takeOwnership } from '../src/career/owner.ts';
import { activateDriverContracts, cancelFutureContract, contractQuote, driverContracts, offerDriverContract, openDriverTalk, settleDriverPayroll } from '../src/career/contracts.ts';
import { advanceToWeekend, assignUpgrade, carDevelopment, engineering, manufacture, researchBlock, startResearch } from '../src/career/engineering.ts';
import { createCustomCareer } from '../src/career/teamManagement.ts';

const start = (seed=42) => { const s=newCareer({name:'Owner',team:'kestrel',difficulty:100,length:'short',rounds:'short'},seed);takeOwnership(s);engineering(s);driverContracts(s);ensureSeasonStart(s);return s; };
const race = (s:ReturnType<typeof start>) => { const ids=team(s.team,s).drivers;return recordRound(s,{order:[...ids,...lineup(s).map(d=>d.id)],dnf:[],fastest:ids[0]}); };
const finish = (s:ReturnType<typeof start>) => { while(s.done.length<s.calendar.length)race(s); };
const minor = (s:ReturnType<typeof start>,id='aero-1') => {const e=engineering(s);e.researched.push(id);e.designs[id]=1;e.stock[id]=2;assert.ok(assignUpgrade(s,id,0));assert.ok(assignUpgrade(s,id,1));};

test('season weather is deterministic, mostly dry, circuit-weighted and cannot form long rain runs',()=>{
  let wet=0,total=0,desertWet=0,desertTotal=0;
  for(let seed=0;seed<250;seed++){
    const s=newCareer({name:'Weather',team:'kestrel',difficulty:100,length:'short',rounds:'full'},seed*7919), plan=s.calendar.map((_,i)=>roundWeather(s,i));
    assert.deepEqual(cleanCareer(JSON.parse(JSON.stringify(s)))!.calendar.map((_,i)=>roundWeather(s,i)),plan);
    assert.ok(plan.filter(w=>w!=='dry').length<=6);
    for(let i=2;i<plan.length;i++)assert.ok(plan.slice(i-2,i+1).includes('dry'));
    plan.forEach((w,i)=>{total++;if(w!=='dry')wet++;if(['world-us-2023','world-qa-2004','world-ae-2009'].includes(s.calendar[i])){desertTotal++;if(w!=='dry')desertWet++;}});
  }
  assert.ok(wet/total>.05 && wet/total<.2,`${wet/total} wet weekends`);
  assert.ok(desertWet/desertTotal<.04,`${desertWet/desertTotal} late desert weekends wet`);
});

test('new seasons archive fitted performance into car foundations and reopen minor upgrades',()=>{
  const s=start(),e=engineering(s),initial=performanceIndex(s,s.team);minor(s);
  e.regulation={season:2,area:'durability',adapted:[]};finish(s);
  const previous=carDevelopment(s,'alm'),index=performanceIndex(s,s.team),hardware=carPerformance(s,'alm');
  assert.ok(index>initial);nextSeason(s,s.team);
  assert.deepEqual(carDevelopment(s,'alm'),previous);assert.deepEqual(carPerformance(s,'alm'),hardware);
  assert.equal(performanceIndex(s,s.team),index);assert.deepEqual(e.researched,[]);assert.deepEqual(e.fitted,[[],[]]);assert.deepEqual(e.production,[]);
  assert.equal(researchBlock(s,'aero-1'),null);assert.match(researchBlock(s,'aero-2')!,/first/);
  assert.equal(s.history[0].report!.endIndex,index);assert.ok(s.history[0].report!.teamPoints>0);
  assert.deepEqual(cleanCareer(JSON.parse(JSON.stringify(s))),s);
});

test('twenty seasons keep progress and bounded physical pace, with a fresh research programme every year',()=>{
  let s=start(),last=performanceIndex(s,s.team);
  for(let year=0;year<20;year++){
    for(const id of ['aero-1','chassis-1','powertrain-1'])minor(s,id);
    engineering(s).regulation={season:s.season+1,area:'durability',adapted:[]};finish(s);
    assert.ok(performanceIndex(s,s.team)>last);last=performanceIndex(s,s.team);
    nextSeason(s,s.team);assert.equal(performanceIndex(s,s.team),last);
    s=cleanCareer(JSON.parse(JSON.stringify(s)))!;assert.equal(engineering(s).researched.length,0);
    for(const n of Object.values(carPerformance(s,'alm')))assert.ok(Number.isFinite(n)&&n>0&&n<=1.25);
  }
  assert.equal(s.history.length,20);assert.ok(s.history.every(h=>h.report?.teamPoints));
  assert.ok(carRating(s,s.team)>1,'progress is not capped at the original leader');
});

test('unfinished season-end work returns its unused cash and RP exactly once',()=>{
  const s=start(),e=engineering(s);s.owner!.cash=1e8;e.rp=10_000;
  e.researched=['aero-1','aero-2'];e.designs={'aero-1':1,'aero-2':1};
  while(s.done.length<s.calendar.length-1)race(s);
  advanceToWeekend(s);const rp=e.rp;assert.ok(startResearch(s,'aero-3'));assert.ok(manufacture(s,'aero-1',2));
  const cost=e.production[0].cost,rpCost=rp-e.rp;race(s);
  const cash=s.owner!.cash,remaining=e.rp;nextSeason(s,s.team);
  assert.equal(s.owner!.cash,cash+cost);assert.equal(e.rp,remaining+rpCost);assert.equal(e.research.length+e.production.length,0);
  const same=s.owner!.cash;nextSeason(s,s.team);assert.equal(s.owner!.cash,same);
});

test('midseason negotiations counter low offers, preserve scored results and activate only at the year boundary',()=>{
  const s=start();s.owner!.cash=1e8;race(s);race(s);race(s);
  const before=team(s.team,s).drivers.slice(),results=JSON.stringify(s.done);setGrid(s,lineup(s).map(d=>d.id));const grid=s.grid!.slice();
  assert.ok(openDriverTalk(s,'lin',1,3));const ask=contractQuote(s,'lin',1,3),cash=s.owner!.cash;
  assert.equal(offerDriverContract(s,'lin',1,{fee:0,salary:0,years:3}),'counter');assert.equal(s.owner!.cash,cash);
  assert.equal(offerDriverContract(s,'lin',1,ask),'accepted');assert.equal(s.owner!.cash,cash-ask.fee);
  activateDriverContracts(s);assert.equal(s.contracts!.next[1]!.driver,'lin','activation during the current year cannot consume a future deal');
  assert.equal(offerDriverContract(s,'lin',1,ask),'unavailable');assert.deepEqual(team(s.team,s).drivers,before);assert.deepEqual(s.grid,grid);assert.equal(JSON.stringify(s.done),results);
  assert.equal(openDriverTalk(s,'lin',0),false);
  let restored=cleanCareer(JSON.parse(JSON.stringify(s)))!;assert.deepEqual(restored,s);finish(restored);nextSeason(restored,restored.team);
  assert.deepEqual(team(restored.team,restored).drivers,['alm','lin']);assert.equal(restored.owner!.selected,'lin');assert.equal(new Set(lineup(restored).map(d=>d.id)).size,20);
  assert.equal(restored.history[0].report!.drivers.find(d=>d.id==='whi')!.name,'Whitlock');
  assert.equal(restored.contracts!.active[1].ends,4);assert.equal(restored.contracts!.active[1].salary,ask.salary);
  assert.ok(contractQuote(restored,'val',1).buyout>0);
  race(restored);const paid=restored.owner!.spent;settleDriverPayroll(restored);assert.equal(restored.owner!.spent,paid);
  assert.equal(restored.owner!.ledger!.find(l=>l.label==='Driver contract salaries')!.amount,-restored.contracts!.active.reduce((sum,d)=>sum+d.salary,0));
  finish(restored);nextSeason(restored,restored.team);assert.equal(restored.contracts!.active[1].ends,4);assert.equal(restored.contracts!.active[1].salary,ask.salary);
  restored=cleanCareer(JSON.parse(JSON.stringify(restored)))!;assert.equal(restored.contracts!.active[1].driver,'lin');
});

test('contract expiry, cancellation and malformed terms never charge twice or alter a current seat',()=>{
  const s=start();s.owner!.cash=1e8;assert.ok(openDriverTalk(s,'val',0));
  assert.ok(openDriverTalk(s,'val',0,2));assert.equal(s.contracts!.talks[0].years,2,'talk duration can be renegotiated');
  assert.equal(offerDriverContract(s,'val',0,{fee:Infinity,salary:1,years:1}),'invalid');
  for(let i=0;i<4;i++)race(s);
  assert.equal(offerDriverContract(s,'val',0,contractQuote(s,'val',0)),'unavailable');assert.ok(openDriverTalk(s,'val',0));
  assert.equal(offerDriverContract(s,'val',0,contractQuote(s,'val',0)),'accepted');const paid=s.owner!.cash;
  assert.ok(cancelFutureContract(s,0));assert.equal(s.owner!.cash,paid);assert.equal(cancelFutureContract(s,0),false);
  assert.equal(s.contracts!.next[0],null);assert.equal(team(s.team,s).drivers[0],'alm');
  const clean=cleanCareer({...s,contracts:{...s.contracts,next:[{driver:'missing',starts:2,ends:4},null],talks:[null,{driver:'missing'}]}})!;
  assert.deepEqual(clean.contracts!.next,[null,null]);assert.deepEqual(clean.contracts!.talks,[]);
});

test('an unsigned seat is retained, while a teammate seat swap cannot duplicate a driver',()=>{
  const s=start();s.owner!.cash=1e8;assert.ok(openDriverTalk(s,'whi',0));assert.equal(offerDriverContract(s,'whi',0,contractQuote(s,'whi',0)),'accepted');
  finish(s);nextSeason(s,s.team);assert.deepEqual(team(s.team,s).drivers,['whi','alm']);assert.equal(new Set(lineup(s).map(d=>d.id)).size,20);
  const original=team(s.team,s).drivers.slice();activateDriverContracts(s);assert.deepEqual(team(s.team,s).drivers,original);
  s.contracts!.active[1].ends=4;s.contracts!.active[1].salary=88_000;
  assert.ok(openDriverTalk(s,'whi',1,2));assert.equal(contractQuote(s,'whi',1,2).buyout,0);
  assert.equal(offerDriverContract(s,'whi',1,contractQuote(s,'whi',1,2)),'accepted');finish(s);nextSeason(s,s.team);
  assert.deepEqual(team(s.team,s).drivers,['alm','whi']);assert.equal(s.contracts!.active[0].ends,4);assert.equal(s.contracts!.active[0].salary,88_000);
});

test('season prizes and combined-team recaps survive reload without replaying rewards',()=>{
  const s=createCustomCareer({principal:'Owner',name:'Nova Works',paint:1,secondary:2,drivers:['reserve-reed','reserve-sato'],difficulty:100,length:'short',rounds:'short'},1)!;
  ensureSeasonStart(s);finish(s);const r=seasonReport(s),cash=s.owner!.cash;
  assert.equal(r.teamPoints,8*43);assert.equal(r.teamWins,8);assert.equal(r.teamPodiums,16);assert.equal(r.drivers.length,2);assert.ok(r.prize>=1_000_000);
  assert.equal(settleSeasonAwards(s),false);const copy=cleanCareer(JSON.parse(JSON.stringify(s)))!;assert.equal(settleSeasonAwards(copy),false);assert.equal(copy.owner!.cash,cash);
  nextSeason(copy,copy.team);assert.equal(copy.history[0].report!.teamName,'Nova Works');assert.deepEqual(copy.history[0].report,r);
});
