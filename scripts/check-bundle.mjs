// Look inside the app that was actually built, not at the config that was
// meant to produce it.
//
// tests/repo-shape.test.mjs checks the rule: electron-builder.yml still says
// only src and package.json. This checks the result. They are not the same
// claim — a glob can behave differently from how it reads, a future
// electron-builder can change what a pattern means, and an extraResources or
// afterPack step can put a file in the bundle without going near files: at all.
//
// Run after packaging:  node scripts/check-bundle.mjs
// The release workflow runs it before publishing, so nothing a user can
// download has ever gone unexamined.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Everything the app needs to run, and nothing that merely helped build it.
const ALLOWED_TOP = new Set(['src', 'package.json', 'node_modules']);
// Named rather than inferred: these are the ones that would actually hurt or
// embarrass, so a failure can say which and why.
const MUST_NOT_SHIP = ['docs', 'tests', 'scripts', '.claude', '.opencode', '.github', 'assets', 'build'];
// A bundle can be wrong by being empty as easily as by being fat.
const MUST_SHIP = [
  'src/main/main.js', 'src/renderer/index.html', 'package.json',
];

// Every app.asar this build produced, whichever platform produced it.
//
// The two layouts are not alike, so they are written out rather than guessed
// at. macOS puts it inside a bundle, one directory per architecture:
//   release/mac-arm64/Nami.app/Contents/Resources/app.asar
// Windows has no bundle, and electron-builder names the x64 output without its
// architecture the way it does everywhere else:
//   release/win-unpacked/resources/app.asar
//   release/win-arm64-unpacked/resources/app.asar
function bundles() {
  const found = [];
  for (const [directory, macName] of [['release', 'Nami.app'], ['release-review', 'Nami Review.app']]) {
    const rel = path.join(ROOT, directory);
    if (!fs.existsSync(rel)) continue;
    for (const d of fs.readdirSync(rel)) {
      const file = d.startsWith('mac') ? path.join(rel, d, macName, 'Contents', 'Resources', 'app.asar')
        : d.startsWith('win') ? path.join(rel, d, 'resources', 'app.asar')
          : null;
      if (file && fs.existsSync(file)) found.push(file);
    }
  }
  return found;
}

const found = bundles();
if (!found.length) {
  console.error('No packaged app under release/. Run `npm run pack` first.');
  process.exit(1);
}

let asar;
try { asar = require('@electron/asar'); } catch (_) {
  console.error('@electron/asar is not installed. It ships with electron-builder; run `npm ci`.');
  process.exit(1);
}

let bad = 0;
for (const file of found) {
  // The directory electron-builder named for this slice: mac-arm64,
  // win-unpacked, and so on. Counted from the release root rather than from the
  // end, because the two layouts put the asar at different depths.
  const arch = path.relative(ROOT, file).split(path.sep)[1];
  console.log(`\n== ${arch}`);

  // listPackage returns every path inside, each leading with a separator — and
  // written with the separator of the machine that packed it, so an asar built
  // on Windows lists \src\main\main.js. MUST_SHIP is spelled the one way a path
  // is spelled in this file, so the entries are normalised to match it. Without
  // that, the check reported that the app could not run, about an app that ran.
  const entries = asar.listPackage(file)
    .map((e) => e.replace(/^[/\\]/, '').split('\\').join('/'));
  const top = [...new Set(entries.map((e) => e.split(/[/\\]/)[0]))].sort();
  console.log(`   ${entries.length} entries, top level: ${top.join(', ')}`);

  const strays = top.filter((t) => !ALLOWED_TOP.has(t));
  if (strays.length) { console.error(`   FAIL  should not be in the app: ${strays.join(', ')}`); bad++; }

  const named = MUST_NOT_SHIP.filter((d) => top.includes(d));
  if (named.length) { console.error(`   FAIL  private or build-only, now shipping: ${named.join(', ')}`); bad++; }

  const missing = MUST_SHIP.filter((f) => !entries.includes(f));
  if (missing.length) { console.error(`   FAIL  the app cannot run without: ${missing.join(', ')}`); bad++; }

  if (!strays.length && !named.length && !missing.length) console.log('   ok    only what it needs to run');
}

if (bad) {
  console.error(`\n${bad} problem${bad > 1 ? 's' : ''}. Not fit to publish.`);
  process.exit(1);
}
console.log(`\n${found.length} bundle${found.length > 1 ? 's' : ''} checked, both boundaries hold.`);
