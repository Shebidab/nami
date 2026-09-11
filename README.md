<div align="center">

# Nami for Windows

### Put the world's best AI agents to work.

One workspace for all of them. Say what you need in plain English and watch it get done.

**A Windows 10 and 11 port of [Nami](https://github.com/mrdainami/nami) by [Cal](https://dainami.ai/links).**

**[↓ Download for Windows](https://github.com/Shebidab/nami/releases/latest)**

Windows 10 (1809+) and 11 · x64 and ARM64 · free and open source
On a Mac? The original is over [there](https://github.com/mrdainami/nami/releases/latest), signed and notarised by Apple.

</div>

![Four sessions running on the Nami desk](docs/media/hero.jpg)

> **What this fork is.** Nami is Cal's — free, MIT, and built by one person so
> that anyone, not just engineers, can put AI agents to work. It shipped for
> macOS, and the README there said "Windows is coming". This is that: the same
> app, made true on Windows. Nothing about the design, the desk or the agents
> was changed.
>
> If Nami earns a place on your desk, star **[the original
> project](https://github.com/mrdainami/nami)**. Its README says the star is the
> only thing that helps other people find it, and that is still true — the work
> is Cal's, this port only carries it to another operating system.

## What it is

Nami is a desk for AI agents. You open one folder on your computer, ask for
something in plain English, and an agent gets to work in its own pane — while
three others do something else beside it.

Nothing happens behind your back.

## Run any of the top agents in one click

![Claude Code, Codex and Gemini ready; OpenCode, Hermes and Kimi one click away](docs/media/agents.jpg)

No more downloading ten different tools only to switch again next week. A better
agent ships next month? Swap it in a click and keep working.

It runs on the subscriptions you already pay for — no Nami account, no second bill.

## A morning of work in the time one job used to take

Every job runs in its own pane, all at the same time. One agent writes your
emails, another ships your pricing page, a third sorts the invoices, a fourth
plans your month. One screen, and you are watching all of it.

## Describe an agent. Get an agent.

![Describing an agent in plain words, and the finished agent ready to run](docs/media/new-agent.jpg)

Say what you want in plain words and seconds later it is on your shelf, ready to
run. Same for skills and connections. Notion, Gmail and Slack connect in one click.

## Four desks

<table>
  <tr>
    <td width="50%"><img src="docs/media/desk-glass.jpg" alt="Glass desk"><br><b>Glass</b> — light and airy</td>
    <td width="50%"><img src="docs/media/desk-paper.jpg" alt="Paper desk"><br><b>Paper</b> — ink and cream</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/media/desk-operator.jpg" alt="Operator desk"><br><b>Operator</b> — dark ops</td>
    <td width="50%"><img src="docs/media/desk-graphite.jpg" alt="Graphite desk"><br><b>Graphite</b> — glass at night</td>
  </tr>
</table>

## Your files never leave your machine

Nami only ever looks inside the one folder you point it at. Dictation runs on
your own machine, so it works on a fresh install with no account, no key and no
network — that is true on Windows too, and was checked in a packaged build
rather than assumed.

## Get started

1. **[Download the installer](https://github.com/Shebidab/nami/releases/latest)** —
   `Nami-x64.exe`, or `Nami-arm64.exe` on a Surface or Dev Kit.
2. **Run it.** It installs for you alone, in your own profile, and never asks
   for administrator rights — which is also what lets it update itself later
   without a UAC prompt.
3. **Point it at one folder** you work in. It never looks outside it.
4. **Ask for something.** It finds the agents you already have.

Find your way around with **Shortcuts** at the bottom right of the app, or read
the [shortcuts and gestures reference](docs/shortcuts.md).

The installer is not code-signed yet, so Windows SmartScreen shows
"Windows protected your PC" the first time. **More info → Run anyway**, or build
it yourself from source below — the build is reproducible from a clean checkout.

## What the port actually changed

Nothing you can see, which is the point. What differs between the two operating
systems now lives in two files, and in both of them the platform is an argument
rather than an ambient fact, so either column can be tested from the other machine:

- **`src/main/platform.js`** — which shell a session is, where each agent's
  binary lands, how PATH is read, window chrome, how a `.mcpb` is unpacked.
- **`src/renderer/keys.mjs`** — how a shortcut is written down. ⌘K on a Mac,
  Ctrl+K on a PC, each in its own modifier order, plus Finder/Explorer.

The things that needed real work rather than a table entry:

| | |
| --- | --- |
| **Terminal** | Agents run in PowerShell over ConPTY, which is why Windows 10 1809 is the floor. Exit codes come back through the same OSC sentinel the Mac build uses, rewritten in a dialect PowerShell has — verified against a live ConPTY. |
| **PATH** | A Windows process never sees a PATH edit made after it started, so an agent installed inside a tile was unspawnable until restart. Nami reads the registry instead. |
| **Installing agents** | All seven carry a first-party Windows install command, checked against each vendor's own Windows page. None is WSL wearing a native hat. |
| **Dictation** | Whisper runs on-device exactly as it does on a Mac — no account, no key, no network. Verified in a packaged build. |
| **Updates** | NSIS per-user install, differential downloads, one installer per architecture. |

Two things deliberately left as they are, and said out loud rather than hidden:
Chrome **cookie** import is off on Windows (it needs DPAPI, where macOS needs
the Keychain — history and passwords still import), and the installer's
publisher reads as the upstream author until the original project decides
otherwise. Both are written down beside the code they affect.

The port is covered by the same suite as everything else: **1234 tests, run on
both operating systems in CI**. A hundred and fifty of them failed the first
time they ran on Windows.

## Build it yourself

```bash
git clone https://github.com/Shebidab/nami.git
cd nami
npm install
npm start
```

Contributor notes are in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Who makes this

Nami is made by [Cal](https://dainami.ai/links?utm_source=github&utm_medium=readme),
and made **in Nami** — every release on the original project's page was built in
the app you are looking at. The design, the desk, the agents and the four
themes are all theirs.

This fork is the Windows port and nothing else. Bugs in the Windows build
belong [here](https://github.com/Shebidab/nami/issues); everything about what
Nami *is* belongs [upstream](https://github.com/mrdainami/nami).

**Want Nami for your team?** Custom builds, managed deployment, or Nami wired
into your own stack — [dainami.ai](https://dainami.ai/?utm_source=github&utm_medium=readme&utm_campaign=teams)
or [cal@dainami.ai](mailto:cal@dainami.ai).

MIT licensed, as the original is · [nami.dainami.ai](https://nami.dainami.ai) ·
[Docs](https://nami.dainami.ai/docs/) ·
[Terms](https://nami.dainami.ai/terms/)
