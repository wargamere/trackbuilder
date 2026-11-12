// Real browser smoke coverage. Run `npx playwright install chromium` once first.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'web', '--host', '127.0.0.1', '--port', '5178', '--strictPort'], { stdio: 'inherit' });
let browser;
let page;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:5178')).ok) { ready = true; break; } } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'Vite starts');
  await mkdir('test-results', { recursive: true });
  // PW_CHROMIUM: use an already installed Chromium instead of Playwright's own download.
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'], executablePath: process.env.PW_CHROMIUM || undefined });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5178');
  await page.waitForFunction(() => window.__game);
  await page.keyboard.press('e');
  await page.locator('.editor').waitFor();
  await page.locator('.studio-blank').click();
  await page.locator('.studio-welcome:not([hidden])').waitFor();
  await page.screenshot({ path: 'test-results/studio-welcome.png' });
  await page.locator('.studio-welcome .studio-template').first().focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('.studio-welcome')?.hidden);
  const name = page.getByRole('textbox', { name: 'Track name', exact: true });
  assert.equal(await name.inputValue(), 'Easy oval');
  assert.equal(await page.locator('.editor .ink, .editor .mult').count(), 0);
  await page.locator('.sections').hover();
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => document.querySelector('.sections')?.scrollTop > 0);
  await page.getByRole('button', { name: 'Next point', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Raise point 0.5 m', exact: true }).click();
  await page.screenshot({ path: 'test-results/studio-editor.png' });
  await page.waitForFunction(() => document.querySelector('.studio-draft')?.textContent.includes('backed up'));

  await page.getByRole('button', { name: 'Quick guide', exact: true }).click();
  await page.locator('dialog[open]').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog')?.open);

  await name.fill('My first circuit');
  await name.press('Tab');
  await page.getByRole('button', { name: /^Test drive:/ }).click();
  await page.waitForFunction(() => window.__game.mode === 'practice' && !document.querySelector('.editor'));
  assert.equal(await page.evaluate(() => window.__game.track.def.name), 'My first circuit');
  assert.equal(await page.evaluate(() => window.__game.track.def.control[0].h), 0.5);
  await page.evaluate(() => window.__game.go('editor'));
  await page.locator('.editor').waitFor();
  await page.getByRole('button', { name: 'Recover last draft', exact: true }).click();
  assert.equal(await name.inputValue(), 'My first circuit');

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => document.querySelector('.editor')?.classList.contains('rail'));
  await page.locator('.sec-head').first().click();
  await page.locator('.sidebar.open').waitFor();
  await page.locator('.sidebar.open #studio-section-0 button[title="New blank track"]').click();
  await page.locator('.studio-welcome:not([hidden])').waitFor();
  const firstTool = await page.locator('.sec-head').first().boundingBox();
  assert.ok(firstTool && firstTool.y >= 0, 'collapsed rail starts with the first tool');
  await page.screenshot({ path: 'test-results/studio-mobile.png' });
  const bounds = await page.locator('.studio-welcome').boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 844 && bounds.y + bounds.height <= 390, 'mobile welcome stays within viewport');
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  phone.on('pageerror', (error) => errors.push(error.message));
  await phone.goto('http://127.0.0.1:5178');
  await phone.waitForFunction(() => window.__game);
  await phone.getByRole('button', { name: 'Draw a track', exact: true }).click();
  await phone.locator('.editor').waitFor();
  const panBounds = await phone.getByRole('button', { name: 'Pan', exact: true }).boundingBox();
  assert.ok(panBounds && panBounds.x + panBounds.width <= 390, 'all phone drawing tools fit on screen');
  assert.equal(await phone.locator('.rotate-prompt').isVisible(), false, 'portrait editing is not blocked');
  await phone.locator('.sec-head').first().click();
  await phone.locator('.sidebar.open #studio-section-0 button[title="New blank track"]').click();
  await phone.locator('.studio-welcome:not([hidden])').waitFor();
  await phone.screenshot({ path: 'test-results/studio-phone.png' });
  // Career: start one, qualify (skipped: no time, the back of the grid), and the grid of twenty is kept in the paddock.
  const career = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  career.on('pageerror', (error) => errors.push(error.message));
  await career.goto('http://127.0.0.1:5178');
  await career.waitForFunction(() => window.__game);
  const nativePalette = await career.locator('.main-menu .btn.primary').evaluate((el) => ({ action: getComputedStyle(el).backgroundColor, ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() }));
  await career.keyboard.press('k');
  await career.getByRole('button', { name: 'Take over an existing team', exact: true }).click();
  await career.locator('.career-name').fill('Tester');
  await career.getByRole('button', { name: /Start career/ }).click();
  await career.locator('.owner-layout').waitFor();
  await career.evaluate(() => { window.__game.career.save.seed = 1234; window.__game.career.write(); });
  assert.equal(await career.locator('.owner-nav button').count(), 6, 'six primary career sections');
  assert.equal(await career.locator('.owner-lineup-art').count(), 0, 'career uses the native interface');
  assert.equal(await career.locator('.owner-footer .btn.primary').evaluate((el) => getComputedStyle(el).backgroundColor), nativePalette.action, 'career shares the main-menu primary action');
  const shell = await career.locator('.career .panel').boundingBox();
  assert.ok(shell && shell.x === 0 && shell.y === 0 && shell.width === 1440 && shell.height === 900, 'career is fullscreen');
  await career.screenshot({ path: 'test-results/career-native-overview.png' });
  const section = async (target) => {
    const parents = { Research: 'Engineering', Development: 'Engineering', 'Assign upgrades': 'Engineering', 'Progress history': 'Engineering', Facilities: 'Engineering', Vehicle: 'Engineering', Personnel: 'Drivers', 'Driver lineup': 'Drivers', Standings: 'Championship', Legacy: 'Championship', Finance: 'Team', 'My team': 'Team' };
    if (parents[target]) {
      await career.getByRole('button', { name: parents[target], exact: true }).click();
      await career.locator('.owner-subnav').getByRole('button', { name: target, exact: true }).click();
    } else await career.getByRole('button', { name: target, exact: true }).click();
  };
  await career.getByRole('button', { name: 'Review team decision', exact: true }).click();
  await career.getByRole('button', { name: 'Promise steady progress', exact: true }).click();
  assert.equal(await career.evaluate(() => window.__game.career.save.owner.world.decisions.length), 1);
  await section('Personnel');
  await career.getByRole('button', { name: 'Hire Maya Hart', exact: true }).click();
  await section('Driver lineup');
  await career.getByRole('button', { name: 'Train Almeida: Qualifying pace', exact: true }).click();
  await section('Research');
  await career.getByRole('button', { name: 'Research Front wing profiles', exact: true }).click();
  assert.equal(await career.evaluate(() => window.__game.career.save.owner.engineering.research.length), 1);
  await career.screenshot({ path: 'test-results/career-native-research.png' });
  await career.getByRole('button', { name: 'Advance to race weekend', exact: true }).click();
  assert.ok(await career.evaluate(() => window.__game.career.save.owner.engineering.researched.includes('aero-1')));
  await section('Development');
  await career.getByRole('button', { name: 'Build 1 Front wing profiles', exact: true }).click();
  assert.equal(await career.evaluate(() => window.__game.career.save.owner.engineering.production.length), 1);
  await career.screenshot({ path: 'test-results/career-native-development.png' });
  await section('Overview');
  const initialDriver = await career.evaluate(() => window.__game.career.save.owner.selected);
  await career.locator('.owner-driver:not(.selected)').click();
  assert.notEqual(await career.evaluate(() => window.__game.career.save.owner.selected), initialDriver);
  await career.getByRole('button', { name: 'Qualifying', exact: true }).click();
  await career.waitForFunction(() => document.documentElement.dataset.screen === 'race');
  await career.keyboard.press('Escape');
  await career.getByRole('button', { name: /Skip qualifying/ }).click();
  await career.locator('.grid-overlay:not([hidden])').waitFor();
  assert.equal(await career.locator('.grid-overlay .standings li').count(), 20);
  await career.getByRole('button', { name: /Back to the paddock/ }).click();
  await career.reload(); await career.waitForFunction(() => window.__game); await career.keyboard.press('k');
  assert.equal(await career.evaluate(() => window.__game.career.save.owner.engineering.production.length), 1, 'manufacturing survives reload');
  await career.locator('.owner-preparation summary').click();
  assert.equal(await career.locator('.career-grid li').count(), 20);
  await career.setViewportSize({ width: 390, height: 844 });
  const raceButton = await career.getByRole('button', { name: /Start the race/ }).boundingBox();
  assert.ok(raceButton && raceButton.x >= 0 && raceButton.x + raceButton.width <= 390 && raceButton.y + raceButton.height <= 844, 'phone race action is on screen');
  assert.equal(await career.locator('.career .panel').evaluate((el) => el.scrollWidth > el.clientWidth), false);
  await career.screenshot({ path: 'test-results/career-native-phone.png' });
  await section('Finance');
  await career.locator('.owner-contract').filter({ hasText: 'Meridian Group' }).getByRole('button', { name: 'Sign season contract' }).click();
  for (const tab of ['Inbox', 'Personnel', 'Research', 'Development', 'Assign upgrades', 'Facilities', 'Legacy']) {
    await section(tab);
    assert.equal(await career.locator('.owner-layout').evaluate((el) => el.scrollWidth > el.clientWidth), false, tab + ' fits a phone');
    const active = await career.locator('.owner-nav [aria-current="page"]').boundingBox();
    assert.ok(active && active.x >= 0 && active.x + active.width <= 390, 'active primary navigation is visible');
  }
  await section('Overview');
  for (const size of [{ width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await career.setViewportSize(size);
    assert.equal(await career.locator('.career .panel').evaluate((el) => el.scrollWidth > el.clientWidth), false, 'career fits ' + size.width);
  }
  await career.getByRole('button', { name: /Start the race/ }).click();
  await career.waitForFunction(() => window.__game.event?.session === 'race');
  await career.evaluate(() => {
    const e = window.__game.event;
    const order = ['alm', 'whi', ...e.field.map((d) => d.id).filter((id) => !['alm', 'whi'].includes(id))];
    e.finished({ order, dnf: [], fastest: 'alm', times: order.map((_, i) => 600 + i), laps: order.map(() => 10), estimated: false });
  });
  await career.keyboard.press('Enter'); await section('Overview');
  await career.getByRole('button', { name: 'Advance to race weekend', exact: true }).click();
  assert.equal(await career.evaluate(() => window.__game.career.save.owner.engineering.stock['aero-1']), 1, 'manufactured copy arrives for the next weekend');
  await section('Assign upgrades');
  await career.locator('.engineering-car-columns > section').first().getByRole('button', { name: 'Fit upgrade', exact: true }).click();
  assert.deepEqual(await career.evaluate(() => window.__game.career.save.owner.engineering.fitted), [['aero-1'], []], 'only the assigned car gets the upgrade');
  await career.screenshot({ path: 'test-results/career-native-allocation.png' });
  // A custom twelfth team: its two colours and paid hires must survive boot and a full 24-car grid.
  const custom = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  custom.on('pageerror', (error) => errors.push(error.message));
  await custom.goto('http://127.0.0.1:5178');
  await custom.waitForFunction(() => window.__game);
  await custom.keyboard.press('k');
  await custom.getByRole('textbox', { name: 'Team principal name', exact: true }).fill('Founder');
  await custom.getByRole('textbox', { name: 'Team name', exact: true }).fill('Apex Nova Racing');
  await custom.setViewportSize({ width: 390, height: 844 });
  assert.equal(await custom.locator('.creating-team .panel').evaluate((el) => el.scrollWidth > el.clientWidth), false, 'phone team creation fits horizontally');
  assert.ok(await custom.evaluate(() => document.querySelector('.team-create-identity').getBoundingClientRect().bottom <= document.querySelector('.team-create-hiring').getBoundingClientRect().top), 'phone creation sections never overlap');
  const createButton = await custom.getByRole('button', { name: /Start career/ }).boundingBox();
  assert.ok(createButton && createButton.y + createButton.height <= 844, 'phone create action is always visible');
  await custom.setViewportSize({ width: 1440, height: 900 });
  await custom.getByLabel('Primary colour', { exact: true }).fill('#6a42df');
  await custom.getByLabel('Accent colour', { exact: true }).fill('#5ce6c0');
  await custom.getByRole('button', { name: 'Hire Maxim Verstallen for seat 1', exact: true }).click();
  await custom.getByRole('button', { name: 'Choose driver for seat 2', exact: true }).click();
  await custom.getByRole('button', { name: 'Hire Landon Norrin for seat 2', exact: true }).click();
  await custom.screenshot({ path: 'test-results/team-creation.png' });
  await custom.getByRole('button', { name: /Start career/ }).click();
  await custom.locator('.owner-layout').waitFor();
  const entry = await custom.evaluate(() => window.__game.career.save.entry);
  assert.equal(entry.name, 'Apex Nova Racing');
  assert.deepEqual(entry.drivers, ['gp-verstallen', 'gp-norrin']);
  assert.deepEqual([entry.paint, entry.secondary], [0x6a42df, 0x5ce6c0]);
  assert.ok((await custom.locator('.owner-brand').textContent()).includes('Apex Nova Racing'));
  await custom.reload();
  await custom.waitForFunction(() => window.__game);
  await custom.keyboard.press('k');
  assert.deepEqual(await custom.evaluate(() => window.__game.career.save.entry), entry, 'identity and contracts survive reload');
  await custom.getByRole('button', { name: 'Advance to race weekend', exact: true }).click();
  await custom.getByRole('button', { name: /Qualifying/ }).click();
  await custom.waitForFunction(() => document.documentElement.dataset.screen === 'race');
  assert.equal(await custom.evaluate(() => window.__game.event.field.length), 23);
  assert.equal(await custom.evaluate(() => window.__game.event.you.secondary), 0x5ce6c0);
  await custom.keyboard.press('Escape');
  await custom.getByRole('button', { name: /Skip qualifying/ }).click();
  await custom.locator('.grid-overlay:not([hidden])').waitFor();
  assert.equal(await custom.locator('.grid-overlay .standings li').count(), 24);
  await custom.getByRole('button', { name: /Back to the paddock/ }).click();
  await custom.getByRole('button', { name: 'Team', exact: true }).click();
  await custom.getByRole('button', { name: 'My team', exact: true }).click();
  await custom.getByRole('textbox', { name: 'Team name', exact: true }).fill('Nova Works');
  await custom.getByRole('button', { name: 'Save team identity', exact: true }).click();
  assert.equal(await custom.evaluate(() => window.__game.career.save.entry.name), 'Nova Works');
  await custom.getByRole('button', { name: /Start the race/ }).click();
  await custom.waitForFunction(() => window.__game.screens.race.opponents.length === 23);
  assert.ok(await custom.evaluate(() => window.__game.screens.race.opponents.every((o) => typeof o.ai.racecraft === 'string')), 'live opponents expose their actual racecraft decision');
  const duelChecks = await custom.evaluate(async () => {
    const { cornerDuel } = await import('/tests/helpers/racecraft.ts');
    const outside = cornerDuel(1, 0, 'inside'), cutback = cornerDuel(0, 6, 'wide-exit');
    return { outside: outside.peakOverlapSeconds, outsideHits: outside.contacts, switchback: cutback.actions.switchback, exitAttack: cutback.actions['exit-attack'], gap: cutback.finalGap, hits: cutback.contacts, off: outside.off + cutback.off };
  });
  assert.ok(duelChecks.outside > 2.5 && duelChecks.switchback > 0 && duelChecks.exitAttack > 0 && duelChecks.gap < -5, 'outside and switchback decisions execute in Chromium');
  assert.equal(duelChecks.outsideHits + duelChecks.hits + duelChecks.off, 0, 'browser duels remain clean');
  await custom.keyboard.press('Escape');
  await custom.getByRole('button', { name: /Back to the paddock/ }).click();
  await custom.getByRole('button', { name: 'Overview', exact: true }).click();
  await custom.screenshot({ path: 'test-results/custom-team-hub.png' });
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('Browser checks passed: templates, keyboard editing, heights, guide, practice, draft recovery, mobile layout, career.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: 'test-results/studio-failure.png' });
    await writeFile('test-results/studio-failure.txt', await page.locator('body').ariaSnapshot());
  }
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
