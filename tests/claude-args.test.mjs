import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { claudeSpawnArgs, projectSlug } = require('../src/main/claude-args.js');

const SID = '00000000-0000-4000-8000-000000000007';

test('a fresh panel pins its own conversation id', () => {
  assert.deepEqual(claudeSpawnArgs({ cont: false, sid: SID, hasTranscript: false }), ['--session-id', SID]);
});

test('a restored panel resumes its OWN conversation, never --continue', () => {
  // this is the whole fix: four tiles restore as four conversations
  assert.deepEqual(claudeSpawnArgs({ cont: true, sid: SID, hasTranscript: true }), ['--resume', SID]);
});

test('a restored-but-never-used panel starts fresh keeping its id', () => {
  // --resume on a conversation with no transcript errors out of the CLI
  assert.deepEqual(claudeSpawnArgs({ cont: true, sid: SID, hasTranscript: false }), ['--session-id', SID]);
});

test('a legacy snapshot without an id falls back to --continue', () => {
  assert.deepEqual(claudeSpawnArgs({ cont: true, sid: null, hasTranscript: false }), ['--continue']);
});

test('no id, no restore: bare spawn', () => {
  assert.deepEqual(claudeSpawnArgs({ cont: false, sid: null, hasTranscript: false }), []);
});

test('a deliberately named tile pushes its name down into claude', () => {
  assert.deepEqual(claudeSpawnArgs({ cont: false, sid: SID, name: 'build: dark mode' }),
    ['--session-id', SID, '--name', 'build: dark mode']);
});

test('the name rides along on a resume too, so a rename sticks', () => {
  assert.deepEqual(claudeSpawnArgs({ cont: true, sid: SID, hasTranscript: true, name: 'db migration' }),
    ['--resume', SID, '--name', 'db migration']);
});

test('an unnamed tile spawns exactly as before — no empty --name', () => {
  assert.deepEqual(claudeSpawnArgs({ cont: false, sid: SID, name: '   ' }), ['--session-id', SID]);
  assert.deepEqual(claudeSpawnArgs({ cont: false, sid: SID }), ['--session-id', SID]);
});

test('projectSlug matches claude transcript folder naming', () => {
  assert.equal(projectSlug('/Users/dev/code/nami'), '-Users-dev-code-nami');
  assert.equal(projectSlug('/tmp/a.b_c'), '-tmp-a-b-c');
});

// ---- what actually gets typed on the fallback path -------------------------
// With no resolvable binary, Nami spawns a shell and types the claude command
// into it. That path used to be reached through a seed marker that made it type
// a bare `claude`, dropping --session-id, --resume and --name. The id was then
// never pinned, so the title watcher followed a transcript nothing wrote and
// the tile came back empty on the next launch.
const { shellQuote } = require('../src/main/claude-args.js');
// The typed-fallback cases below are POSIX quoting; the Windows dialect has a
// suite of its own at the foot of this file.
const unixQuote = (a) => shellQuote(a, 'darwin');
const typed = (o) => ['claude', ...claudeSpawnArgs(o)].map((a) => shellQuote(a, 'darwin')).join(' ');

test('the shell fallback types the whole command, not a bare claude', () => {
  assert.equal(
    typed({ sid: '00000000-0000-4000-8000-000000000008', cont: false, hasTranscript: false, name: null }),
    'claude --session-id 00000000-0000-4000-8000-000000000008',
  );
  assert.equal(
    typed({ sid: '90a00e7a', cont: true, hasTranscript: true, name: null }),
    'claude --resume 90a00e7a',
  );
  assert.equal(typed({ cont: true, sid: null }), 'claude --continue');
});

// A name is a sentence. Unquoted it arrives as four arguments and claude either
// errors or takes the first word as the name.
test('a multi-word session name survives being typed into a shell', () => {
  assert.equal(
    typed({ sid: 'abc', cont: false, hasTranscript: false, name: 'Add the export button' }),
    "claude --session-id abc --name 'Add the export button'",
  );
});

test('shellQuote leaves plain arguments alone and neutralises the rest', () => {
  assert.equal(unixQuote('--session-id'), '--session-id');
  assert.equal(unixQuote('/Users/x/.local/bin/claude'), '/Users/x/.local/bin/claude');
  assert.equal(unixQuote('two words'), "'two words'");
  assert.equal(unixQuote(''), "''");
  // nothing inside single quotes expands: no variable, no subshell, no glob
  assert.equal(unixQuote('$HOME'), "'$HOME'");
  assert.equal(unixQuote('`whoami`'), "'`whoami`'");
  assert.equal(unixQuote('a; rm -rf /'), "'a; rm -rf /'");
  assert.equal(unixQuote('*'), "'*'");
  // the one character single quotes cannot carry, closed and reopened
  assert.equal(unixQuote("Cal's button"), "'Cal'\\''s button'");
});

// The same job in the other shell. PowerShell has no backslash escape inside a
// single-quoted string — `'Cal'\''s button'` is not an escape there, it is an
// unterminated string followed by whatever the parser makes of the rest — so
// the quote is doubled instead. A session named "Cal's export button" is an
// ordinary thing to have, and this is the fallback path where the name is typed
// rather than passed as an argv entry.
test('the windows dialect doubles the quote rather than escaping it', () => {
  const winQuote = (a) => shellQuote(a, 'win32');
  assert.equal(winQuote('--session-id'), '--session-id');
  assert.equal(winQuote('two words'), "'two words'");
  assert.equal(winQuote(''), "''");
  assert.equal(winQuote("Cal's button"), "'Cal''s button'");
  // single quotes are literal in PowerShell too, so the same characters are
  // neutralised for the same reason
  assert.equal(winQuote('$HOME'), "'$HOME'");
  assert.equal(winQuote('a; rm -rf /'), "'a; rm -rf /'");
});
