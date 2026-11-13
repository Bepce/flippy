// Smoke test of the demo catalogue in a desktop and a phone-sized browser.
// Start a server first (python3 -m http.server 8080), then: npm test
// Set FLIPPY_URL to test another address.
const { chromium, devices } = require('playwright');
const URL = process.env.FLIPPY_URL || 'http://127.0.0.1:8080/';

function check(ok, msg) { if (!ok) throw new Error(msg); console.log('  ok  ' + msg); }

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  try {
    // desktop: two-page spreads
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL + 'demo.html');
    await p.waitForSelector('.fb-slot.right img');
    check(await p.$eval('.fb-pageno input', i => i.value) === '1', 'opens on the cover');
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1600);
    check(/p=2/.test(await p.evaluate(() => location.hash)), 'arrow key turns to pages 2-3');
    await p.click('.fb-slot.left .fb-hot[aria-label$=" 7"]'); await p.waitForTimeout(2600);
    check(/p=6/.test(await p.evaluate(() => location.hash)), 'contents link jumps to the spread with page 7');
    const href = await p.$eval('.fb-slot .fb-hot.swatch', a => a.href);
    check(/^https:\/\/example\.com\/hollowbrook\//.test(href), 'colour swatch links to the product');
    check(await p.$$eval('.fb-curl', c => c.length) === 0, 'no turning sheets left behind');

    // page number pill: shows the spread, takes a typed page
    check(await p.$eval('.fb-pageno input', i => i.value) === '6–7', 'page pill shows the spread (6–7)');
    await p.click('.fb-pageno input'); await p.keyboard.type('10'); await p.keyboard.press('Enter'); await p.waitForTimeout(1800);
    check(/p=10/.test(await p.evaluate(() => location.hash)), 'typing a page number and Enter goes there');

    // page panel: thumbnails at the side, the book makes room
    const before = await p.$eval('.fb-stage', b => b.getBoundingClientRect().left);
    await p.click('.fb-btn[aria-label="All pages"]'); await p.waitForTimeout(500);
    const after = await p.$eval('.fb-stage', b => b.getBoundingClientRect().left);
    check(await p.$$eval('.fb-thumb.current', t => t.map(x => x.dataset.n).join()) === '10,11' && after > before + 200, 'page panel opens beside the book, current pages marked');
    await p.click('.fb-thumb[data-n="4"]'); await p.waitForTimeout(1800);
    check(/p=4/.test(await p.evaluate(() => location.hash)) && await p.$eval('.fb', r => r.classList.contains('drawer-open')), 'thumbnail turns to its page, panel stays open on desktop');
    await p.click('.fb-btn[aria-label="All pages"]');

    // search: its own view with a focused box, results instead of thumbnails
    await p.click('.fb-btn[aria-label="Search"]'); await p.waitForTimeout(300);
    const sv = await p.evaluate(() => ({ focus: document.activeElement.type, thumbs: document.querySelector('.fb-drawer-list').hidden, title: document.querySelector('.fb-drawer-head h2').textContent }));
    check(sv.focus === 'search' && sv.thumbs && sv.title === 'Search', 'search button opens a search view, box focused');
    await p.keyboard.type('canvas'); await p.waitForTimeout(500);
    check(await p.$$eval('.fb-result b', r => r.map(x => x.textContent).join()) === 'Page 2,Page 5,Page 10', 'search finds the pages with the word');
    await p.keyboard.press('Enter'); await p.waitForTimeout(1800);
    check(/p=2/.test(await p.evaluate(() => location.hash)), 'Enter opens the first result');
    await p.fill('.fb-search input', '');
    await p.click('.fb-btn[aria-label="Search"]');

    // zoom: slider on hover, drag to pan, turning a page zooms back out
    await p.hover('.fb-zoomctl'); await p.waitForTimeout(250);
    check(await p.$eval('.fb-zoompop', e => getComputedStyle(e).opacity) === '1', 'zoom slider appears on hover');
    const hashBefore = await p.evaluate(() => location.hash);
    await p.$eval('.fb-zoombox input', i => { i.value = 250; i.dispatchEvent(new Event('input')); });
    await p.mouse.move(720, 400); await p.mouse.down(); await p.mouse.move(820, 450, { steps: 4 }); await p.mouse.up();
    const z = await p.evaluate(() => { const f = document.querySelector('.fb').flippy; return [f.zoomLevel, f.panX > 0, location.hash]; });
    check(z[0] === 2.5 && z[1] && z[2] === hashBefore, 'zoomed to 250%, dragging pans instead of turning');
    await p.keyboard.press('Escape');
    check(await p.evaluate(() => document.querySelector('.fb').flippy.zoomLevel) === 1, 'Escape zooms back out');

    // phone: one page, swipe
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const m = await ctx.newPage();
    m.on('pageerror', e => errors.push('phone: ' + e.message));
    await m.goto(URL + 'demo.html#p=3');
    await m.waitForSelector('.fb-slot.right img');
    check(await m.$eval('.fb-book', b => b.classList.contains('single')), 'phone shows one page');
    const shown = await m.$$eval('.fb-bar > *', els => els.filter(e => getComputedStyle(e).display !== 'none' && !e.hidden).length);
    check(shown === 6 && await m.$eval('.fb-bar', b => b.scrollWidth <= b.clientWidth), 'phone toolbar: back, page, next, pages, search, more');
    await m.click('.fb-btn[aria-label="More"]');
    await m.click('.fb-menu button:has-text("Show links")');
    check(await m.$eval('.fb', r => r.classList.contains('show-links')), 'links switched on from the More menu');
    await m.click('.fb-btn[aria-label="Search"]'); await m.waitForTimeout(400);
    await m.fill('.fb-search input', 'notebook'); await m.waitForTimeout(500);
    await m.click('.fb-result >> nth=0'); await m.waitForTimeout(1800);
    check(!(await m.$eval('.fb', r => r.classList.contains('drawer-open'))) && (await m.inputValue('.fb-pageno input')) !== '3', 'phone: search button next to the pages, a result turns to its page');
    await m.evaluate(() => document.querySelector('.fb').flippy.go(3)); await m.waitForTimeout(1800);
    await m.tap('.fb-zoombar button[aria-label="Zoom +"]');
    check(await m.evaluate(() => document.querySelector('.fb').flippy.zoomLevel) === 1.5, 'phone zoom bar zooms in');
    await m.tap('.fb-zoombar button[aria-label="Zoom −"]');
    const box = await m.$eval('.fb-stage', e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    await m.evaluate(([x, y, w, h]) => {
      const st = document.querySelector('.fb-stage'), o = { pointerId: 1, pointerType: 'touch', bubbles: true };
      st.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x + w * .8, clientY: y + h / 2 }));
      st.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x + w * .5, clientY: y + h / 2 }));
      st.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x + w * .2, clientY: y + h / 2 }));
    }, box);
    await m.waitForTimeout(1500);
    check(/p=4/.test(await m.evaluate(() => location.hash)), 'swipe turns the page');

    // <flip-book> inside an ordinary page: element, API, events, theme, no style leaks
    const e = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    e.on('pageerror', err => errors.push('embed: ' + err.message));
    await e.goto(URL + 'examples/embed.html');
    await e.waitForSelector('flip-book .fb-slot.right img');
    const host = await e.evaluate(() => ({ margin: getComputedStyle(document.body).marginTop, bg: getComputedStyle(document.body).backgroundColor,
      sizing: getComputedStyle(document.querySelector('main')).boxSizing }));
    check(host.margin === '0px' && host.bg === 'rgb(251, 248, 242)' && host.sizing === 'content-box', 'host page styles untouched');
    check(await e.$eval('flip-book', b => b.dataset.theme === 'light' && Math.round(b.getBoundingClientRect().height) === 640), 'element uses its theme and its own height');
    check(await e.evaluate(() => { const l = document.querySelectorAll('link[rel="stylesheet"][href*="flippy"]'); return l.length === 1 && /dist\/flippy\.min\.css/.test(l[0].href); }),
      'stylesheet added automatically, once, from next to the script');
    await e.click('text=Next ▶'); await e.waitForTimeout(1500);
    check((await e.$eval('#log', l => l.textContent)).includes('page: 2–3'), 'element.next() turns the page and fires flippy:page');
    check(await e.evaluate(() => location.hash) === '', 'hash="false" leaves the address alone');
    await e.click('text=Go to page 11'); await e.waitForTimeout(2600);
    check((await e.$eval('#log', l => l.textContent)).includes('page: 10–11'), 'element.go(11) jumps');
    await e.evaluate(() => { const b = document.querySelector('flip-book'); b.addEventListener('flippy:link', ev => { ev.stopPropagation(); }); });
    const linkUrl = await e.evaluate(() => new Promise(res => {
      document.querySelector('flip-book').addEventListener('flippy:link', ev => res(ev.detail.url), { once: true });
      const a = document.querySelector('flip-book .fb-slot .fb-hot.swatch'); a.addEventListener('click', ev => ev.preventDefault(), { once: true }); a.click();
    }));
    check(/hollowbrook\/.+utm_campaign=autumn-2026/.test(linkUrl), 'flippy:link reports the product URL');
    await e.evaluate(() => { const b = document.querySelector('flip-book'); b.setAttribute('lang', 'de'); });
    await e.waitForSelector('flip-book .fb-btn[aria-label="Weiter"]');
    check(true, 'changing lang re-renders in German');
    const left = await e.evaluate(() => { const b = document.querySelector('flip-book'); b.remove(); return document.querySelectorAll('.fb-curl, .fb-toast').length; });
    check(left === 0, 'removing the element cleans up');

    // JS API: Flippy.mount on any element, custom language
    const api = await e.evaluate(() => new Promise(res => {
      Flippy.addLanguage('sv', { next: 'Nästa', prev: 'Föregående' });
      const d = document.createElement('div'); d.style.height = '500px'; document.querySelector('main').appendChild(d);
      d.addEventListener('flippy:ready', ev => res({ pages: ev.detail.pageCount, next: d.querySelector('.fb-btn[aria-label="Nästa"]') !== null,
        grid: d.querySelector('.fb-btn[aria-label="All pages"]') !== null, version: Flippy.version }));
      Flippy.mount(d, { src: '../catalogues/hollowbrook/', lang: 'sv', hash: false, sound: false });
    }));
    check(api.pages === 12 && api.next && api.grid, 'Flippy.mount + addLanguage (missing texts fall back to English)');

    check(errors.length === 0, 'no script errors' + (errors.length ? ': ' + errors.join('; ') : ''));
    console.log('\nall checks passed');
  } catch (e) {
    console.error('\nFAILED: ' + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
