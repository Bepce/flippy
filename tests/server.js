// flippy server end to end: setup, upload, public page and statistics, builder publishing,
// users and permissions. Starts its own PHP server with an empty data folder (needs php on
// the PATH), or tests the one at FLIPPY_SERVER_URL, which must be freshly installed.
// FLIPPY_LIBS: a node_modules folder with pdfjs-dist and pdf-lib, to run offline.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, spawn } = require('child_process');

const BASE = (process.env.FLIPPY_SERVER_URL || 'http://127.0.0.1:8091/').replace(/\/?$/, '/');
const LIBS = process.env.FLIPPY_LIBS;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'flippy-server-'));
let failed = 0;
const ok = (cond, name, extra) => { console.log((cond ? '  ok  ' : '  FAIL ') + name + (extra != null ? '  (' + extra + ')' : '')); if (!cond) failed++; };

// the demo catalogue folder as a zip, like the builder exports it
const ZIP = path.join(TMP, 'hollowbrook.zip');
execFileSync('python3', ['-c', `
import zipfile, os, sys
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as z:
    for r, d, fs in os.walk(src):
        for f in fs:
            p = os.path.join(r, f); z.write(p, 'hollowbrook/' + os.path.relpath(p, src))
`, path.join(ROOT, 'catalogues/hollowbrook'), ZIP]);

async function context(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, userAgent: UA, acceptDownloads: true });
  await ctx.route('https://example.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>shop</p>' }));
  if (LIBS) {
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/(pdfjs-dist|pdf-lib)@[^/]+\/(.*)$/, route => {
      const m = route.request().url().match(/npm\/(pdfjs-dist|pdf-lib)@[^/]+\/(.*)$/);
      route.fulfill({ path: path.join(LIBS, m[1], m[2]), contentType: 'text/javascript' });
    });
  }
  return ctx;
}
const ignorable = t => /Failed to load resource|status of 40[134]|status of 409|status of 429/.test(t);

let php = null;
async function startPhp() {
  if (process.env.FLIPPY_SERVER_URL) return;
  const data = path.join(TMP, 'data');
  php = spawn('php', ['-d', 'upload_max_filesize=300M', '-d', 'post_max_size=310M', '-S', '127.0.0.1:8091', path.join(ROOT, 'server/index.php')],
    { env: { ...process.env, FLIPPY_DATA_DIR: data }, stdio: ['ignore', 'ignore', 'pipe'] });
  php.stderr.on('data', d => { if (/Fatal|Warning|Parse error/.test(d)) console.log('  php: ' + String(d).trim()); });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + 'api/me')).ok) return; } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('PHP server didn’t start');
}
process.on('exit', () => php && php.kill());

(async () => {
  await startPhp();
  const browser = await chromium.launch();
  const ctx = await context(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text()); });
  const api = (p, opts = {}) => page.evaluate(async ([base, p, opts]) => {
    const me = await (await fetch(base + 'api/me')).json();
    const r = await fetch(base + 'api' + p, { method: opts.method || 'GET', headers: { 'X-CSRF-Token': me.csrf, 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    return { status: r.status, data: await r.json().catch(() => null) };
  }, [BASE, p, opts]);

  // setup
  await page.goto(BASE + 'admin/');
  await page.waitForSelector('text=Set up flippy');
  await page.fill('input[name=name]', 'Ada Admin');
  await page.fill('input[name=username]', 'ada');
  await page.fill('input[name=password]', 'short');
  await page.fill('input[name=password2]', 'short');
  await page.click('button[type=submit]');
  await page.waitForSelector('.err:not(:empty)');
  ok(/at least 10/.test(await page.textContent('.err')), 'setup rejects a short password');
  await page.fill('input[name=password]', 'a long admin password');
  await page.fill('input[name=password2]', 'a long admin password');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=No catalogues yet');
  ok(true, 'setup creates the first admin and signs in');
  ok((await api('/setup', { method: 'POST', body: { username: 'eve', password: 'another long password' } })).status === 409, 'setup can’t run twice');

  // upload
  await page.setInputFiles('input[type=file]', ZIP);
  await page.waitForSelector('.head h1', { timeout: 20000 });
  ok((await page.textContent('.head h1')).includes('Hollowbrook'), 'zip uploaded, catalogue page shown');
  ok(await page.locator('.head .badge', { hasText: 'Published' }).count() === 1, 'published by default');
  const embed = await page.textContent('pre.code');
  ok(embed.includes(BASE + 'c/hollowbrook/') && embed.includes('/dist/flippy.min.js'), 'embed code points at the server');

  // public page, as a visitor
  const visitor = await (await context(browser)).newPage();
  visitor.on('pageerror', e => errors.push('visitor: ' + e.message));
  await visitor.goto(BASE + 'c/hollowbrook/');
  await visitor.waitForSelector('.fb-book img');
  ok(await visitor.title() === 'Hollowbrook Goods · Autumn Collection', 'public page shows the catalogue');
  await visitor.evaluate(() => document.querySelector('.fb').flippy.go(3));
  await visitor.waitForTimeout(1600);
  const link = visitor.locator('.fb-hot[href*="field-mug"]').first();
  const [shop] = await Promise.all([visitor.context().waitForEvent('page'), link.click()]);
  await shop.close();
  await visitor.waitForTimeout(500);
  const cors = await visitor.evaluate(async u => (await fetch(u)).headers.get('access-control-allow-origin'), BASE + 'c/hollowbrook/catalogue.json');
  ok(cors === '*', 'catalogue files allow embedding on other sites (CORS)');
  const hidden = await visitor.evaluate(async u => (await fetch(u)).status, BASE + 'c/hollowbrook/flippy-project.json');
  ok(hidden === 404, 'project file is not public');

  // statistics
  await page.reload();
  await page.waitForSelector('.totals b');
  const totals = await page.$$eval('.totals b', b => b.map(x => x.textContent));
  ok(totals[0] === '1' && totals[1] === '1', 'view and product click counted', totals.join(' / '));
  ok(await page.locator('td.url a[href*="field-mug"]').count() === 1, 'clicked link listed');
  ok(await page.locator('.chart rect.v').count() === 30, 'chart has 30 days');
  await page.screenshot({ path: path.join(TMP, 'catalogue.png'), fullPage: true });
  const fake = await page.evaluate(async u => (await fetch(u, { method: 'POST', body: JSON.stringify({ e: 'click', u: 'https://spam.example/' }) })).status, BASE + 'api/hit?c=hollowbrook');
  const st = (await api('/catalogues/hollowbrook/stats?days=7')).data;
  ok(fake === 204 && st.links.length === 1, 'clicks on addresses not in the catalogue are ignored');

  // builder: open from the server, publish a copy, republish
  await page.goto(BASE + 'builder/?open=hollowbrook');
  await page.waitForFunction(() => window.flippyBuilder.project && window.flippyBuilder.project.pages.length === 12, null, { timeout: 60000 });
  ok(await page.locator('.actions a', { hasText: 'Library' }).count() === 1, 'builder opens a catalogue from the server');
  const links = await page.evaluate(() => window.flippyBuilder.project.pages.reduce((s, p) => s + p.links.length, 0));
  ok(links === 76, 'its links come along', links);
  await page.click('#export');
  await page.fill('#ex-folder', 'hollowbrook-copy');
  await page.dispatchEvent('#ex-folder', 'change');
  await page.click('#ex-publish');
  await page.waitForSelector('#toast:has-text("Published")', { timeout: 60000 });
  let list = (await api('/catalogues')).data.catalogues.map(c => c.slug).sort();
  ok(list.join() === 'hollowbrook,hollowbrook-copy', 'published from the builder', list.join());
  await page.click('#export');
  await page.click('#ex-publish');
  await page.waitForSelector('#toast:has-text("Published")', { timeout: 60000 });
  list = (await api('/catalogues')).data.catalogues;
  ok(list.length === 2, 'publishing again replaces it without asking');

  // hide, rename, delete
  await page.goto(BASE + 'admin/#/c/hollowbrook-copy');
  await page.click('button:has-text("Hide")');
  await page.waitForSelector('.head .badge.off');
  const anon = await (await browser.newContext()).newPage();
  ok((await anon.goto(BASE + 'c/hollowbrook-copy/')).status() === 404, 'a hidden catalogue is not public');
  ok((await page.goto(BASE + 'c/hollowbrook-copy/')).status() === 200, 'but signed-in users can still preview it');
  ok((await api('/catalogues/hollowbrook-copy', { method: 'PATCH', body: { slug: 'Bad Slug!' } })).status === 422, 'invalid address refused');
  ok((await api('/catalogues/hollowbrook-copy', { method: 'PATCH', body: { slug: 'hollowbrook' } })).status === 409, 'address already in use refused');
  ok((await api('/catalogues/hollowbrook-copy', { method: 'PATCH', body: { slug: 'winter' } })).data.catalogue.slug === 'winter', 'address changed');
  ok((await api('/catalogues/winter', { method: 'DELETE' })).status === 200 && (await api('/catalogues')).data.catalogues.length === 1, 'catalogue deleted');

  // users
  await page.goto(BASE + 'admin/#/users');
  await page.waitForSelector('form.inline-form');
  await page.fill('form.inline-form input[name=username]', 'eddie');
  await page.fill('form.inline-form input[name=name]', 'Eddie Editor');
  await page.fill('form.inline-form input[name=password]', 'editor password 123');
  await page.click('form.inline-form button[type=submit]');
  await page.waitForSelector('td:has-text("eddie")');
  ok(true, 'admin adds an editor');
  ok((await api('/users/1', { method: 'PATCH', body: { role: 'editor' } })).status === 422, 'the last admin can’t be demoted');
  await page.click('#logout');
  await page.waitForSelector('text=Sign in');
  await page.fill('input[name=username]', 'eddie');
  await page.fill('input[name=password]', 'editor password 123');
  await page.click('button[type=submit]');
  await page.waitForSelector('.grid .cat');
  ok(await page.locator('#nav-users').isHidden(), 'editor sees no Users menu');
  await page.screenshot({ path: path.join(TMP, 'library.png') });
  ok((await api('/users')).status === 403, 'editor can’t list users');
  ok((await api('/catalogues/hollowbrook', { method: 'PATCH', body: { title: 'Hollowbrook Autumn' } })).status === 200, 'editor can edit catalogues');
  const noCsrf = await page.evaluate(async () => (await fetch('../api/catalogues/hollowbrook', { method: 'DELETE' })).status);
  ok(noCsrf === 403, 'changes without the CSRF token are refused');

  // sign-in throttling
  await page.click('#logout');
  await page.waitForSelector('text=Sign in');
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push(await page.evaluate(async () => {
    const me = await (await fetch('../api/me')).json();
    return (await fetch('../api/login', { method: 'POST', headers: { 'X-CSRF-Token': me.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'mallory', password: 'guess' }) })).status;
  }));
  ok(codes[8] === 429 && codes[7] === 401, 'repeated failed sign-ins are paused', codes.join(' '));

  // private files
  for (const p of ['data/flippy.sqlite', 'lib/core.php', 'config.sample.php', 'index.php/../data/flippy.sqlite']) {
    const s = await page.evaluate(async u => (await fetch(u)).status, BASE + p);
    ok(s === 404, 'not served: ' + p, s);
  }

  ok(!errors.length, 'no script errors', errors.join(' | '));
  await browser.close();
  console.log('\n' + (failed ? failed + ' failed' : 'all checks passed') + '  (files in ' + TMP + ')');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
