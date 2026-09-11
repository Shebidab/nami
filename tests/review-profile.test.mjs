import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReviewProfile, sweepOldProfiles } from '../src/main/review-profile.js';
import { win32 } from 'node:path';
import { abs } from './paths.mjs';

test('normal launches retain packaged and development profile paths', () => {
  for (const packaged of [true, false]) {
    const profile = createReviewProfile({ argv: [], normalPath: abs('normal'), packaged });
    assert.equal(profile.review, false);
    assert.equal(profile.path, packaged ? abs('normal') : abs('normal-dev'));
    profile.cleanup();
  }
});
test('every review flag gets a fresh disposable profile', () => {
  for (const flag of ['--demo', '--screenshot', '--scene=settings:look', '--theme=paper']) {
    const args = { argv: [flag], normalPath: abs('normal'), packaged: true };
    const first = createReviewProfile(args);
    const second = createReviewProfile(args);
    try {
      assert.equal(first.review, true);
      assert.notEqual(first.path, second.path);
      assert.ok(fs.statSync(first.path).isDirectory());
      fs.writeFileSync(path.join(first.path, 'settings.json'), '{}');
    } finally { first.cleanup(); second.cleanup(); }
    assert.equal(fs.existsSync(first.path), false);
    first.cleanup();
  }
});
test('explicit profiles are respected and never deleted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-profile-test-'));
  try {
    for (const argv of [['--user-data', dir], ['--demo', '--user-data', dir]]) {
      const profile = createReviewProfile({ argv, normalPath: abs('normal'), packaged: false });
      assert.equal(profile.path, dir);
      assert.equal(profile.review, argv.includes('--demo'));
      profile.cleanup();
      assert.ok(fs.existsSync(dir));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('persistent review storage is outside protected folders and survives cleanup', () => {
  const args={argv:['--review'],normalPath:abs('normal'),packaged:true,homePath:abs('Users', 'reviewer'),platform:'darwin'};
  const first=createReviewProfile(args),second=createReviewProfile(args);
  assert.equal(first.review,true);
  assert.equal(first.path,abs('Users', 'reviewer', 'Library', 'Application Support', 'Nami Review'));
  assert.equal(second.path,first.path);
  first.cleanup();
});
test('review launch refuses protected storage before touching it', () => {
  for (const folder of ['Desktop','Documents','Downloads']) {
    assert.throws(()=>createReviewProfile({argv:['--scene=browser','--user-data',`/Users/reviewer/${folder}/review`],normalPath:abs('normal'),packaged:true,homePath:abs('Users', 'reviewer')}),/Review data must be outside/);
  }
  const allowed=createReviewProfile({argv:['--review','--user-data',abs('Users', 'reviewer', 'Desktop-copy', 'review')],normalPath:abs('normal'),packaged:true,homePath:abs('Users', 'reviewer')});
  assert.equal(allowed.path,abs('Users', 'reviewer', 'Desktop-copy', 'review'));
});
test('double-clicking the review package remains isolated without flags', () => {
  const profile=createReviewProfile({argv:[],normalPath:abs('normal'),packaged:true,reviewBuild:true,homePath:abs('Users', 'reviewer'),platform:'darwin'});
  assert.equal(profile.review,true);
  assert.equal(profile.path,abs('Users', 'reviewer', 'Library', 'Application Support', 'Nami Review'));
  profile.cleanup();
});

// A persistent review profile goes where each platform keeps application data.
// Library/Application Support is a Mac path; on Windows it would create a
// literal `Library` folder in the user's home — a directory belonging to
// nothing, next to Documents, that nobody would recognise or clean up.
test('a persistent review profile lands where the platform keeps app data', () => {
  const win = createReviewProfile({
    argv: ['--review'], normalPath: abs('normal'), packaged: true,
    homePath: win32.join('C:', 'Users', 'reviewer'), platform: 'win32',
  });
  assert.match(win.path, /Nami Review$/);
  assert.ok(!win.path.includes('Library'), win.path);
  assert.ok(/Roaming|AppData/.test(win.path), win.path);
});

// Deleting a directory somebody still holds a handle on is an error on Windows,
// not a detail — and at quit time Chromium has not let go of the profile cache
// yet. Measured as EPERM on every review run before the retries went in. What
// must never happen is that the quit itself fails over it.
test('a disposable profile that cannot be deleted does not take the quit with it', () => {
  const profile = createReviewProfile({
    argv: ['--demo'], normalPath: abs('normal'), packaged: true, homePath: abs('Users', 'reviewer'),
  });
  fs.rmSync(profile.path, { recursive: true, force: true });   // pull it out from under the cleanup
  assert.doesNotThrow(() => profile.cleanup());
});

test('the sweep takes old disposable profiles and leaves a live one alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-sweep-test-'));
  try {
    const stale = path.join(dir, 'nami-review-stale');
    const live = path.join(dir, 'nami-review-live');
    const theirs = path.join(dir, 'someone-elses-folder');
    for (const d of [stale, live, theirs]) fs.mkdirSync(d);
    const old = Date.now() - 3 * 24 * 3600e3;
    fs.utimesSync(stale, new Date(old), new Date(old));

    const swept = sweepOldProfiles({ dir });
    assert.equal(swept, 1);
    assert.equal(fs.existsSync(stale), false, 'a profile from three days ago is nobody’s');
    assert.equal(fs.existsSync(live), true, 'a profile from this minute may be in use right now');
    assert.equal(fs.existsSync(theirs), true, 'nothing outside the naming scheme is touched');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
