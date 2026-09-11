// The shell announcing that the command Nami typed into it has finished.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { doneSuffix, oneShotArgs, feedRunDone } = require('../src/main/run-done.js');

const SEQ = (code) => `\x1b]1337;NamiRunDone=${code}\x07`;

test('a finished command reports its exit code', () => {
  assert.equal(feedRunDone({}, 'installing…\n' + SEQ(0)), 0);
  assert.equal(feedRunDone({}, SEQ(1)), 1);
  assert.equal(feedRunDone({}, SEQ(127)), 127);
});

// The whole point of reading the code rather than assuming success: a failed
// install must never be announced as an agent that is ready to use.
test('a failure is a failure, not a zero', () => {
  const st = {};
  assert.equal(feedRunDone(st, 'curl: (6) Could not resolve host\n' + SEQ(6)), 6);
});

test('ordinary output says nothing', () => {
  const st = {};
  assert.equal(feedRunDone(st, 'downloading  ████  100%\n'), null);
  assert.equal(feedRunDone(st, '\x1b]0;⠐ Some session title\x07'), null);
  assert.equal(feedRunDone(st, '❯ '), null);
  assert.equal(feedRunDone(st, ''), null);
});

// pty chunks are whatever the kernel had ready. A 26-byte escape lands split
// across two reads often enough that a stateless parser would miss installs at
// random — the worst possible failure, because it looks like it works.
test('the sequence is still found when it straddles two chunks', () => {
  const seq = SEQ(0);
  for (let cut = 1; cut < seq.length; cut++) {
    const st = {};
    assert.equal(feedRunDone(st, 'done\n' + seq.slice(0, cut)), null, `cut at ${cut}`);
    assert.equal(feedRunDone(st, seq.slice(cut)), 0, `cut at ${cut}`);
  }
});

test('it survives being split three ways', () => {
  const seq = SEQ(42);
  const st = {};
  assert.equal(feedRunDone(st, seq.slice(0, 5)), null);
  assert.equal(feedRunDone(st, seq.slice(5, 11)), null);
  assert.equal(feedRunDone(st, seq.slice(11)), 42);
});

// A tile can stream megabytes before the command ends. The carry buffer holds
// only enough to reassemble one split escape.
test('the carry buffer does not grow with the output', () => {
  const st = {};
  for (let i = 0; i < 500; i++) feedRunDone(st, 'x'.repeat(1000));
  assert.ok(st.buf.length < 64, `carry grew to ${st.buf.length}`);
  assert.equal(feedRunDone(st, SEQ(0)), 0);
});

// ---- the other half: what the shell is actually asked to print -------------
// Asserting the parser against a string this file wrote proves nothing about
// whether a real shell emits it. So run it — on whichever shell this machine
// has. Both halves are written out in full rather than shared through a helper:
// the two shells disagree about almost everything (what a failure is, whether
// an exit code even exists, what survives a pipeline), and a helper would hide
// exactly the differences these tests exist to pin down.
const onWindows = process.platform === 'win32';
const unixOnly = { skip: onWindows && 'needs a POSIX shell' };
const windowsOnly = { skip: !onWindows && 'needs PowerShell under Windows' };

// One PowerShell run of the suffix, returning what it printed. -NoProfile so a
// developer's own profile cannot decide whether these pass.
function runPowerShell(command) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', doneSuffix(command, 'win32')];
  try {
    return execFileSync('powershell.exe', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    // a non-zero exit is an ordinary outcome here; what it printed is the point
    return e.stdout || '';
  }
}

test('a real zsh emits the sequence, with the real exit code', unixOnly, () => {
  for (const [cmd, want] of [['true', 0], ['false', 1], ['(exit 7)', 7], ['ls /nope/nope', 1]]) {
    const out = execFileSync('/bin/zsh', ['-c', doneSuffix(cmd, 'darwin')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal(feedRunDone({}, out), want, `for \`${cmd}\``);
  }
});

// The same claim, in the dialect that has neither $? nor a reliable exit code.
// A missing program and a failing cmdlet both leave $LASTEXITCODE unset, so
// without the $? half they would both report success — which is the failure
// this whole file exists to prevent.
test('a real PowerShell emits the sequence, with the real exit code', windowsOnly, () => {
  for (const [cmd, want] of [
    ['cmd /c exit 0', 0],
    ['cmd /c exit 7', 7],
    ['definitely-not-a-real-program-xyz', 1],
    ['Get-Item C:\\nope\\nope', 1],
  ]) {
    assert.equal(feedRunDone({}, runPowerShell(cmd)), want, `for \`${cmd}\``);
  }
});

// A command that ends the shell itself — a bare `exit`, or an installer that
// execs — never reaches the printf. Nothing is lost: killing the shell fires
// the pty's own exit, which the tile already listens to. Worth pinning so the
// gap stays a known one.
test('a command that ends the shell reports nothing here, and that is fine', unixOnly, () => {
  let out = '';
  try {
    execFileSync('/bin/zsh', ['-c', doneSuffix('exit 7', 'darwin')], { encoding: 'utf8' });
  } catch (e) { out = e.stdout || ''; }
  assert.equal(feedRunDone({}, out), null);
});

test('the same gap exists on Windows, and closes the same way', windowsOnly, () => {
  assert.equal(feedRunDone({}, runPowerShell('exit 7')), null);
});

test('a real zsh reports the failing stage of a pipeline', unixOnly, () => {
  // the shape an install actually has: fetch | interpreter
  const out = execFileSync('/bin/zsh', ['-c', doneSuffix('echo hi | grep -q nothing', 'darwin')], { encoding: 'utf8' });
  assert.equal(feedRunDone({}, out), 1);
});

test('nothing of the sequence is left visible in the output', unixOnly, () => {
  const out = execFileSync('/bin/zsh', ['-c', doneSuffix('echo installed', 'darwin')], { encoding: 'utf8' });
  assert.match(out, /installed/);
  // no literal escape text leaked into what the user reads
  assert.doesNotMatch(out, /printf|033|NamiRunDone=%s/);
});

test('nothing of the PowerShell sequence is left visible either', windowsOnly, () => {
  const out = runPowerShell('Write-Output installed');
  assert.match(out, /installed/);
  assert.doesNotMatch(out, /LASTEXITCODE|Console\]::Write/);
});

// The measurement that decided how much the exit code is worth. Four of the six
// install commands are `curl … | bash`, and `$?` after a pipeline is the status
// of its LAST stage — so a curl that never reached the host still leaves bash
// reading an empty script and exiting 0. The exit code cannot confirm an
// install; only the scan can, and finishAgentInstall treats it that way.
test('curl | bash reports zero even when curl failed', unixOnly, () => {
  const out = execFileSync('/bin/zsh', ['-c', doneSuffix('curl -fsS https://nope.invalid/x.sh | bash', 'darwin')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.equal(feedRunDone({}, out), 0, 'if this ever reports non-zero, the exit code became trustworthy');
});

// The Windows installs are `irm … | iex`, which is the same shape and carries
// the same caveat for a different reason: iex succeeding on an empty string is
// a success by every measure PowerShell has. Left as a network-free assertion
// about the parse rather than a live fetch — the point is the shape, and a test
// that needs the internet is a test that fails on a train.
test('a Windows install line still parses as one command with a suffix', () => {
  const suffix = doneSuffix('irm https://claude.ai/install.ps1 | iex', 'win32');
  assert.match(suffix, /^irm https:\/\/claude\.ai\/install\.ps1 \| iex; /);
  assert.match(suffix, /NamiRunDone/);
  assert.ok(!suffix.includes('"'), 'a nested double quote breaks the argv handed to CreateProcess');
});

// ---- spawned, not typed ----------------------------------------------------
// A pty echoes what is written into it, so a suffix TYPED onto the user's
// install line was printed back at them — measured in the running app as
// sentinelVisible: true. Spawning the command means nothing is echoed.
test('a one-shot is spawned with its command, so nothing is typed', () => {
  const args = oneShotArgs('/bin/zsh', 'curl -fsSL https://x/i.sh | bash', 'darwin');
  assert.equal(args[0], '-i');
  assert.equal(args[1], '-c');
  assert.match(args[2], /^curl -fsSL https:\/\/x\/i\.sh \| bash;/);
  assert.match(args[2], /NamiRunDone/);
  // and the tile is still a terminal afterwards, on a shell that re-read the
  // rc file the installer just wrote to
  assert.match(args[2], /exec \/bin\/zsh -i$/);
});

// Same three claims, Windows dialect. -NoExit is what `exec <shell> -i` is
// there for: the prompt survives the command. The PATH line is the other half
// of that — a Windows installer writes the registry, and nothing already
// running, child processes included, ever sees the write.
test('a Windows one-shot keeps its prompt and can run what it just installed', () => {
  const args = oneShotArgs('powershell.exe', 'npm install -g @openai/codex', 'win32');
  assert.ok(args.includes('-NoExit'), 'without it the tile is a corpse the moment the install ends');
  assert.equal(args[args.length - 2], '-Command');
  const script = args[args.length - 1];
  assert.match(script, /^npm install -g @openai\/codex; /);
  assert.match(script, /NamiRunDone/);
  assert.match(script, /\$env:Path = \[Environment\]::GetEnvironmentVariable\('Path','Machine'\)/);
});

test('spawned for real: the code is reported and the output survives', unixOnly, () => {
  const args = oneShotArgs('/bin/zsh', 'echo BEFORE; echo AFTER', 'darwin');
  const out = execFileSync('/bin/zsh', args.slice(0, 2).concat(args[2].replace(/; exec .*$/, '')), { encoding: 'utf8' });
  assert.equal(feedRunDone({}, out), 0);
  assert.match(out, /BEFORE/);
  assert.match(out, /AFTER/);
  // the command itself was never echoed — that is the whole point
  assert.doesNotMatch(out, /printf/);
});

test('spawned for real on Windows: the output survives and the code is right', windowsOnly, () => {
  const out = runPowerShell('Write-Output BEFORE; Write-Output AFTER');
  assert.equal(feedRunDone({}, out), 0);
  assert.match(out, /BEFORE/);
  assert.match(out, /AFTER/);
});

test('a failing spawned command still reports', unixOnly, () => {
  const args = oneShotArgs('/bin/zsh', 'ls /nope/nope', 'darwin');
  const body = args[2].replace(/; exec .*$/, '');
  const out = execFileSync('/bin/zsh', ['-i', '-c', body], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.equal(feedRunDone({}, out), 1);
});

test('a failing spawned command still reports on Windows', windowsOnly, () => {
  assert.equal(feedRunDone({}, runPowerShell('cmd /c exit 3')), 3);
});
