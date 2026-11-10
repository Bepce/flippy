// Builds dist/ from src/: readable and minified viewer files plus the sounds.
//   npm run dist
// dist/ is committed, so the CDN (jsDelivr) and npm serve exactly these files.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const banner = `/*! flippy v${pkg.version} | MIT licence | https://github.com/Bepce/flippy */`;

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'sounds'), { recursive: true });

let js = fs.readFileSync(path.join(src, 'flippy.js'), 'utf8');
if (!js.includes(`version: '${pkg.version}'`)) {
  throw new Error(`src/flippy.js says a different version than package.json (${pkg.version}); update Flippy.version`);
}
const css = fs.readFileSync(path.join(src, 'flippy.css'), 'utf8');
fs.writeFileSync(path.join(dist, 'flippy.js'), banner + '\n' + js);
fs.writeFileSync(path.join(dist, 'flippy.css'), banner + '\n' + css);

const minJs = esbuild.transformSync(js, { minify: true, loader: 'js', target: 'es2017', legalComments: 'none' }).code;
const minCss = esbuild.transformSync(css, { minify: true, loader: 'css', legalComments: 'none' }).code;
fs.writeFileSync(path.join(dist, 'flippy.min.js'), banner + '\n' + minJs);
fs.writeFileSync(path.join(dist, 'flippy.min.css'), banner + '\n' + minCss);

for (const f of fs.readdirSync(path.join(src, 'sounds'))) {
  fs.copyFileSync(path.join(src, 'sounds', f), path.join(dist, 'sounds', f));
}

const zlib = require('zlib');
for (const f of ['flippy.min.js', 'flippy.min.css']) {
  const b = fs.readFileSync(path.join(dist, f));
  console.log(`${f.padEnd(16)} ${(b.length / 1024).toFixed(1)} kB, ${(zlib.gzipSync(b).length / 1024).toFixed(1)} kB gzipped`);
}
