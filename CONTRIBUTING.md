# Contributing to flippy

Thanks for helping. A few notes to keep things easy for everyone.

## Running it

```sh
python -m http.server 8080        # then open http://localhost:8080
```

The viewer has no build step: edit `viewer/viewer.js` or `viewer/viewer.css` and reload.

## Testing

`tests/smoke.js` opens the demo in a desktop and a phone-sized browser, turns pages,
follows a contents link and a product link, and fails on any script error:

```sh
npm install          # installs Playwright
npx playwright install chromium
python -m http.server 8080 &
npm test
```

Please run it before opening a pull request that touches the viewer.

## Guidelines

- **Keep the viewer dependency-free** and readable without a build step: plain
  ES5-style JavaScript that runs in current browsers.
- **Test on a phone size**, not just desktop. Page turns, swipes and the toolbar must
  work at 390 px wide.
- **New interface languages** go in the `TEXT` table at the top of `viewer/viewer.js`
  (copy the `en` block).
- **Don't commit catalogues you don't have the rights to.** The demo catalogue is
  invented on purpose.
- **One change per pull request**, with a short description of what and why. Screenshots
  or a short clip help for anything visual.

## Reporting bugs

Open an issue with the browser and device, what you did, what you expected, and what
happened. A screenshot or screen recording is the fastest way to a fix.
