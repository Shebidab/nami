// Pulls the on-device Whisper weights into build/models so electron-builder can
// ship them inside the app. Without this the first dictation needs a network,
// which is exactly the thing the local engine exists to avoid.
// Run automatically before a package build; safe to re-run (it skips what it has).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const store = require('../src/main/stt-model.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'build', 'models');
const model = store.modelById(process.argv[2] || store.DEFAULT_MODEL);

console.log(`fetching ${model.repo} → ${path.relative(root, dir)}`);
const res = await store.ensureModel({
  dir, repo: model.repo,
  onProgress: ({ done, total, file }) => console.log(`  ${done}/${total} ${file}`),
});
console.log(res.cached ? 'already present' : 'done');

// electron-builder ships build/models whole, so anything else left in it goes
// into every installer. A checkout that built before the bundled model changed
// still holds the old one — 44 MB of whisper-tiny.en riding along unused.
for (const org of fs.readdirSync(dir, { withFileTypes: true })) {
  if (!org.isDirectory()) continue;
  for (const entry of fs.readdirSync(path.join(dir, org.name), { withFileTypes: true })) {
    if (`${org.name}/${entry.name}` === model.repo) continue;
    fs.rmSync(path.join(dir, org.name, entry.name), { recursive: true, force: true });
    console.log(`removed ${org.name}/${entry.name}, which this build does not ship`);
  }
}
