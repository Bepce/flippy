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
    await p.goto(URL);
    await p.waitForSelector('.fb-slot.right img');
    check(await p.$eval('.fb-pageno input', i => i.value) === '1', 'opens on the cover');
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1600);
    check(/p=2/.test(await p.evaluate(() => location.hash)), 'arrow key turns to pages 2-3');
    await p.click('.fb-slot.left .fb-hot[aria-label$=" 7"]'); await p.waitForTimeout(2600);
    check(/p=6/.test(await p.evaluate(() => location.hash)), 'contents link jumps to the spread with page 7');
    const href = await p.$eval('.fb-slot .fb-hot.swatch', a => a.href);
    check(/^https:\/\/example\.com\/hollowbrook\//.test(href), 'colour swatch links to the product');
    check(await p.$$eval('.fb-curl', c => c.length) === 0, 'no turning sheets left behind');

    // phone: one page, swipe
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const m = await ctx.newPage();
    m.on('pageerror', e => errors.push('phone: ' + e.message));
    await m.goto(URL + '#p=3');
    await m.waitForSelector('.fb-slot.right img');
    check(await m.$eval('.fb-book', b => b.classList.contains('single')), 'phone shows one page');
    const box = await m.$eval('.fb-stage', e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    await m.evaluate(([x, y, w, h]) => {
      const st = document.querySelector('.fb-stage'), o = { pointerId: 1, pointerType: 'touch', bubbles: true };
      st.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x + w * .8, clientY: y + h / 2 }));
      st.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x + w * .5, clientY: y + h / 2 }));
      st.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x + w * .2, clientY: y + h / 2 }));
    }, box);
    await m.waitForTimeout(1500);
    check(/p=4/.test(await m.evaluate(() => location.hash)), 'swipe turns the page');

    check(errors.length === 0, 'no script errors' + (errors.length ? ': ' + errors.join('; ') : ''));
    console.log('\nall checks passed');
  } catch (e) {
    console.error('\nFAILED: ' + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
