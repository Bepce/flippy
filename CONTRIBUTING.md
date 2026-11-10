# Contributing to flippy

Thanks for helping. A few notes to keep things easy for everyone.

## Running it

```sh
python -m http.server 8080        # then open http://localhost:8080
```

The viewer source is `src/flippy.js` and `src/flippy.css`. The demo pages load the built
files in `dist/`, so after editing run:

```sh
npm run dist        # writes dist/ (readable and minified files); needs esbuild (npm install)
```

Commit `src/` and `dist/` together: the CDN and npm serve `dist/` straight from the repo.

## Testing

`tests/smoke.js` opens the demo in a desktop and a phone-sized browser and the embed
example, turns pages, checks the element, API, events and that host styles are untouched,
and fails on any script error:

```sh
npm install          # installs Playwright
npx playwright install chromium
python -m http.server 8080 &
npm test
```

`tests/builder.js` runs the builder end to end with the demo catalogue: auto-linking,
drawing, moving and resizing boxes, undo, preview, export, and reopening the zip
(`npm run test:builder`).

Please run them before opening a pull request.

## Guidelines

- **The builder** (`builder/`) is plain ES modules with no build step. It loads pdf.js and
  pdf-lib from jsDelivr at pinned versions; keep it working without a bundler.
- **Keep the viewer dependency-free** and readable without a build step: plain
  ES5-style JavaScript that runs in current browsers.
- **Test on a phone size**, not just desktop. Page turns, swipes and the toolbar must
  work at 390 px wide.
- **New interface languages** go in the `TEXT` table at the top of `src/flippy.js`
  (copy the `en` block) and the language list in README.md.
- **Keep the viewer's styles scoped** to `.fb` so it never changes the host page.
- **Don't commit catalogues you don't have the rights to.** The demo catalogue is
  invented on purpose.
- **One change per pull request**, with a short description of what and why. Screenshots
  or a short clip help for anything visual.

## Reporting bugs

Open an issue with the browser and device, what you did, what you expected, and what
happened. A screenshot or screen recording is the fastest way to a fix.

## Releases

1. Update the version in `package.json` and `Flippy.version` in `src/flippy.js`, and
   add a section to `CHANGELOG.md`.
2. `npm run dist`, `npm test`, commit.
3. Tag `vX.Y.Z` and push the tag; jsDelivr serves it at
   `https://cdn.jsdelivr.net/gh/Bepce/flippy@vX.Y.Z/dist/flippy.min.js`.
4. `npm publish --access public` (maintainers).
