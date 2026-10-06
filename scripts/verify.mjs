// Smoke test: builds must already exist (npm run build). Starts `vite preview`,
// drives the app in headless Chromium at desktop, tablet and phone sizes, and
// saves screenshots to ./screenshots (git-ignored).
//
//   npm run build && npm run verify
//
// Set CHROMIUM_PATH if Chromium is not at the default location.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const outDir = process.env.SCREENSHOT_DIR || 'screenshots';
mkdirSync(outDir, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'pipe',
});
process.on('exit', () => server.kill());
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => d.toString().includes(String(PORT)) && resolve());
  server.on('exit', (c) => reject(new Error(`preview exited ${c}`)));
  setTimeout(() => reject(new Error('preview timeout')), 20000);
});

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
};

const browser = await chromium.launch({ executablePath });
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1180, isMobile: true, hasTouch: true },
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
];

try {
  for (const vp of viewports) {
    for (const scheme of ['dark', 'light']) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch,
        colorScheme: scheme,
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        // External tile requests may be blocked in sandboxes; ignore those.
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
      });
      const tag = `${vp.name}-${scheme}`;
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.leaflet-marker-icon .pm', { timeout: 15000 });
      await page.waitForTimeout(600);

      const theme = await page.getAttribute('html', 'data-theme');
      check(theme === scheme, `[${tag}] system theme resolves to ${scheme}`);
      const markers = await page.locator('.leaflet-marker-icon .pm').count();
      check(markers > 30, `[${tag}] project markers rendered (${markers})`);
      const participants = await page.locator('path.country--participant').count();
      check(participants > 100, `[${tag}] participant polygons styled (${participants})`);
      const routes = await page.locator('path.route--maritime, path.route--land').count();
      check(routes >= 5, `[${tag}] routes drawn (${routes})`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflow <= 0, `[${tag}] no horizontal page overflow (${overflow}px)`);
      await page.screenshot({ path: `${outDir}/${tag}-map.png` });

      if (scheme === 'dark') {
        // Search → project
        await page.fill('#search-input', 'Chancay');
        await page.waitForSelector('#search-results:not([hidden]) .search__item');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#detail-panel:not([hidden])');
        const title = await page.textContent('.detail__title');
        check(title?.includes('Chancay'), `[${tag}] search opens project panel ("${title}")`);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${outDir}/${tag}-project.png` });

        // Country via panel link
        await page.click('[data-select-country="PER"]');
        await page.waitForTimeout(1200);
        const ctitle = await page.textContent('.detail__title');
        check(ctitle === 'Peru', `[${tag}] country panel opens ("${ctitle}")`);
        await page.screenshot({ path: `${outDir}/${tag}-country.png` });
        await page.click('[data-close-detail]');

        // Click a marker directly on the map
        await page.evaluate(() => window.bri.store.set({ selection: null }));
        // Click the first marker that is actually visible and not covered by an overlay.
        const point = await page.evaluate(() => {
          for (const m of document.querySelectorAll('.leaflet-marker-icon')) {
            const r = m.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
            if (m.contains(document.elementFromPoint(x, y))) return { x, y };
          }
          return null;
        });
        check(point !== null, `[${tag}] a project marker is visible and clickable`);
        if (point) await page.mouse.click(point.x, point.y);
        await page.waitForSelector('#detail-panel:not([hidden])');
        check(true, `[${tag}] clicking a marker opens the panel`);
        await page.click('[data-close-detail]');

        // Timeline → 2014
        await page.evaluate(() => {
          const r = document.querySelector('#timeline-range');
          r.value = '2014';
          r.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForTimeout(400);
        const early = await page.locator('.leaflet-marker-icon .pm').count();
        const earlyParticipants = await page.locator('path.country--participant').count();
        check(early < markers, `[${tag}] timeline 2014 shows fewer projects (${early} < ${markers})`);
        check(earlyParticipants < participants, `[${tag}] timeline 2014 shows fewer participants (${earlyParticipants})`);
        await page.screenshot({ path: `${outDir}/${tag}-2014.png` });

        // AidData records: search, panel, country summary
        await page.evaluate(() => {
          const r = document.querySelector('#timeline-range');
          r.value = r.max;
          r.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.fill('#search-input', 'Souapiti');
        await page.waitForSelector('#search-results:not([hidden]) .search__item');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#detail-panel:not([hidden])');
        const kicker = await page.textContent('.detail__kicker');
        check(/AidData record #\d+/.test(kicker ?? ''), `[${tag}] search finds an AidData record ("${kicker?.trim()}")`);
        const recText = await page.textContent('#detail-body');
        check(/constant 2021 USD/.test(recText) && /Export-Import Bank of China/.test(recText), `[${tag}] record panel shows amount and lender`);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${outDir}/${tag}-record.png` });
        await page.click('[data-select-country]');
        await page.waitForFunction(() => document.querySelector('.detail__title')?.textContent === 'Guinea');
        const cText = await page.textContent('#detail-body');
        check(/AidData finance records/.test(cText) && /Chinese official loan or grant commitment/.test(cText), `[${tag}] country panel summarises AidData records`);
        await page.click('[data-close-detail]');
        const recCount = await page.evaluate(() => window.bri.data.records.length);
        check(recCount > 1000, `[${tag}] AidData records loaded (${recCount})`);
        // Canvas layer draws the record dots
        const canvasDrawn = await page.evaluate(() => {
          const c = document.querySelector('.leaflet-records-pane canvas');
          if (!c) return false;
          const ctx = c.getContext('2d');
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) return true;
          return false;
        });
        check(canvasDrawn, `[${tag}] AidData dots drawn on the map canvas`);

        // Filters: turn off rail
        if (await page.locator('#filters-panel[hidden]').count()) await page.click('#filters-toggle');
        await page.uncheck('input[data-layer="rail"]');
        const noRail = await page.locator('.pm--rail').count();
        check(noRail === 0 || (await page.locator('.leaflet-marker-icon .pm--rail').count()) === 0, `[${tag}] rail filter hides rail markers`);

        // Dashboard
        await page.locator('#dashboard').scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const dashText = await page.textContent('#dashboard');
        check(/AidData, 2013–/.test(dashText) && /Latest BRI engagement/.test(dashText) && /213\.5/.test(dashText), `[${tag}] dashboard shows AidData and 2025–2026 engagement sections`);
        const statCount = await page.locator('.stat').count();
        check(statCount >= 4, `[${tag}] dashboard stats rendered (${statCount})`);
        await page.locator('#dashboard').screenshot({ path: `${outDir}/${tag}-dashboard.png` });
      }

      // Explicit theme toggle
      await page.click(`[data-theme-option="${scheme === 'dark' ? 'light' : 'dark'}"]`);
      const toggled = await page.getAttribute('html', 'data-theme');
      check(toggled !== scheme, `[${tag}] theme toggle switches theme`);

      check(errors.length === 0, `[${tag}] no console/page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
