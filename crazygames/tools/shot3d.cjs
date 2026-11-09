// A race from the back of the grid at sunset, HUD hidden: stills for the covers.
// Usage: node shot3d.cjs OUTDIR WIDTH HEIGHT TAG [trackSteps]
const { chromium } = require('playwright');
(async () => {
  const [S, W, H, tag, steps = '0', time = 'sunset', slot = '8', diff = '70'] = process.argv.slice(2);
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage({ viewport: { width: +W, height: +H } });
  await p.addInitScript(([time, slot, diff]) => {
    const s = {
      minimap: false, tower: 'off', camera: 'chase', paint: 'yellow',
      raceSetup: { mode: 'race', ghost: false, opponents: 7, difficulty: +diff, grid: 'pick', startSlot: +slot, weather: 'dry', time, tyreWear: false, tyres: 'medium' },
    };
    try { localStorage.setItem('inkcircuit.settings', JSON.stringify(s)); localStorage.setItem('inkcircuit.library.manualOnly', 'true'); } catch {}
  }, [time, slot, diff]);
  await p.goto('http://localhost:4319/', { waitUntil: 'load' });
  await p.waitForTimeout(2000);
  for (let k = 0; k < +steps; k++) {
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(300);
  }
  console.log('track:', (await p.locator('.menu-track-name, .track-card h3, h3').first().textContent().catch(() => '?'))?.trim());
  await p.keyboard.press('Enter');
  await p.waitForTimeout(800);
  await p.locator('.race-setup .btn', { hasText: 'Start' }).click();
  await p.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  await p.waitForTimeout(5500);
  await p.keyboard.down('KeyW');
  for (let k = 0; k < 6; k++) {
    await p.waitForTimeout(1300);
    await p.screenshot({ path: `${S}/cover/${tag}-${k}.png` });
  }
  await p.keyboard.up('KeyW');
  await b.close();
})();
