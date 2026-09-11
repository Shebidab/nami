// Everything Nami assumes about the operating system, in one place.
//
// These assumptions used to be scattered as literals: '/bin/zsh' in four call
// sites, `command -v` inside a template string, three absolute paths where
// Claude Code might live, and a macOS-only titleBarStyle. Each was correct and
// each was invisible — nothing named them as platform decisions, so a port
// meant finding them by failure rather than by reading.
//
// Nami ships for macOS 13+ and for Windows 10 (1809+) and 11. Both columns are
// exercised: the release workflow builds and tests on each, and every entry
// below that names a path, a shell or a flag was checked on a real machine of
// that kind. Windows 10 is the floor rather than a nicety — ConPTY, which is
// what makes a real terminal tile possible at all, arrived in 1809, and the
// Windows column assumes it.
//
// Pure by design: no electron, no fs, no process spawning, and platform is
// always a parameter. That keeps it testable from `node --test`, which cannot
// pretend to be the other operating system any other way.

const path = require('path');

const WIN = 'win32';

// path.win32 / path.posix rather than a hand-rolled separator: the join rules
// differ by more than the character (a drive-relative 'C:x' is not 'C:\x'), and
// a table of install locations is exactly where that bites.
// Joining a path FOR a platform, which is not the same as joining one ON it.
// Every function here takes platform as an argument, and `path` alone would
// quietly use the running machine's rules — so a win32 answer computed on a Mac
// came back with forward slashes, and a darwin answer computed on Windows with
// backslashes. Both are wrong in the same invisible way.
const pathFor = (platform) => (platform === WIN ? path.win32 : path.posix);

// A shell so locked down it cannot run a startup file, so it can never tell us
// where anything is. These are real login shells for service and locked
// accounts, and picking one would silently break every probe.
const DEAD_SHELLS = new Set(['/usr/bin/false', '/bin/false', '/usr/sbin/nologin', '/sbin/nologin', '/usr/bin/true', '/bin/true']);

// The PATH separator, which is the one piece of path handling node's `path`
// module will not do for you — `delimiter` is the running platform's, not the
// one being asked about, and every probe here parses a PATH for a platform
// passed in as an argument.
function pathDelimiter(platform = process.platform) { return platform === WIN ? ';' : ':'; }

// Windows PowerShell ships in the box on every Windows 10 and 11 install;
// PowerShell 7 (pwsh) is a separate download that many developers do have.
// Nothing here checks which is present — this module does no I/O — so callers
// that can stat the disk take the first that exists, and the last entry is
// always one Windows is guaranteed to have.
const WIN_SHELLS = ['pwsh.exe', 'powershell.exe'];

// The shell used to ask the user's own environment a question — "is claude on
// your PATH", "add this MCP server". On Unix it must be a login shell AND an
// interactive one. Login alone is not enough: zsh reads .zshrc only when
// interactive, and .zshrc is where installers write their PATH lines — bun,
// opencode and nvm among them. With `-lc` those lines are never read, so a
// Dock-launched Nami (which inherits no PATH at all) reported perfectly
// well-installed agents as missing. Started from a terminal it looked fine,
// because the inherited PATH was covering for it.
function loginShell(platform = process.platform, env = process.env) {
  if (platform === WIN) {
    // -NoProfile is deliberate and differs from the Unix branch: a Windows
    // PATH lives in the registry, not in a startup file, so a profile can only
    // slow the probe down (a Set-PSReadLineOption-heavy profile costs the best
    // part of a second) without changing the answer. -NonInteractive and a
    // Bypass policy matter more than they look: the default ExecutionPolicy on
    // a fresh Windows 10 desktop is Restricted, and a probe that trips over it
    // reports every agent as missing rather than failing in a way anyone sees.
    return {
      file: (env && env.NAMI_SHELL) || 'powershell.exe',
      args: (cmd) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
    };
  }
  // Ask people in their own shell — a bash user's PATH lives in .bashrc, and
  // zsh would never read it. Anything that is not plainly an absolute path to a
  // usable shell falls back, since launchd does not always set SHELL for a GUI
  // app and a wrong guess costs every detection.
  const shell = String((env && env.SHELL) || '');
  const file = shell.startsWith('/') && !DEAD_SHELLS.has(shell) ? shell : '/bin/zsh';
  return { file, args: (cmd) => ['-l', '-i', '-c', cmd] };
}

// The shell a terminal tile actually is — a different question from the probe
// above, and it gets a different answer. This one the user reads and types
// into, so it keeps its profile (that is where their prompt, aliases and
// completions live) and it is never told to be non-interactive.
//
// Returns candidates, best first, because picking between pwsh and Windows
// PowerShell needs the disk and this module does not touch it. The last entry
// always exists: /bin/zsh on a Mac, powershell.exe on Windows.
function sessionShellCandidates({ platform = process.platform, env = process.env } = {}) {
  const override = env && env.NAMI_SHELL;
  if (platform === WIN) return [override, ...WIN_SHELLS].filter(Boolean);
  const shell = String((env && env.SHELL) || '');
  const own = shell.startsWith('/') && !DEAD_SHELLS.has(shell) ? shell : '';
  return [override, own, '/bin/zsh'].filter(Boolean);
}

// Where to look when the shell probe comes back empty — a .zshrc that prints a
// banner, refuses to run without a tty, or does not exist must degrade to a
// worse answer, never to "you have no agents installed". The running PATH goes
// first (it is the truth when Nami *was* started from a terminal), then the
// documented install location of each CLI we know about.
function binSearchDirs({ home = '', env = {}, platform = process.platform } = {}) {
  const win = platform === WIN;
  const p = pathFor(platform);
  const join = (...parts) => (parts.every(Boolean) ? p.join(...parts) : '');
  const fromPath = String((env && env.PATH) || (env && env.Path) || '').split(pathDelimiter(platform));
  const known = win ? [
    join(home, '.local', 'bin'),                        // claude's install.ps1, uv, and friends
    join(env.APPDATA, 'npm'),                           // npm -g shims (.cmd)
    join(env.LOCALAPPDATA, 'Programs'),
    join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'), // winget shims
    // Where each agent's own Windows installer says it puts things. Checked
    // against the vendors' Windows pages 2026-09-11, and each one is a real
    // directory on a machine that ran that installer — the PATH above usually
    // answers first, and this is what stands in when it cannot.
    join(home, '.grok', 'bin'),                   // x.ai/cli/install.ps1
    join(env.LOCALAPPDATA, 'agy', 'bin'),         // antigravity.google/cli/install.ps1
    join(env.LOCALAPPDATA, 'hermes'),             // NousResearch install.ps1
    join(env.LOCALAPPDATA, 'hermes', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.deno', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.claude', 'local'),
    join(home, 'scoop', 'shims'),
    join(env.ProgramData, 'chocolatey', 'bin'),
  ] : [
    join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.opencode', 'bin'),   // opencode.ai/install
    join(home, '.bun', 'bin'),        // bun-installed CLIs
    join(home, '.cargo', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.claude', 'local'),
    '/usr/bin',
  ];
  return [...new Set([...fromPath, ...known].filter(Boolean))];
}

// The file extensions a program can wear on this platform. Windows resolves a
// bare `claude` through PATHEXT, so a scan that only ever stats the bare name
// misses the .cmd shim every npm-installed CLI actually is.
function binExtensions(platform = process.platform) {
  return platform === WIN ? ['.exe', '.cmd', '.bat', '.ps1', ''] : [''];
}

// "Is this command installed, and where?" — printing the resolved path or
// nothing at all. Must stay silent on failure: a missing agent is an ordinary
// answer here, not an error.
function whichCommand(bin, platform = process.platform) {
  // Get-Command finds functions and aliases too, and .Source is empty for
  // those; Application-only keeps the answer to things that can be spawned.
  if (platform === WIN) return `(Get-Command ${bin} -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source`;
  return `command -v ${bin}`;
}

// The command that prints the PATH a program the user launched by hand would
// get. See user-path.js for why a GUI app cannot simply read its own.
//
// Windows keeps PATH in the registry in two halves — the machine's and the
// user's — and Explorer hands a launched app the two joined. A process already
// running does not see an edit to either until it restarts, which is exactly
// the case that matters: an installer run inside a Nami tile writes the user
// half, and the next tile has to find what it installed. Reading the registry
// is that answer; $env:PATH would only echo the stale copy we already have.
function pathProbeCommand(platform = process.platform) {
  if (platform === WIN) {
    return "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + "
      + "[Environment]::GetEnvironmentVariable('Path','User')";
  }
  return 'printf %s "$PATH"';
}

// Where a logged-in Claude Code install lands. Order matters: an explicit
// CLAUDE_CODE_EXECUTABLE always wins, then the official installer's location,
// then package managers. Returns candidates only — the caller checks existence,
// because this module does no I/O.
function claudeCandidates({ home = '', env = {}, platform = process.platform } = {}) {
  const p = pathFor(platform);
  const join = (...parts) => (parts.every(Boolean) ? p.join(...parts) : '');
  if (platform === WIN) {
    return [
      env.CLAUDE_CODE_EXECUTABLE,
      join(home, '.local', 'bin', 'claude.exe'),   // native installer (install.ps1)
      join(home, '.local', 'bin', 'claude.cmd'),
      join(env.APPDATA, 'npm', 'claude.cmd'),      // npm -g
      join(env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe'),
      join(home, '.claude', 'local', 'claude.exe'),
      join(home, '.bun', 'bin', 'claude.exe'),
    ].filter(Boolean);
  }
  return [
    env.CLAUDE_CODE_EXECUTABLE,
    join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(home, '.claude', 'local', 'claude'),
  ].filter(Boolean);
}

// Unpacking a .mcpb bundle, which is a zip. Neither platform needs a
// dependency for this: macOS has /usr/bin/unzip, and Windows 10 1803 and later
// ship bsdtar as tar.exe, which reads zip. `-o` on unzip overwrites without
// asking; tar overwrites by default and needs no equivalent.
function unzipCommand(file, dest, platform = process.platform) {
  if (platform === WIN) return { file: 'tar.exe', args: ['-x', '-f', file, '-C', dest] };
  return { file: '/usr/bin/unzip', args: ['-o', '-q', file, '-d', dest] };
}

// Window chrome. macOS hides the title bar but keeps the traffic lights inset
// over our own header; Windows has no equivalent, so it gets a hidden frame
// with an overlay tinted to match the paper header rather than a system bar
// sitting on top of the design.
//
// The overlay colour is repainted per theme once the renderer says which desk
// it is on (see window:theme in main.js) — this is only the colour the frame
// wears for the few hundred milliseconds before the first paint, so it matches
// the same backgroundColor the BrowserWindow is created with.
function windowChrome(platform = process.platform, background = '#fffdf6', symbol = '#2f2b26') {
  if (platform === WIN) {
    return { titleBarStyle: 'hidden', titleBarOverlay: { color: background, symbolColor: symbol, height: 38 } };
  }
  // The sheet is edge-to-edge, so the renderer reserves a 22px lights deck at
  // the top (see .lights-deck in paper.css). y gives the 12px buttons 11px of
  // air above, Chrome-style; they overhang the deck's foot by 1px, which still
  // clears the topbar's centred content by ~11px.
  return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 11 } };
}

module.exports = {
  loginShell, sessionShellCandidates, whichCommand, claudeCandidates, windowChrome,
  binSearchDirs, binExtensions, pathDelimiter, pathProbeCommand, unzipCommand, WIN_SHELLS,
  pathFor,
};
