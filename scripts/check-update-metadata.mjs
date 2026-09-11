// Refuse to publish a release whose update metadata is a lie.
//
// The metadata records a sha512 and size for each installer, and an
// auto-updater rejects any download that does not match. Both platforms change
// their artifacts after those numbers are written — macOS staples a
// notarization ticket to the dmg, Windows drops the both-architectures
// installer out of the list — so this has already been wrong twice, once
// silently, in a way that looked completely healthy right up until the first
// real update failed.
//
// Checks whichever metadata the build produced: latest-mac.yml, latest.yml, or
// both. Naming one of them by hand is how a platform goes unchecked without
// anybody noticing: the file it looked for is simply not there, and "nothing to
// check" reads as a broken build rather than as an unguarded one.
//
// Exits non-zero so CI stops before uploading. Correctness of this file is not
// visible in the artifact, only months later when nobody can update.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'release');

// latest-mac.yml, latest.yml, latest-linux.yml — whatever this build wrote.
const metadata = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => /^latest(-[a-z0-9]+)?\.yml$/.test(f)).sort()
  : [];

if (!metadata.length) {
  console.error('no latest*.yml in release/ — nothing to check, and nothing to update from');
  process.exit(1);
}

const problems = [];

for (const name of metadata) {
  console.log(`== ${name}`);
  const doc = yaml.load(fs.readFileSync(path.join(dir, name), 'utf8'));

  if (!doc || !Array.isArray(doc.files) || !doc.files.length) {
    problems.push(`${name}: lists no files`);
    continue;
  }

  for (const entry of doc.files) {
    const file = path.join(dir, entry.url);
    if (!fs.existsSync(file)) { problems.push(`${entry.url}: listed but not built`); continue; }
    const sha512 = createHash('sha512').update(fs.readFileSync(file)).digest('base64');
    const size = fs.statSync(file).size;
    let ok = true;
    if (entry.sha512 !== sha512) { problems.push(`${entry.url}: sha512 does not match the built file`); ok = false; }
    if (entry.size !== size) { problems.push(`${entry.url}: size ${entry.size} but the file is ${size}`); ok = false; }
    if (ok) console.log(`  ${entry.url}  sha512 + size correct`);
  }

  // The top-level pair is what electron-updater reads first; fixing the list and
  // forgetting this looks right and still fails every download. It also has to
  // name a file that is still IN the list — a `path` left pointing at an
  // artifact removed after the build is a download that 404s.
  if (doc.path) {
    const file = path.join(dir, doc.path);
    if (!doc.files.some((f) => f.url === doc.path)) {
      problems.push(`${name}: top-level path names ${doc.path}, which is not in its own file list`);
    } else if (!fs.existsSync(file)) {
      problems.push(`${name}: top-level path names ${doc.path}, which was not built`);
    } else {
      const sha512 = createHash('sha512').update(fs.readFileSync(file)).digest('base64');
      if (doc.sha512 !== sha512) problems.push(`${name}: top-level sha512 does not match ${doc.path}`);
      else console.log(`  top-level pair points at ${doc.path} and matches`);
    }
  }
}

if (problems.length) {
  console.error('\nupdate metadata is wrong — refusing to publish:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('\nupdate metadata describes exactly what will be uploaded');
