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
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
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
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('Browser checks passed: templates, keyboard editing, heights, guide, practice, draft recovery, mobile layout.');
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
