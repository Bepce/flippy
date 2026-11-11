// Builder end to end: demo PDF in, auto-link, edit, preview, export, reopen.
// Needs the repo served (python -m http.server 8080) and Playwright.
// pdf.js and pdf-lib load from jsDelivr; set FLIPPY_LIBS to a node_modules folder that has
// pdfjs-dist and pdf-lib to serve them locally instead (for offline runs).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');

const BASE = (process.env.FLIPPY_URL || 'http://127.0.0.1:8080/').replace(/\/?$/, '/');
const LIBS = process.env.FLIPPY_LIBS;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'flippy-builder-'));
let failed = 0;
const ok = (cond, name, extra) => { console.log((cond ? '  ok  ' : '  FAIL ') + name + (extra ? '  (' + extra + ')' : '')); if (!cond) failed++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  if (LIBS) {
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/(pdfjs-dist|pdf-lib)@[^/]+\/(.*)$/, (route) => {
      const m = route.request().url().match(/npm\/(pdfjs-dist|pdf-lib)@[^/]+\/(.*)$/);
      const file = path.join(LIBS, m[1], m[2]);
      route.fulfill({ path: file, contentType: 'text/javascript' });
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // the builder asks ../api/me whether a flippy server is there; on a static site that's a 404
  page.on('console', m => { if (m.type() === 'error' && !(/status of 404/.test(m.text()) && /api\/me/.test(m.location().url || ''))) errors.push(m.text()); });

  await page.goto(BASE + 'builder/');
  await page.click('#demo');
  await page.waitForFunction(() => window.flippyBuilder.project && document.querySelector('#editor:not([hidden])'), null, { timeout: 60000 });
  const n = await page.evaluate(() => window.flippyBuilder.project.pages.length);
  ok(n === 12, 'demo PDF read', n + ' pages');
  const pdfLinks = await page.evaluate(() => window.flippyBuilder.project.pages.reduce((s, p) => s + p.links.length, 0));
  ok(pdfLinks === 3 * 9 || pdfLinks > 0, 'links already in the PDF kept', pdfLinks + ' links');

  await page.click('#run');
  const result = await page.textContent('#result');
  ok(/49 codes found, 49 linked/.test(result), 'auto-link finds and links all 49 codes', result.trim());
  const overlaps = await page.evaluate(() => {
    let o = 0;
    for (const pg of window.flippyBuilder.project.pages) {
      const a = pg.links.filter(l => l.auto);
      for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
        const p = a[i], q = a[j];
        if (Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 0.001 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 0.001) o++;
      }
    }
    return o;
  });
  ok(overlaps === 0, 'no overlapping auto boxes', overlaps + ' overlaps');

  // go to page 3 and check boxes are drawn
  await page.click('#thumbs .thumb:nth-child(3)');
  const boxes = await page.locator('#sheet .box').count();
  ok(boxes > 0, 'boxes drawn on page 3', boxes + ' boxes');

  // draw a new box on page 1
  await page.click('#thumbs .thumb:nth-child(1)');
  const before = await page.locator('#sheet .box').count();
  const r = await page.locator('#sheet').boundingBox();
  await page.mouse.move(r.x + r.width * 0.1, r.y + r.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.18, { steps: 5 });
  await page.mouse.up();
  ok(await page.locator('#sheet .box').count() === before + 1, 'draw a box');
  ok(await page.evaluate(() => document.activeElement.id) === 'l-url', 'address field focused after drawing');
  await page.keyboard.type('https://example.com/hollowbrook/');
  await page.keyboard.press('Tab');
  const drawn = await page.evaluate(() => window.flippyBuilder.project.pages[0].links.at(-1));
  ok(drawn.url === 'https://example.com/hollowbrook/' && drawn.w > 0.15, 'new box has the address');

  // move it, then undo the move, then redo
  const b = await page.locator('#sheet .box.sel').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 40, { steps: 4 }); await page.mouse.up();
  const moved = await page.evaluate(() => window.flippyBuilder.project.pages[0].links.at(-1).x);
  await page.keyboard.press('Control+z');
  const undone = await page.evaluate(() => window.flippyBuilder.project.pages[0].links.at(-1).x);
  await page.keyboard.press('Control+Shift+z');
  const redone = await page.evaluate(() => window.flippyBuilder.project.pages[0].links.at(-1).x);
  ok(Math.abs(undone - drawn.x) < 1e-6 && Math.abs(redone - moved) < 1e-6 && moved > drawn.x, 'move, undo, redo');

  // resize with a handle
  const sel = await page.locator('#sheet .box.sel .h.se').boundingBox();
  const w0 = await page.evaluate(() => window.flippyBuilder.project.pages[0].links.at(-1).w);
  await page.mouse.move(sel.x + 5, sel.y + 5); await page.mouse.down(); await page.mouse.move(sel.x + 45, sel.y + 25, { steps: 3 }); await page.mouse.up();
  ok(await page.evaluate(() => window.flippyBuilder.project.pages[0].links.at(-1).w) > w0, 'resize with a handle');

  // a page link
  await page.click('[data-target=page]');
  await page.fill('#l-page', '5');
  ok(await page.evaluate(() => window.flippyBuilder.project.pages[0].links.at(-1).page) === 5, 'switch a box to a page link');

  // missing address: code without a URL shows in the list
  await page.click('#thumbs .thumb:nth-child(3)');
  await page.evaluate(() => {
    const l = window.flippyBuilder.project.pages[2].links.find(x => x.auto);
    window.__code = l.code;
  });
  const code = await page.evaluate(() => window.__code);
  await page.click('[data-filter=all]');
  const input = page.locator(`#code-list input[data-code="${code}"]`);
  await input.fill('');
  await input.press('Tab');
  await page.click('[data-filter=missing]');
  ok(await page.locator(`#code-list input[data-code="${code}"]`).count() === 1, 'emptied code listed as needing an address');
  await page.locator(`#code-list input[data-code="${code}"]`).fill('https://example.com/fixed');
  await page.locator(`#code-list input[data-code="${code}"]`).press('Tab');
  ok(await page.evaluate(c => window.flippyBuilder.project.pages.flatMap(p => p.links).filter(l => l.code === c).every(l => l.url === 'https://example.com/fixed'), code), 'address from the codes list applied to every box of that code');

  await page.screenshot({ path: path.join(OUT, 'editor.png') });

  // preview
  await page.click('#preview');
  await page.waitForSelector('#pv-book.fb', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('#pv-book.fb img').length > 0);
  await page.waitForTimeout(600);
  const pvLinks = await page.locator('#pv-book .fb-hot').count();
  ok(pvLinks > 0, 'preview shows the flipbook with links', pvLinks + ' links');
  await page.screenshot({ path: path.join(OUT, 'preview.png') });
  await page.click('#pv-close');
  ok(await page.locator('#pv-book.fb').count() === 0, 'preview closes');

  // export
  await page.click('#export');
  await page.fill('#ex-folder', 'hollowbrook-test');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#ex-zip')]);
  const zipPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(zipPath);
  ok(dl.suggestedFilename() === 'hollowbrook-test.zip', 'zip downloaded', zipPath);

  // reopen the zip
  await page.click('.brand');
  await page.waitForSelector('#start:not([hidden])');
  await page.waitForSelector('#projects .proj', { timeout: 5000 }).catch(() => {});
  ok(await page.locator('#projects .proj').count() >= 1, 'project listed on the start screen');
  await page.setInputFiles('#file', zipPath);
  await page.waitForFunction(() => window.flippyBuilder.project && window.flippyBuilder.project.folder === 'hollowbrook-test', null, { timeout: 60000 });
  const reopened = await page.evaluate(() => ({
    links: window.flippyBuilder.project.pages.reduce((s, p) => s + p.links.length, 0),
    auto: window.flippyBuilder.project.pages.reduce((s, p) => s + p.links.filter(l => l.auto).length, 0),
    table: window.flippyBuilder.project.settings.table.length
  }));
  ok(reopened.auto === 49 && reopened.table > 0, 'zip reopens with codes and settings', JSON.stringify(reopened));

  ok(!errors.length, 'no script errors', errors.join(' | '));
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'zip-path.txt'), zipPath);
  console.log('\n' + (failed ? failed + ' failed' : 'all checks passed') + '  (files in ' + OUT + ')');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
