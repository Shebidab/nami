// "Did the command Nami typed into that shell finish, and how did it go?"
//
// A kind:'run' tile is a real interactive login shell with a command written
// into it. That is deliberate — it sources the user's rc file, it can ask for a
// sudo password, and it stays alive afterwards so the output can be read. The
// cost is that the shell, not Nami, owns the command: pty exit only fires when
// the *shell* dies, which for an install is usually never. So the install tile
// sat at a prompt with nothing in the app knowing the install had finished, and
// the user was told to go and press ⌘N.
//
// The shell can just say. Appending a printf to the command makes it announce
// its own exit code the moment it lands:
//
//   curl … | bash; printf '\033]1337;NamiRunDone=%s\007' "$?"
//
// OSC 1337 is a private-use operating system command. xterm.js parses and
// discards handlers it does not know, so nothing appears in the tile — the same
// channel Nami already reads claude's session titles from (osc-title.js), used
// the other way round.
//
// `;` and not `&&`, so a failed install still reports.
//
// What the code is worth, measured rather than assumed: `$?` after a pipeline
// is the status of its LAST stage. Four of the six install commands are
// `curl … | bash`, and a curl that fails outright still leaves bash reading an
// empty script and exiting 0 — verified against a real pty, unreachable host,
// exit 0. So a zero here means "the shell got to the end", not "it worked".
// Only the scan can say an agent was installed, and the caller treats it that
// way. A non-zero, on the other hand, is always real.
//
// `set -o pipefail` would sharpen this, and is deliberately not used: it would
// mean running the user's command in a subshell with options they did not
// choose, to improve a message that is already backed by something better.
//
// One gap, deliberately left: a command that ends the shell itself — a bare
// `exit`, an installer that execs — never reaches the printf. That case kills
// the pty, which fires term:exit, which the tile already listens to. Two
// signals, no hole between them.
//
// Pure: main.js owns the pty, this owns the parsing.

const { pathProbeCommand } = require('./platform.js');

const OPEN = ']1337;NamiRunDone=';
const DONE_RE = /\]1337;NamiRunDone=(-?\d{1,5})(?:|\\)/;

// The suffix appended to a run command.
//
// Unix: single-quoted so the shell expands nothing in it; "$?" quoted so an
// empty status cannot swallow the argument.
//
// PowerShell has no $? meaning what $? means in sh, so it takes two variables.
// $LASTEXITCODE is the exit code of the last NATIVE program and is $null until
// one has run — a missing command, or a cmdlet that failed, never sets it. $?
// is the boolean "did the last statement succeed", and it is read FIRST,
// because reading $LASTEXITCODE into a variable is itself a statement that
// succeeds and would set $? to true before we could look at it. Measured under
// a real ConPTY: `cmd /c exit 7` → 7, a missing program → 1, a failing cmdlet
// → 1, an ordinary pipeline → 0. That is sharper than the Unix branch manages
// (see the pipeline note above), and the caller still treats a zero as "the
// shell reached the end", never as "it worked".
//
// No double quote appears anywhere in the PowerShell form, on purpose: the
// whole suffix is handed to CreateProcess as one argv entry, node-pty wraps
// that entry in double quotes, and a nested one is where it goes wrong.
function doneSuffix(command, platform = process.platform) {
  if (platform === 'win32') {
    return `${command}; $ok = $?; $c = $LASTEXITCODE; if ($null -eq $c) { if ($ok) { $c = 0 } else { $c = 1 } }; `
      + "[Console]::Write([char]27 + ']1337;NamiRunDone=' + $c + [char]7)";
  }
  return `${command}; printf '\\033]1337;NamiRunDone=%s\\007' "$?"`;
}

// The suffix cannot be TYPED into an interactive shell, which is how a run tile
// used to be driven: a pty echoes its input, so the user watched Nami's own
// printf scroll past on the end of their install line. Measured in the real
// app — sentinelVisible: true — and unacceptable in a tile people read.
//
// So a one-shot is spawned with the command instead of sent it. Nothing is
// typed, so nothing is echoed, and the tile shows only what the command
// printed. The caller writes the `$ command` header itself, straight to the
// renderer, so the tile still says what it is running.
//
// The tail is what keeps the tile a terminal afterwards rather than a corpse,
// and on both platforms it does one more thing: it leaves you at a prompt that
// can run what was just installed, which the shell that ran the install could
// not.
//
//   Unix     `exec <shell> -i` — a fresh interactive shell, so it re-reads the
//            rc file the installer just wrote a PATH line into.
//   Windows  -NoExit, plus a re-read of PATH out of the registry. There is no
//            rc file to source: a Windows installer writes HKCU\Environment,
//            and no already-running process — nor any child it spawns, which
//            inherits the same stale copy — ever sees that write. Pulling both
//            halves of the registry PATH back into $env:Path is the only thing
//            that has here the effect `exec` has there.
function oneShotArgs(shell, command, platform = process.platform) {
  if (platform === 'win32') {
    return ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command',
      `${doneSuffix(command, platform)}; $env:Path = ${pathProbeCommand(platform)}`];
  }
  return ['-i', '-c', `${doneSuffix(command, platform)}; exec ${shell} -i`];
}

// Feed one chunk of pty output. Returns the exit code once, or null.
//
// Stateful because a 12-byte escape can straddle two reads — pty chunks are
// whatever the kernel had ready, not lines. `st` is a per-session { buf }
// scratchpad owned by the caller, exactly like feedOscTitle's { last }.
function feedRunDone(st, chunk) {
  const s = String(chunk || '');
  if (!s) return null;
  // Only carry a tail long enough to hold a split sequence. Without this cap a
  // long-running tile would accumulate every byte it ever printed.
  const buf = (st.buf || '') + s;
  const m = DONE_RE.exec(buf);
  if (m) {
    st.buf = '';
    const code = Number(m[1]);
    return Number.isFinite(code) ? code : 0;
  }
  const keep = OPEN.length + 8;
  st.buf = buf.length > keep ? buf.slice(-keep) : buf;
  return null;
}

module.exports = { doneSuffix, oneShotArgs, feedRunDone, DONE_RE };
