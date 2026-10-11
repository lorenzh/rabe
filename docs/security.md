---
title: Security guidelines for developing Rabe
description: The threat model of a mod that runs in every Claude Code session and the rules that contributors and coding agents follow when they change Rabe - file content as data, terminal output, commands, paths, process environments, network, secrets, destructive actions, supply chain and review.
tags: [security, guidelines, review, contributing]
keywords: [threat model, prompt injection, untrusted text, safe, toastText, control characters, escape sequences, OSC 52, $.process.run, argv, "--", option injection, timeoutMs, paths, path traversal, /proc, environ, session token, $.env.get, no network, $.http.fetch, $.store, secrets, privacy, notes to Claude, rabe.actions, arming, destructive actions, TaskStop, CronDelete, rabe-stop, supply chain, lockfile, GitHub Actions, SHA pinning, Dependabot, pull request template, security review]
---

# Security guidelines for developing Rabe

These rules are for people and coding agents who change Rabe. What Rabe reads and keeps, as a user sees it, is in the README under Privacy.

## Threat model

Rabe runs inside every Claude Code session of the user, as that user, with the session's file and process access. It reads files that Claude Code, Codex, subagents and shell commands write. These files can hold untrusted text: web pages, tool output, command output and prompt injection. Rabe draws that text in the terminal, copies it to the clipboard, shows it in toasts, and sends short notes to Claude. It runs commands through `$.process.run` and stops or deletes work through `TaskStop`, `CronDelete` and `/rabe-stop`.

An attacker who controls some text in one of these files must not be able to:

- make Rabe run a command, stop or delete work, or send a message;
- make Rabe read a file outside the folders it knows, or send data anywhere;
- change the terminal through escape sequences;
- put instructions in front of Claude through Rabe's notes.

## Rules

### File content is data

Text from transcripts, meta files, output files, Codex files and workflow scripts is shown, counted or parsed. Rabe never acts on it. A field read from a file can choose what a row shows. It never chooses a command, a flag, a tool call or a file to write.

### Terminal output and the clipboard

- Text from files reaches the screen only through `safe()` in `hooks/ui/cells/grid.ts`. `safe` uses an allow list, so escape and control characters become `?`. The views call it through `fitLine` and `cut` in `hooks/ui/views/lines.ts` and through `wrap` and `fit` in the cell engine. A new view that draws text from a file uses these helpers too.
- Every toast goes through `toast($, text)` in `hooks/ui/pane.tsx`, which applies `toastText`: whitespace becomes one space, and Unicode control (`Cc`) and format (`Cf`) characters become `?`. Do not call `$.ui.toast` directly.
- Never pass raw ANSI from a file through to the terminal.
- Copy puts text on the clipboard that the person may paste into a shell. Copy only an item's own command, prompt, path or id, or a fixed command around an id (`claude --resume <id>`).

### Commands

- `$.process.run` takes an argument array. Never build a shell string, and never run `sh -c` or `bash -c` with a path, id or file content in it.
- `argv[0]` is a fixed program name (`git`, `tail`, `grep`, `node`). It never comes from a file.
- Put `--` before a path or id that comes from a file or a tool result, so a value that starts with `-` cannot become an option.
- Keep the time and output limits: `$.process.run` stops at 30 seconds and 4 MiB per stream by default. Set a shorter `timeoutMs` for a command that a poll runs, and check `isStdoutTruncated` where a cut answer is wrong.
- A command that a poll runs must be read-only.

### Paths

- Take paths from tool results and hook events. Build a path only when no result has it (AGENTS.md).
- A path built from a file's field (a job id, a thread id, a folder name) must stay in the folder it is built under. Check that the field has no `/` and is not `..`, or check that the resolved path starts with the folder.
- Read only the session, agent, task, Codex and project folders and the files the README lists under Privacy. A new place to read is a new data source: add it to `docs/feasibility.md` and to the README.
- For a file that a shell command names, Rabe uses only `$.fs.stat` and `$.fs.list`. It never reads the content.

### Process environments

- Never read another process's environment: no `/proc/<pid>/environ`, no `ps e`, `ps eww` or `ps -E`, and no tool that prints them. The environments of Claude Code, its subagents and Codex hold session tokens (see the research on [#39](https://github.com/lorenzh/rabe/issues/39)).
- Read the mod's own environment only with `$.env.get` and a literal name for a value that is not a secret, such as `HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME`. `claude plugin validate` lists these names; a review checks each new name.
- Pass only the variables a command needs in `env`, and never a token.

### No network

Rabe sends nothing anywhere. It does not call `$.http.fetch`, and it does not run `curl`, `wget`, `gh` or other network tools. The report commands in `commands/` run `gh` only after the person approves the draft. A new network call needs an issue and a review first.

### Secrets and privacy

- Never put message text, prompts or tokens into `$.store`, toasts, bug reports or notes to Claude ([#38](https://github.com/lorenzh/rabe/issues/38)). Notes to Claude hold the kind, id and title of an item only.
- `$.store` lasts across sessions. Keep in it only what the README lists under Privacy.
- Bug reports and feedback replace home paths, user and project names, ids and tokens with placeholders before the person sees the draft.
- Test fixtures and docs use invented paths, ids and names.

### Destructive actions

Stop, delete and message run only after the person's own press on a button that the pane armed (see Arming in `docs/architecture.md`). A poll, a file, a hook event or a note never starts them. Do not weaken the append-only focus order or the arming rules to make a control easier to reach.

### Supply chain

- No runtime dependencies: the mod imports only from `claude-code` and from this repository.
- Dev dependencies have exact versions in `package.json` and are installed with `bun install --frozen-lockfile` from `bun.lock`.
- GitHub Actions use full commit SHAs, `permissions: contents: read` unless a job needs more, and `persist-credentials: false` on checkout.
- Dependabot or an equivalent tool keeps the dev dependencies and the actions up to date.

### Review

A pull request that changes commands, paths, file reading, the clipboard, toasts, `$.store`, notes to Claude or a destructive action gets a security check in review. The pull request template has the checklist item. The reviewer checks the change against the rules on this page.

### Never throw from a hook

A hook that throws can break the session. Catch every file read, command and tool call, and show `n/a` for a missing value (AGENTS.md). This also keeps a crafted file from stopping Rabe's polls.
