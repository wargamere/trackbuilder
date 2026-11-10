const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const dir = process.argv[2];
  const layouts = {
    landscape: { w: 1920, h: 1080, img: 'mid-day-4.png', grid: 20, stroke: 8,
      card: { x: 70, y: 60, w: 1000, h: 330, rot: -3 },
      titleStyle: { left: '48px', top: '40px', fontSize: '128px' },
      trackBox: { x: 690, y: 40, w: 270, h: 250 }, road: 14 },
    portrait: { w: 800, h: 1200, img: 'port-3.png', grid: 14, stroke: 6,
      card: { x: 40, y: 56, w: 720, h: 262, rot: -3 },
      titleStyle: { left: '34px', top: '30px', fontSize: '104px' },
      trackBox: { x: 395, y: 22, w: 290, h: 100 }, road: 10 },
    square: { w: 800, h: 800, img: 'sq-4.png', grid: 14, stroke: 6,
      card: { x: 36, y: 40, w: 728, h: 250, rot: -3 },
      titleStyle: { left: '30px', top: '30px', fontSize: '96px' },
      trackBox: { x: 520, y: 30, w: 180, h: 190 }, road: 9 },
  };
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  for (const [name, L] of Object.entries(layouts)) {
    const p = await b.newPage({ viewport: { width: L.w, height: L.h }, deviceScaleFactor: 1 });
    const track = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'track.json'), 'utf8'));
    await p.addInitScript((t) => { window.__TRACK = t; }, track);
    // (The still is in `dir`, the page here: give it the still's full path.)
    const page = { ...L, img: 'file://' + path.join(dir, L.img) };
    await p.goto('file://' + path.join(__dirname, 'compose.html') + '?layout=' + encodeURIComponent(JSON.stringify(page)));
    p.on('pageerror', (e) => console.log('pageerror', e.message)); p.on('console', (m) => console.log('console', m.text()));
    await p.waitForSelector('body[data-ready="1"]', { state: 'attached', timeout: 8000 });
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(dir, `cover-${name}.png`) });
    await p.close();
  }
  await b.close();
})();
