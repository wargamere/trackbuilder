// Trailer for the CrazyGames preview video, frame by frame on a fake clock (so it's smooth however
// slow the renderer): drawing a track in the editor, racing it against AI cars, then rain at night.
// Usage: node record.cjs OUT.mp4 WIDTH HEIGHT [dry]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
(async () => {
  const [out, W, H, dry] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5] === 'dry'];
  const FPS = 30;
  const FRAME = 1000 / FPS;
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.setDefaultTimeout(300000);
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    const s = {
      editorMode: 'draw', smoothing: 'normal', minimap: true, tower: 'compact', camera: 'chase', paint: 'yellow',
      raceSetup: { mode: 'race', ghost: false, opponents: 5, difficulty: 45, grid: 'pick', startSlot: 3, weather: 'dry', time: 'day', tyreWear: false, tyres: 'medium' },
    };
    try { localStorage.setItem('inkcircuit.settings', JSON.stringify(s)); localStorage.setItem('inkcircuit.library.manualOnly', 'true'); } catch {}
  });
  // (No cloud save while recording: it would only hold up the start, by however long the network takes.)
  await ctx.route(/supabase\.co/, (r) => r.abort());
  await p.clock.install();
  await p.goto('http://localhost:4319/?autopilot');
  await p.clock.runFor(2500);
  // On to the main menu before anything is pressed.
  for (let k = 0; k < 80 && !(await p.evaluate(() => document.body.innerText.includes('Race this track'))); k++) {
    await p.waitForTimeout(100);
    await p.clock.runFor(250);
  }
  await p.addStyleTag({ content: '.hud-debug, .hud-hint { display: none !important; }' });

  let frames = 0;
  const ff = dry ? null : spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  const marks = new Set();
  const shot = async (name) => {
    if (dry) {
      if (name && !marks.has(name)) {
        marks.add(name);
        await p.screenshot({ path: `${out}-${name}.jpg`, type: 'jpeg', quality: 80 });
      }
    } else {
      ff.stdin.write(await p.screenshot({ type: 'jpeg', quality: 93 }));
    }
    frames++;
  };
  const step = async (n = 1, name) => {
    for (let k = 0; k < n; k++) {
      await p.clock.runFor(FRAME);
      if (!dry || name) await shot(k === n - 1 ? name : undefined);
    }
  };

  // 1. The editor, a blank page, and a loop drawn freehand.
  await p.keyboard.press('KeyE');
  await p.clock.runFor(1500);
  await p.keyboard.press('KeyC');
  await p.clock.runFor(600);
  const portrait = H > W;
  await p.locator('.studio-welcome .btn', { hasText: 'Start drawing' }).click({ force: true, timeout: 5000 }).catch((e) => console.log('no welcome card', e.message.slice(0, 80)));
  await p.clock.runFor(300);
  if (portrait) {
    await p.keyboard.press('KeyO');
    await p.clock.runFor(400);
  }
  // Sunday Loop's outline, drawn by hand from its start line, at its real size on the editor's paper.
  const src = JSON.parse(fs.readFileSync(__dirname + '/track.json', 'utf8')).pts;
  const v = await p.evaluate(() => {
    const e = window.__game.screens.editor;
    const view = e.view;
    return { ox: view.ox, oy: view.oy, scale: view.scale };
  });
  const N = 110;
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const q = src[Math.round((i / N) * (src.length - 1)) % src.length];
    return { x: v.ox + q[0] * v.scale, y: v.oy + q[1] * v.scale };
  });
  pts[N] = pts[0];
  await p.mouse.move(pts[0].x, pts[0].y);
  await p.mouse.down();
  await step(4, 'draw0');
  for (let i = 1; i <= N; i++) {
    await p.mouse.move(pts[i].x, pts[i].y, { steps: 2 });
    await step(1, i === 70 ? 'draw70' : undefined);
  }
  await p.mouse.up();
  await step(48, 'closed');
  // 2. Race it (a cut past the race setup and most of the countdown).
  await p.keyboard.press('Enter');
  await p.clock.runFor(700);
  await p.keyboard.press('Enter');
  await p.clock.runFor(2300);
  await step(30, 'go');
  await step(240, 'race');
  // 3. The same track at night in the rain (a cut).
  await p.evaluate(() => window.__game.start({ weather: 'rain', time: 'night' }));
  await p.clock.runFor(3200);
  await step(180, 'night');
  if (ff) {
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
  }
  console.log(`${frames} frames (${(frames / FPS).toFixed(1)} s)`, dry ? '(dry run)' : out, 'errors:', JSON.stringify(errs));
  await b.close();
})();
