// What the Windows installer promises, checked rather than remembered.
//
// Every rule here was learned by getting it wrong on a real machine, and each
// of them fails in a way nobody would notice from the build log:
//
//   - the ORT exclusion shipped an app with no speech engine at all, and it
//     launched perfectly;
//   - a per-machine install would put a UAC prompt in front of every silent
//     background update, which means no updates and no error either;
//   - a missing arm64 target leaves Surface owners emulating x64, which works
//     and is slow exactly where Nami is a terminal.
//
// This reads the config. scripts/check-bundle.mjs reads the built app. They are
// not the same claim: a glob can behave differently from how it reads, and this
// file is the half that runs without a packaged build to look at.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = yaml.load(fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8'));

test('Windows is a target at all, as an installer rather than a loose exe', () => {
  assert.ok(config.win, 'no win: block — nothing builds for Windows');
  const targets = config.win.target.map((t) => (typeof t === 'string' ? t : t.target));
  assert.deepEqual(targets, ['nsis'],
    'a portable build cannot be replaced by the updater while the user is running it');
});

test('both architectures are built, so ARM64 Windows is not left emulating', () => {
  const archs = config.win.target.flatMap((t) => t.arch || []);
  assert.ok(archs.includes('x64'), 'x64 is most of Windows');
  assert.ok(archs.includes('arm64'), 'a Surface or Dev Kit would otherwise run the x64 build under emulation');
});

// The rule that makes auto-update possible. electron-updater installs in the
// background; an installer that needs administrator rights cannot, and the
// failure is silent — the update simply never happens.
test('the installer is per-user and never asks to elevate', () => {
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowElevation, false);
  assert.equal(config.nsis.oneClick, false, 'a one-click installer gives no choice of folder');
});

// An uninstall that takes the user's settings, keys and open desk with it is a
// decision, not a default — so it is written out rather than left to whatever
// electron-builder happens to do next release.
test('uninstalling does not delete what the user made', () => {
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
});

test('differential updates are on, so a point release is not a fresh 148 MB', () => {
  assert.equal(config.nsis.differentialPackage, true);
});

// The one that shipped broken. ${os} is an artifactName macro and is silently
// NOT substituted in a file pattern, so `!(${os})` matches every directory
// under it — the packaged app carried no onnxruntime binary at all, launched
// fine, and had no working dictation on a code path no test exercises.
test('the ORT exclusion uses a macro that file patterns actually substitute', () => {
  const ort = config.files.filter((f) => typeof f === 'string' && f.includes('onnxruntime-node/bin'));
  assert.ok(ort.length, 'nothing prunes the 209 MB of other-platform ORT binaries');
  for (const pattern of ort) {
    assert.ok(!pattern.includes('${os}'),
      `${pattern} — \${os} is not substituted in a file pattern; it matches everything and ships nothing`);
  }
  assert.ok(ort.some((p) => p.includes('${platform}')), 'the platform has to be named somehow');
  assert.ok(ort.some((p) => p.includes('${arch}')), 'and so does the architecture');
});

// Keeping the two file-association lists in step is the sort of thing that goes
// unnoticed until Windows offers Nami for a type macOS does not, or the reverse.
test('both platforms offer to open the same files, and only those', () => {
  const exts = (associations) => [...new Set(associations.flatMap((a) => a.ext))].sort();
  assert.deepEqual(exts(config.win.fileAssociations), exts(config.mac.fileAssociations));
});

test('the file associations match what the app actually opens', async () => {
  const { OPEN_EXT } = await import('../src/main/open-with.js').then((m) => m.default || m);
  const declared = [...new Set(config.win.fileAssociations.flatMap((a) => a.ext))].sort();
  assert.deepEqual(declared, [...OPEN_EXT].sort(),
    'electron-builder.yml and OPEN_EXT in open-with.js disagree about what Nami opens');
});

// The download button on nami.dainami.ai points at
// releases/latest/download/Nami-<arch>.<ext>, and that path resolves only if
// the newest release holds an asset with exactly that name.
test('the installer is named without a version, like the dmg', () => {
  assert.equal(config.artifactName, '${productName}-${arch}.${ext}');
});
