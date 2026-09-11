import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { userPath, mergePath, pathFromOutput, refreshUserPath, resetForTests } = require('../src/main/user-path.js');

// Platform is passed explicitly everywhere below, never left to default. These
// tests read as POSIX and were POSIX-only for as long as Nami was: run on
// Windows they all failed at once, because `/usr/bin` is not a path there and a
// colon is a drive letter rather than a separator. A test that only passes
// where it was written has stopped saying anything.
const UNIX = 'darwin';
const WIN = 'win32';

// A Dock-launched app is handed launchd's stump and nothing else. Everything
// here is about turning that back into the PATH the user actually has.
const LAUNCHD = '/usr/bin:/bin:/usr/sbin:/sbin';

test('the login shell wins, because its order is the user intent', () => {
  const merged = mergePath('/opt/homebrew/bin:/usr/bin', LAUNCHD, UNIX);
  assert.equal(merged.split(':')[0], '/opt/homebrew/bin');
});

test('nothing the process already had is dropped', () => {
  const merged = mergePath('/opt/homebrew/bin', '/only/here', UNIX);
  assert.ok(merged.split(':').includes('/only/here'));
});

test('a directory in both lists appears once', () => {
  const merged = mergePath('/usr/bin:/bin', LAUNCHD, UNIX);
  assert.equal(merged.split(':').filter((p) => p === '/usr/bin').length, 1);
});

test('empty segments never become an entry, which would mean "current directory"', () => {
  // a stray colon in PATH is a real security footgun: it resolves as "."
  const merged = mergePath('/a::/b:', ':/c', UNIX);
  assert.ok(merged.split(':').every(Boolean), merged);
});

test('a shell that says nothing leaves the process PATH untouched', () => {
  assert.equal(mergePath('', LAUNCHD, UNIX), LAUNCHD);
});

test('the PATH is read past whatever the rc file printed first', () => {
  assert.equal(pathFromOutput('nvm: v22\nhello\n/opt/homebrew/bin:/usr/bin\n', UNIX), '/opt/homebrew/bin:/usr/bin');
  assert.equal(pathFromOutput('just a greeting\n', UNIX), '');
  assert.equal(pathFromOutput('', UNIX), '');
});

test('userPath asks the shell once and reuses the answer', async () => {
  resetForTests();
  let calls = 0;
  const exec = async () => { calls++; return '/opt/homebrew/bin'; };
  const a = await userPath({ exec, env: { PATH: LAUNCHD }, platform: UNIX });
  const b = await userPath({ exec, env: { PATH: LAUNCHD }, platform: UNIX });
  assert.equal(calls, 1, 'the probe costs a second — it must not run per tile');
  assert.equal(a, b);
  assert.ok(a.startsWith('/opt/homebrew/bin'));
});

test('a shell that throws degrades to the PATH we already had, not to nothing', async () => {
  resetForTests();
  const out = await userPath({ exec: async () => { throw new Error('no tty'); }, env: { PATH: LAUNCHD }, platform: UNIX });
  assert.equal(out, LAUNCHD);
});

test('a shell that hangs and returns empty still yields a usable PATH', async () => {
  resetForTests();
  const out = await userPath({ exec: async () => '', env: { PATH: LAUNCHD }, platform: UNIX });
  assert.equal(out, LAUNCHD);
});

// One probe per app run is right for a PATH that does not move — and wrong for
// the one moment it does. An installer run inside Nami writes a PATH line into
// the rc file, and every tile opened afterwards was still being handed the
// answer from before the install, so an agent Nami had just installed could not
// be spawned until the app was restarted.
test('after an install the shell is asked again', async () => {
  resetForTests();
  let asked = 0;
  const answers = ['/usr/bin', '/Users/x/.local/bin:/usr/bin'];
  const exec = async () => answers[asked++] || '';
  assert.equal(await userPath({ exec, env: { PATH: '' }, platform: UNIX }), '/usr/bin');

  refreshUserPath();

  assert.equal(await userPath({ exec, env: { PATH: '' }, platform: UNIX }), '/Users/x/.local/bin:/usr/bin');
  assert.equal(asked, 2, 'the memo must actually have been dropped');
});

// ---- windows ----------------------------------------------------------------
// The same module doing the same job, with every literal in it different: the
// separator, what a path looks like, and whether two spellings of one directory
// are one directory.

const REG = 'C:\\Windows\\system32;C:\\Windows';
const USER_BIN = 'C:\\Users\\x\\.local\\bin';

test('windows splits on semicolons — a colon split would sever every drive letter', () => {
  const merged = mergePath(USER_BIN + ';' + REG, '', WIN);
  assert.deepEqual(merged.split(';'), [USER_BIN, 'C:\\Windows\\system32', 'C:\\Windows']);
});

// The registry writes a trailing backslash where the process environment does
// not, and Windows does not care about case. Left alone, every merge grows a
// second copy of half the PATH — and grows again on the next refresh.
test('windows treats two spellings of one directory as one directory', () => {
  const merged = mergePath('C:\\Program Files\\nodejs\\;' + USER_BIN, 'c:\\program files\\nodejs', WIN);
  assert.equal(merged.split(';').length, 2, merged);
  assert.equal(merged.split(';')[0], 'C:\\Program Files\\nodejs\\', 'the probe’s own spelling is kept');
});

test('a unix merge stays case-sensitive, because that filesystem is', () => {
  const merged = mergePath('/Users/X/bin', '/users/x/bin', UNIX);
  assert.equal(merged.split(':').length, 2);
});

test('the windows probe answer is read even when PowerShell wrote a warning first', () => {
  const out = 'WARNING: something\r\n' + USER_BIN + ';' + REG + '\r\n';
  assert.equal(pathFromOutput(out, WIN), USER_BIN + ';' + REG);
});

test('a single windows directory with no separator is still a PATH', () => {
  assert.equal(pathFromOutput(USER_BIN + '\r\n', WIN), USER_BIN);
});

test('a windows probe that only errored yields nothing rather than the error text', () => {
  assert.equal(pathFromOutput('The term is not recognized as the name of a cmdlet.\r\n', WIN), '');
});

test('a windows Nami launched with the lowercase spelling still finds its PATH', async () => {
  resetForTests();
  // node preserves whatever case the parent process used, and a shortcut can
  // genuinely hand over `Path` rather than `PATH`
  const out = await userPath({ exec: async () => '', env: { Path: REG }, platform: WIN });
  assert.equal(out, REG);
});
