import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Windows paths are built rather than typed. A literal backslash in a test file
// is one keystroke from a bogus escape sequence, and path.win32 is the same
// joiner the module under test uses.
const { win32: win } = await import('node:path');
const {
  loginShell, sessionShellCandidates, whichCommand, claudeCandidates, windowChrome,
  binSearchDirs, binExtensions, pathDelimiter, pathProbeCommand, unzipCommand,
} = require('../src/main/platform.js');

// The point of this module is that platform is a parameter, so the win32 branch
// can be exercised from a Mac. Every test passes it explicitly; none of them
// depend on where they run.

// zsh reads .zshrc only for *interactive* shells. `-lc` is login but not
// interactive, so every PATH line in .zshrc — which is where installers write,
// opencode and bun included — was invisible. It only ever worked when the app
// was started from a terminal and inherited that PATH; launched from the Dock
// there is nothing to inherit and the agent reads as "not installed".
test('detection runs an interactive login shell, so PATH from .zshrc counts', () => {
  const sh = loginShell('darwin', {});
  assert.equal(sh.file, '/bin/zsh');
  // separate flags, not a combined -lic: zsh and bash accept the bundle but
  // fish parses each flag on its own, and a fish user is a real user
  assert.deepEqual(sh.args('command -v claude'), ['-l', '-i', '-c', 'command -v claude']);
});

test('a bash or fish user is asked in their own shell, not zsh', () => {
  assert.equal(loginShell('darwin', { SHELL: '/bin/bash' }).file, '/bin/bash');
  assert.equal(loginShell('darwin', { SHELL: '/opt/homebrew/bin/fish' }).file, '/opt/homebrew/bin/fish');
});

test('an unusable $SHELL falls back to zsh rather than failing every probe', () => {
  // launchd does not always set SHELL for a GUI app, and /usr/bin/false is a
  // real login shell for locked accounts — neither may take the app down
  assert.equal(loginShell('darwin', {}).file, '/bin/zsh');
  assert.equal(loginShell('darwin', { SHELL: '/usr/bin/false' }).file, '/bin/zsh');
  assert.equal(loginShell('darwin', { SHELL: 'relative/zsh' }).file, '/bin/zsh');
});

test('windows runs powershell without a profile', () => {
  const sh = loginShell('win32', {});
  assert.equal(sh.file, 'powershell.exe');
  assert.deepEqual(sh.args('echo hi'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'echo hi']);
});

// The default ExecutionPolicy on a fresh Windows 10 desktop is Restricted. A
// probe that trips over it comes back empty, and empty is indistinguishable
// from "you have no agents installed" — which is what the first Windows
// machine this ran on reported, with every agent present.
test('the windows probe cannot be stopped by an execution policy', () => {
  assert.ok(loginShell('win32', {}).args('x').includes('Bypass'));
});

test('NAMI_SHELL overrides the probe shell, for a machine that has neither', () => {
  assert.equal(loginShell('win32', { NAMI_SHELL: 'C:\bin\pwsh.exe' }).file, 'C:\bin\pwsh.exe');
});

test('linux takes the unix branch rather than falling through to windows', () => {
  // Explicit env, because the default is process.env: this read the machine's
  // own $SHELL and so asserted zsh on a Mac and bash on a Linux CI runner. It
  // passed here for two months and failed the first time it ran anywhere else.
  assert.equal(loginShell('linux', {}).file, '/bin/zsh');
});

test('the unix branch prefers the shell the user actually has', () => {
  assert.equal(loginShell('linux', { SHELL: '/bin/bash' }).file, '/bin/bash');
});

test('"is it installed" asks each platform in its own dialect', () => {
  assert.equal(whichCommand('claude', 'darwin'), 'command -v claude');
  assert.match(whichCommand('claude', 'win32'), /Get-Command claude/);
});

test('the windows probe stays silent when the command is missing', () => {
  // a thrown PowerShell error would surface as a failed detection rather than
  // an honest "not installed", which is the whole bug this avoids
  assert.match(whichCommand('nope', 'win32'), /SilentlyContinue/);
});

test('an explicit CLAUDE_CODE_EXECUTABLE outranks every guess', () => {
  const out = claudeCandidates({ home: '/Users/x', env: { CLAUDE_CODE_EXECUTABLE: '/custom/claude' }, platform: 'darwin' });
  assert.equal(out[0], '/custom/claude');
});

test('mac looks in the installer location before the package managers', () => {
  const out = claudeCandidates({ home: '/Users/x', env: {}, platform: 'darwin' });
  assert.deepEqual(out, [
    '/Users/x/.local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/Users/x/.claude/local/claude',
  ]);
});

test('windows candidates use backslashes and .exe/.cmd', () => {
  const out = claudeCandidates({ home: 'C:\\Users\\x', env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, platform: 'win32' });
  assert.equal(out[0], 'C:\\Users\\x\\.local\\bin\\claude.exe');
  assert.ok(out.some((p) => p.endsWith('claude.cmd')), 'the npm -g install must still be findable');
  assert.ok(out.every((p) => !p.includes('/')), 'no forward slashes should leak into a windows path');
});

test('a missing APPDATA drops that candidate instead of producing a bogus path', () => {
  const out = claudeCandidates({ home: 'C:\\Users\\x', env: {}, platform: 'win32' });
  assert.ok(out.every((p) => p && !p.startsWith('\\')), 'undefined APPDATA must not become a root path');
});

test('claudeCandidates survives being called with nothing', () => {
  assert.doesNotThrow(() => claudeCandidates());
});

// The shell probe is the primary answer, but a .zshrc that prints a banner,
// errors without a tty, or is simply absent must not turn into "no agents
// installed". These are the places the six CLIs actually put themselves.
test('the fallback knows where each installer drops its binary', () => {
  const dirs = binSearchDirs({ home: '/Users/x', env: {}, platform: 'darwin' });
  for (const d of ['/Users/x/.local/bin', '/opt/homebrew/bin', '/usr/local/bin',
                   '/Users/x/.opencode/bin', '/Users/x/.bun/bin']) {
    assert.ok(dirs.includes(d), `${d} must be searched`);
  }
});

test('the fallback searches the running PATH first, then the known locations', () => {
  const dirs = binSearchDirs({ home: '/Users/x', env: { PATH: '/first:/second' }, platform: 'darwin' });
  assert.equal(dirs[0], '/first');
  assert.equal(dirs[1], '/second');
  assert.ok(dirs.includes('/opt/homebrew/bin'));
});

test('the fallback never returns the same directory twice', () => {
  const dirs = binSearchDirs({ home: '/Users/x', env: { PATH: '/opt/homebrew/bin' }, platform: 'darwin' });
  assert.equal(dirs.filter((d) => d === '/opt/homebrew/bin').length, 1);
});

test('windows splits PATH on semicolons, not colons', () => {
  const dirs = binSearchDirs({ home: 'C:\\Users\\x', env: { PATH: 'C:\\a;C:\\b' }, platform: 'win32' });
  assert.ok(dirs.includes('C:\\a') && dirs.includes('C:\\b'),
    'a colon split would turn C:\\a into "C" and "\\a"');
});

test('binSearchDirs survives being called with nothing', () => {
  assert.doesNotThrow(() => binSearchDirs());
});

test('mac gives the traffic lights Chrome-style air over the 22px deck', () => {
  assert.deepEqual(windowChrome('darwin'), {
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 11 },
  });
});

test('windows gets an overlay tinted to the paper header, not a system bar', () => {
  const c = windowChrome('win32');
  assert.equal(c.titleBarStyle, 'hidden');
  assert.equal(c.titleBarOverlay.color, '#fffdf6');   // --paper
  assert.equal(c.titleBarOverlay.symbolColor, '#2f2b26'); // --ink
});

// ---- the shell a tile is, as opposed to the one a probe uses ----------------
// Two different questions with two different answers, and conflating them is
// how a terminal tile ends up with no prompt, no aliases and no profile: the
// probe wants speed and silence, the tile is a shell the user reads and types
// into.

test('a tile keeps the user’s own shell, and falls back to one that exists', () => {
  assert.deepEqual(sessionShellCandidates({ platform: 'darwin', env: { SHELL: '/bin/bash' } }),
    ['/bin/bash', '/bin/zsh']);
  assert.deepEqual(sessionShellCandidates({ platform: 'darwin', env: {} }), ['/bin/zsh']);
});

test('windows prefers pwsh but always ends on one Windows 10 is guaranteed to have', () => {
  const list = sessionShellCandidates({ platform: 'win32', env: {} });
  assert.equal(list[0], 'pwsh.exe');
  assert.equal(list[list.length - 1], 'powershell.exe');
});

test('NAMI_SHELL wins for a tile too', () => {
  const bash = win.join('C:', 'msys64', 'bash.exe');
  assert.equal(sessionShellCandidates({ platform: 'win32', env: { NAMI_SHELL: bash } })[0], bash);
});

// ---- PATH -------------------------------------------------------------------

test('PATH is split and joined with each platform’s own delimiter', () => {
  assert.equal(pathDelimiter('darwin'), ':');
  assert.equal(pathDelimiter('win32'), ';');
});

// A Windows process never sees an edit to PATH made after it started, and an
// installer run inside a Nami tile is exactly that edit. $env:PATH would only
// echo back the stale copy we already hold, so the probe reads the registry —
// both halves, machine then user, which is the order Explorer joins them in.
test('the windows PATH probe reads the registry, not the process it runs in', () => {
  const cmd = pathProbeCommand('win32');
  assert.match(cmd, /GetEnvironmentVariable\('Path','Machine'\)/);
  assert.match(cmd, /GetEnvironmentVariable\('Path','User'\)/);
  assert.ok(!cmd.includes('$env:PATH'), 'the running process’s PATH is the stale answer');
});

test('the unix PATH probe prints the login shell’s own PATH', () => {
  assert.equal(pathProbeCommand('darwin'), 'printf %s "$PATH"');
});

// ---- executables ------------------------------------------------------------

// Every npm-installed CLI on Windows is a .cmd shim, and PATHEXT is what makes
// a bare `codex` find it. A scan that only stats the bare name reports half the
// registry as missing on a machine that has all of it.
test('windows looks for the shim extensions, unix for the bare name', () => {
  assert.deepEqual(binExtensions('darwin'), ['']);
  const exts = binExtensions('win32');
  for (const ext of ['.exe', '.cmd', '.bat']) assert.ok(exts.includes(ext), `${ext} must be tried`);
});

test('the windows fallback searches where each installer actually drops things', () => {
  const home = win.join('C:', 'Users', 'x');
  const dirs = binSearchDirs({
    home,
    env: { APPDATA: win.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: win.join(home, 'AppData', 'Local') },
    platform: 'win32',
  });
  for (const d of [win.join(home, '.local', 'bin'),
                   win.join(home, 'AppData', 'Roaming', 'npm'),
                   win.join(home, 'AppData', 'Local', 'Microsoft', 'WindowsApps'),
                   win.join(home, 'scoop', 'shims')]) {
    assert.ok(dirs.includes(d), `${d} must be searched`);
  }
  assert.ok(dirs.every((d) => !d.includes('/')), 'no forward slashes should leak into a windows path');
});

test('an empty environment never produces a bogus drive-root search path', () => {
  const dirs = binSearchDirs({ home: win.join('C:', 'Users', 'x'), env: {}, platform: 'win32' });
  // an undefined APPDATA joined blind gives "\npm", which is a real path on the
  // current drive and belongs to nobody
  assert.ok(dirs.every((d) => d && !d.startsWith(win.sep)));
});

// ---- unpacking a bundle -----------------------------------------------------
// Neither platform needs a dependency. tar.exe is bsdtar and has read zip since
// Windows 10 1803, which is below the floor Nami already sets for ConPTY.

test('each platform unpacks a .mcpb with what it already has', () => {
  assert.deepEqual(unzipCommand('/tmp/a.mcpb', '/tmp/out', 'darwin'),
    { file: '/usr/bin/unzip', args: ['-o', '-q', '/tmp/a.mcpb', '-d', '/tmp/out'] });
  const bundle = win.join('C:', 't', 'a.mcpb');
  const out = win.join('C:', 't', 'out');
  assert.deepEqual(unzipCommand(bundle, out, 'win32'),
    { file: 'tar.exe', args: ['-x', '-f', bundle, '-C', out] });
});

// ---- window chrome ----------------------------------------------------------

// The overlay is the one piece of window chrome CSS cannot repaint: Windows
// draws it itself, so a desk change has to be pushed to it or the buttons stay
// cream-on-cream over a graphite header.
test('the windows overlay takes the colour of the desk it opens on', () => {
  const c = windowChrome('win32', '#16161a', '#e8e4dc');
  assert.equal(c.titleBarOverlay.color, '#16161a');
  assert.equal(c.titleBarOverlay.symbolColor, '#e8e4dc');
});

test('a desk colour cannot smuggle traffic lights onto a Mac', () => {
  assert.equal(windowChrome('darwin', '#16161a').titleBarStyle, 'hiddenInset');
});
