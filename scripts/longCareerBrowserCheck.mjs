import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin='http://127.0.0.1:5280';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--mode','web','--host','127.0.0.1','--port','5280','--strictPort'],{stdio:'ignore'});
let browser;
try {
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>window.__game);
  await page.evaluate(async()=>{
    const {createCustomCareer}=await import('/src/career/teamManagement.ts');
    const s=createCustomCareer({principal:'Founder',name:'Nova Legacy',paint:0x2257cc,secondary:0xffcb19,drivers:['reserve-reed','reserve-sato'],difficulty:100,length:'short',rounds:'short'},42);
    s.owner.cash=30_000_000;window.__game.career.start(s);window.__game.go('career');
  });
  await page.locator('.owner-layout').waitFor();
  await page.getByRole('button',{name:'Engineering',exact:true}).click();await page.getByRole('button',{name:'Vehicle',exact:true}).click();
  assert.match(await page.locator('.owner-performance-list li').first().textContent(),/700 PI/);
  await page.evaluate(async()=>{
    const {engineering,assignUpgrade}=await import('/src/career/engineering.ts');
    const {recordRound,lineup,team}=await import('/src/career/career.ts');
    const s=window.__game.career.save,e=engineering(s);e.researched=['aero-1'];e.designs={'aero-1':1};e.stock['aero-1']=2;assignUpgrade(s,'aero-1',0);assignUpgrade(s,'aero-1',1);e.regulation={season:2,area:'durability',adapted:[]};
    for(let i=0;i<2;i++)recordRound(s,{order:[...team(s.team,s).drivers,...lineup(s).map(d=>d.id)],dnf:[],fastest:null});
    window.__game.career.write();window.__game.go('menu');window.__game.go('career');
  });
  await page.getByRole('button',{name:'Drivers',exact:true}).click();await page.locator('.team-seat-selection button').nth(1).click();
  await page.getByLabel('Driver to negotiate with',{exact:true}).selectOption('gp-piastra');await page.getByLabel('Contract duration',{exact:true}).selectOption('3');
  const original=await page.evaluate(()=>({drivers:[...window.__game.career.save.entry.drivers],done:JSON.stringify(window.__game.career.save.done)}));
  await page.getByRole('button',{name:'Open contract talks',exact:true}).click();
  await page.getByRole('button',{name:'Make contract offer',exact:true}).click();
  assert.ok(await page.locator('.contract-talk.counter').count());
  await page.getByRole('button',{name:'Accept counteroffer',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__game.career.save.contracts.next[1].driver),'gp-piastra');
  assert.deepEqual(await page.evaluate(()=>({drivers:[...window.__game.career.save.entry.drivers],done:JSON.stringify(window.__game.career.save.done)})),original);
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/career-negotiations-desktop.png'});
  await page.reload();await page.waitForFunction(()=>window.__game);await page.keyboard.press('k');
  assert.equal(await page.evaluate(()=>window.__game.career.save.contracts.next[1].driver),'gp-piastra');
  await page.evaluate(async()=>{
    const {recordRound,lineup,team}=await import('/src/career/career.ts');const g=window.__game,s=g.career.save;
    while(s.done.length<s.calendar.length)recordRound(s,{order:[...team(s.team,s).drivers,...lineup(s).map(d=>d.id)],dnf:[],fastest:null});g.career.write();g.go('menu');g.go('career');
  });
  await page.locator('.season-review-hero.champion').waitFor();
  assert.match(await page.locator('.season-review-hero').textContent(),/344 points/);
  assert.equal(await page.locator('.season-review-drivers article').count(),2);
  const cash=await page.evaluate(()=>window.__game.career.save.owner.cash);
  await page.screenshot({path:'test-results/career-season-recap-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('.career .panel').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  const next=await page.getByRole('button',{name:'Start season 2',exact:true}).boundingBox();assert.ok(next&&next.y+next.height<=844,'next-season action stays visible on phone');
  await page.screenshot({path:'test-results/career-season-recap-phone.png'});
  await page.getByRole('button',{name:'Start season 2',exact:true}).click();await page.locator('.season-calendar-editor').waitFor();
  const nextState=await page.evaluate(()=>{const s=window.__game.career.save;return{drivers:s.entry.drivers,researched:s.owner.engineering.researched,fitted:s.owner.engineering.fitted,baseline:s.owner.engineering.baseline,oldNames:s.history[0].report.drivers.map(d=>d.name),cash:s.owner.cash};});
  assert.equal(nextState.drivers[1],'gp-piastra');assert.deepEqual(nextState.researched,[]);assert.deepEqual(nextState.fitted,[[],[]]);assert.equal(nextState.baseline[1].aero,.012);assert.ok(nextState.oldNames.includes('Sato'));assert.equal(nextState.cash,cash);
  await page.getByRole('button',{name:'Engineering',exact:true}).click();await page.getByRole('button',{name:'Research',exact:true}).click();
  assert.match(await page.locator('.engineering-research').textContent(),/0 \/ 16/);
  assert.deepEqual(errors,[]);console.log('Long-career browser checks passed: index headroom, midseason counteroffers, save/reload, season rewards, mobile recap, deferred transfers and a fresh R&D tree with retained foundations.');
}finally{await browser?.close();server.kill();}
