# rabe-probe

A diagnostic plugin for [Rabe](https://github.com/lorenzh/rabe). It does not watch anything. It tells
which part of the Claude Code mod engine works in your app: the Claude desktop app, the VS Code
extension or the terminal.

It installs beside Rabe: the plugin and its marketplace are both named `rabe-probe`.

## What it checks

| What you see | What it means |
|---|---|
| `/probe` and `/probe-plain` are not in the `/` list, typing `/probe` does nothing, but `/rabe-probe:probe-md` works | (A) the hooks module does not load |
| `/probe` is not in the list, but typing it and pressing Enter answers | (B) the module loads, its commands are not listed |
| `/probe` answers with `ui.render AbovePrompt calls: none` | (C) the module loads, the app never asks it to draw |
| A line `probe: render N on <surface>` above the prompt | drawing works on that surface |

`/rabe-probe:probe-md` is a plain markdown command. It answers `markdown command works`.

## Install

### Terminal (Claude Code CLI)

```sh
claude plugin marketplace add lorenzh/rabe#probe/desktop-diagnostic
claude plugin install rabe-probe@rabe-probe
```

Start a new session.

### Claude desktop app

1. Open the plugin browser (Customize, then Plugins).
2. Add a marketplace: `lorenzh/rabe#probe/desktop-diagnostic`.
   If the app does not take a branch after `#`, run the two terminal commands above instead.
3. Install `rabe-probe` from the `rabe-probe` marketplace.
4. Start a new session.

### VS Code extension

Install it with the terminal commands, then open a new Claude session in VS Code.

## Test (30 seconds)

In a new session:

1. Type `/probe` and look at the list. Note which of `/probe`, `/probe-plain` and `/rabe-probe:probe-md` it shows.
2. Look for a line `probe: render N on ...` above the prompt.
3. Press Enter on `/probe`, even if the list did not show it.
4. Run `/rabe-probe:probe-md`.

Send back the answer of `/probe` (or "nothing happened"), and what you saw in steps 1, 2 and 4.
The answer holds no paths, user names or environment values; check it before you send it.

## Remove

```sh
claude plugin uninstall rabe-probe@rabe-probe
claude plugin marketplace remove rabe-probe
```
