// Make the update metadata describe what will actually be uploaded.
//
// Two corrections, one per platform, and neither can be made during the build.
//
// macOS — stapling a notarization ticket to a dmg adds 2110 bytes, and
// electron-builder records each file's sha512 and size before that happens. An
// auto-updater checks every download against those numbers, so a stale entry
// does not slow an update down — it stops one ever working. This lived inside
// the afterAllArtifactBuild hook first, where it correctly rewrote the file and
// was then silently overwritten: electron-builder writes latest-mac.yml after
// the hook returns. Ordering you cannot see is ordering you cannot rely on.
//
// Windows — asking for two architectures gets three installers. Alongside
// Nami-x64.exe and Nami-arm64.exe, electron-builder writes a 291 MB Nami.exe
// carrying both, and lists it in latest.yml as `path` — the entry an updater
// falls back to when it cannot match a file to the machine it is running on.
// Nobody should download twice what they need, so it is deleted here and taken
// out of the metadata, leaving `path` on the x64 installer.
//
//   npm run dist    →  electron-builder && node scripts/fix-update-metadata.mjs
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { refreshUpdateMetadata } from './notarize-dmg.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'release');

if (!fs.existsSync(dir)) process.exit(0);

const built = fs.readdirSync(dir);
const dmgs = built.filter((f) => f.endsWith('.dmg')).map((f) => path.join(dir, f));

if (dmgs.length) {
  refreshUpdateMetadata(dmgs);
  // Say so either way. A silent pass here reads the same as a build that never
  // needed fixing, and those two cases must not look alike.
  const yml = path.join(dir, 'latest-mac.yml');
  if (!fs.existsSync(yml)) {
    console.log('update metadata: no latest-mac.yml in release/, nothing to correct');
  } else {
    console.log('update metadata: checked ' + dmgs.length + ' dmg(s) against latest-mac.yml');
  }
}

// ---- windows: drop the installer that carries both architectures -----------

const winYml = path.join(dir, 'latest.yml');
// Exactly this name, and only this name. The per-arch installers are
// Nami-x64.exe and Nami-arm64.exe; the combined one is the bare product name,
// which is also what artifactName would produce for a single-arch build — hence
// the check that both per-arch files are actually there before deleting it.
const COMBINED = 'Nami.exe';

if (fs.existsSync(winYml)) {
  const doc = yaml.load(fs.readFileSync(winYml, 'utf8'));
  const perArch = (doc && Array.isArray(doc.files) ? doc.files : []).filter((f) => /-(x64|arm64)\.exe$/.test(f.url));

  if (perArch.length < 2) {
    console.log(`update metadata: latest.yml lists ${perArch.length} per-arch installer(s) — leaving it alone`);
  } else {
    doc.files = perArch;
    // `path` and the top-level sha512 are what an updater reads first, and they
    // have to name a file that is still in the list. x64, because that is the
    // machine anything unable to identify itself is most likely to be.
    const fallback = perArch.find((f) => f.url.includes('x64')) || perArch[0];
    doc.path = fallback.url;
    doc.sha512 = fallback.sha512;
    fs.writeFileSync(winYml, yaml.dump(doc, { lineWidth: -1 }));

    for (const name of [COMBINED, COMBINED + '.blockmap']) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) { fs.rmSync(file); console.log(`update metadata: removed ${name}, which carried both architectures`); }
    }
    console.log(`update metadata: latest.yml now offers ${perArch.map((f) => f.url).join(' and ')}, path=${doc.path}`);

    // And prove it, rather than trusting the arithmetic above: every file the
    // metadata names must exist and hash to what it claims. This is the same
    // check check-update-metadata.mjs performs in CI, run here so a local
    // `npm run dist` cannot leave a broken release sitting on disk unnoticed.
    for (const entry of doc.files) {
      const file = path.join(dir, entry.url);
      const sha512 = createHash('sha512').update(fs.readFileSync(file)).digest('base64');
      if (sha512 !== entry.sha512 || fs.statSync(file).size !== entry.size) {
        console.error(`update metadata: ${entry.url} does not match what latest.yml says about it`);
        process.exit(1);
      }
    }
  }
}
