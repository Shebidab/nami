// The PATH the user actually has, as opposed to the one a GUI app is handed.
//
// On macOS: launched from a terminal, Electron inherits the shell's PATH and
// everything works. Launched from the Dock — which is how every user launches
// it — launchd hands the app `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else.
// No homebrew, no nvm, no bun, no ~/.local/bin. Every agent Nami then spawns
// inherits that stump, so tools the user definitely has installed are missing
// inside their own session, with no error that points at the cause.
//
// On Windows the stump problem does not exist — Explorer hands a launched app
// the full user environment — but its twin does, and it is worse because it
// looks like it is working. A Windows process is handed a *copy* of PATH at
// launch and never sees an edit to it again. An installer run inside a Nami
// tile writes the user half of the registry, broadcasts a settings change that
// only programs listening for it pick up, and the agent it just installed stays
// unspawnable for the life of the app. So both platforms ask the same question
// — what would a program the user started right now get? — and ask it of the
// place that actually knows: the login shell on Unix, the registry on Windows.
//
// One probe per app run: on Unix the shell is interactive (the only kind that
// reads .zshrc) and costs a second or two, which is fine once and unacceptable
// per tile.
const { execFile } = require('node:child_process');
const { loginShell, pathDelimiter, pathProbeCommand } = require('./platform.js');

// Keep whatever the probe reports, then append anything the running process has
// that it did not mention. Order matters — the probe's own precedence is the
// user's intent — and a dev run started from a terminal must not lose entries
// it was started with.
//
// Windows entries are compared case-insensitively and with any trailing
// separator dropped: the registry writes `C:\Program Files\nodejs\` where the
// process environment carries `C:\Program Files\nodejs`, and treating those as
// two directories makes every merged PATH grow a duplicate of itself.
function mergePath(probed, currentPath, platform = process.platform) {
  const sep = pathDelimiter(platform);
  const win = platform === 'win32';
  const key = (p) => (win ? p.replace(/[\\/]+$/, '').toLowerCase() : p);
  const parts = [];
  const seen = new Set();
  for (const list of [probed, currentPath]) {
    for (const p of String(list || '').split(sep).map((s) => s.trim()).filter(Boolean)) {
      const k = key(p);
      if (seen.has(k)) continue;
      seen.add(k);
      parts.push(p);
    }
  }
  return parts.join(sep);
}

// What the probe actually said, out of whatever else came back with it.
//
// On Unix an interactive shell may greet, warn, or print a version manager
// banner before it answers, so the PATH is the last line that looks like one.
// On Windows the answer is a single line, and the only thing that can precede
// it is a PowerShell error, which is not a PATH by any reading — so the last
// line carrying a separator or a drive letter is the one.
function pathFromOutput(stdout, platform = process.platform) {
  const lines = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const looksLikePath = platform === 'win32'
    ? (l) => /^[a-zA-Z]:[\\/]/.test(l) || l.includes(';')
    : (l) => l.startsWith('/');
  for (let i = lines.length - 1; i >= 0; i--) if (looksLikePath(lines[i])) return lines[i];
  return '';
}

// windowsHide, so the probe never flashes a console window over the desk. It is
// the default for a packaged Electron build and is not for `npm start`, which
// is exactly the sort of difference that gets shipped without being noticed.
function probe(platform = process.platform) {
  const sh = loginShell(platform);
  return new Promise((resolve) => {
    execFile(sh.file, sh.args(pathProbeCommand(platform)), { timeout: 8000, windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

let pending = null;
// Resolves to the PATH sessions should run with. Never rejects: a probe that
// fails to answer leaves the app exactly where it was, which is survivable,
// where a thrown error would take the terminal down with it.
//
// env.Path as well as env.PATH: Windows environment names are case-insensitive
// and node preserves whatever case the parent process used, so a Nami launched
// from a shortcut can genuinely arrive with the lowercase spelling.
function userPath({ exec = probe, env = process.env, platform = process.platform } = {}) {
  if (!pending) {
    pending = Promise.resolve()
      .then(() => exec(platform))
      .then((out) => mergePath(pathFromOutput(out, platform), env.PATH || env.Path, platform))
      .catch(() => String(env.PATH || env.Path || ''));
  }
  return pending;
}

// One probe per app run is right for a PATH that does not move — and wrong for
// the one moment it does. An installer run inside Nami writes a PATH line into
// .zshrc, or on Windows into HKCU\Environment, and every tile opened afterwards
// was still being handed the PATH from before the install. Detection did not
// care (it spawns a fresh login shell each time) but the adapters did: they
// spawn against this PATH, so an agent Nami had just installed was unspawnable
// until the app was restarted.
//
// So the memo is dropped when something changes it. The next userPath() asks
// again; nothing else has to know.
function refreshUserPath() { pending = null; }

// Tests need a clean slate; nothing in the app calls this.
function resetForTests() { pending = null; }

module.exports = { userPath, mergePath, pathFromOutput, refreshUserPath, resetForTests };
