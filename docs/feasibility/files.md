---
title: Files and runtime limits
description: What files Rabe reads, which writes it can detect, and what still needs live testing.
tags: [feasibility, files, limits]
keywords: [shell writes, script, bashEditDiff, changedFiles, bashEditDiffEnabled, shared, files outside the project, runtime testing, shellWrites, candidates, fs.stat, mtime, here-doc, redirection, glob, brace expansion, command substitution, FileChange, changed, beforeBash, afterBash, ranBash, rabe.edits, main session, via shell, Edit, Write, 4 MiB, rabe.diffs, structuredPatch, unified_diff, diff content]
---

# Files and runtime limits

`changedFile` and `ranBash` in `hooks/sources/agent-items.ts` check tool results before the hooks record edits.

## Files written outside Edit and Write

An agent can write files through Bash (`cat > ~/.agents/skills/x/SKILL.md <<'EOF'`), and Codex through its own patch tool. Neither is an `Edit` or `Write` call, so the Effects tab once missed them (issue #9).

- **Bash result diffs.** Claude Code's Bash result has an internal `bashEditDiff` field (`types/claude-code-tools.d.ts`, `BuiltinToolResults.Bash`). Its `changedFiles` lists up to 200 absolute paths. After a completed call, Rabe merges these paths with confirmed command-line candidates. Each path counts once per call as `via shell`. Later calls can record the same file again.
- **Diff records.** A matching `files` entry with `deleted: true` marks a deletion. Rabe keeps no hunks or file content. Script edits need no extra file scans or processes.
- **Diff coverage.** Script coverage needs `auto` mode or `bashEditDiffEnabled: true` in user, flag (`claude --settings`) or policy settings; Claude Code ignores it in project and local settings. Background Bash calls and commands Claude Code auto-allows as read-only get no diff. In Claude Code 2.1.296, `bypassPermissions` with a host check or `CLAUDE_CODE_BASH_EDIT_DIFF` can also enable diffs. The host check remains unknown. Diffs are off by default in `default` and `acceptEdits` modes. Rabe changes no settings.
- **Attribution and fallback.** A missing or malformed field supplies no paths. Rabe ignores a diff marked `shared`, `skipped` or `unavailable` and keeps the disk fallback. `shared` warns that Bash calls overlapped. Writers outside Claude Code can still overlap without this flag. Background calls have no diff.
- **Host limits.** The host can skip mass git operations such as `checkout` and `reset`. The internal field can change with a Claude Code update. See the [issue #40 research](https://github.com/lorenzh/rabe/issues/40#issuecomment-6103069306).
- **Candidates, then the disk.** The command text alone never proves a write: `false && touch x || true` and `cp missing out; true` succeed without writing, `touch -c absent` and `rm -f absent` change nothing, `cp src dir` writes `dir/src`, `sed -i q a b` never touches `b`, and `HOME=/tmp` moves `~`. So `hooks/writes.ts` only proposes candidates, each a write or a delete, and the file system decides. A false entry can show a false conflict, so a missed file is the better error.
- **Bash calls.** Before the call runs, the Bash `tool.call` hook stats each absolute candidate (kind, size, mtime). A failed stat alone does not mean the path is missing: in 2.1.295 the error is a `HooksError` without `code`, and its message is free text that any `fs.stat` hook can set (a denial can end in `ENOENT`). So the path counts as missing only when `$.fs.list` of its parent folder succeeds and does not name it, or the parent is missing by the same rule. A listing that fails or is denied (no permission, the parent is a file) or that still names the path, also in another letter case or Unicode form (case-insensitive and normalizing disks such as macOS or Windows), leaves it unknown. Each folder is listed once per look, and the listings count toward the 1 s limit. `$.fs.exists` is no help: it also answers false for a file in a folder it may not read. After a call that ran to its end it stats them again. A path is written when it was not there and is a file now, or its mtime or size changed; deleted when it was there and is gone; else nothing. A stat error leaves that path out. Over 20 candidates, or looks that take over 1 s, leave the disk candidates unconfirmed. Usable host paths still count. Main session and agents work the same way.
- **Codex commands.** A rollout is read after the command, so there is no look before. A candidate counts when it is a file now and its mtime lies within the command's run (`started_at_ms` to `completed_at_ms` plus 2 s). A poll stats each path once, and its checks stop after 1 s in all: a path whose stat has not come back is left out. A delete leaves nothing to look at, so deletes come only from `FileChange` records, which stay the main Codex source. `mv` keeps the old mtime, so a Codex `mv` target is missed.
- **Shell commands.** What the parser proposes: `>`, `>>`, `>|`, `&>`, `&>>` and `N>`/`N>>` redirections to a file (not `/dev/…`, not a dup like `>&2`; `<`, `<>` and `<<<` never), and a fixed table of commands with their options: `tee`, `sed -i` (also `--in-place`, `-e`/`--expression`, `-f`), `touch` (`-r`/`--reference`, `-d`), `rm`, and `cp`, `mv`, `install`, `ln` (`-t`/`--target-directory`, `-T`). `mv` and `rm` delete. `rtk proxy`, `command`, `builtin`, `env`, `nice`, `nohup`, `time`, `sudo` and `VAR=val` are unwrapped first. `~/` takes `HOME` from `$.env`; when the command assigns `HOME` anywhere, every `~` is skipped. `cp a b` proposes both `b` and `b/a`, since `b` may be a folder; multi-file `sed -i` proposes every file.
- **What it skips.** Words are read with bash quoting (single, double, backslash, `$'…'`), and command substitutions keep their own quotes. The parser proposes candidates from lists joined by `&&`, `||`, `;` and newlines, up to the first `&`, `if`, `while`, `until`, `for`, `case`, `function`, `{ }` or `( )` group, `[[`, `[` or `test`, `exit` or `exec`; nothing after that counts, and a list sent to the background counts not at all. Both sides of `||` propose candidates for the disk check. Directory changes on either side leave later relative paths unknown. A later absolute `cd` followed by `&&` can establish the directory again. A newline directly after a list operator or pipe continues its command. In a pipeline only redirections and `tee` count. A here-doc body is skipped up to its delimiter after bash quote removal (`<<E"OF"` ends at `EOF`); with no delimiter nothing from the here-doc on counts. A path with `$`, `` ` ``, a glob (`*`, `?`, `[`), braces, `~user`, a bare `~` or a process substitution is skipped. A command with an option the table does not know (`cp --parents`, `rm -i`), or with a word that could expand into an option, is skipped. A substitution that holds a here-doc or a `case` makes the whole line count nothing. After a `cd` that the next command does not depend on through `&&`, relative paths are skipped.
- **The working folder.** The Bash `tool.call` input carries no cwd. When a candidate needs its folder, the main session uses `$.session.cwd()` (types/claude-code.d.ts). Live tests do not check whether `$.session.cwd()` follows a shell `cd`. An agent uses its item's `detail.cwd` from `classic.SubagentStart` or its meta file. An agent without a cwd never uses the main folder as a fallback. An unknown folder leaves relative paths out. Rabe does not resolve relative shell paths from Windows drive folders such as `C:\repo`. A `cd /abs` followed by `&&` can set the folder within the same command. Directory changes inside an OR branch leave relative paths unknown. Codex's `CommandExecution` has its `cwd`.
- **Limits.** The tab marks these `via shell`. Without a usable Bash diff, only confirmed command-line candidates count. This fallback misses script edits whose paths are absent from the command line. It also misses files restored to the same mtime and size within one command. A failed or interrupted Bash call records nothing. A Codex command with a nonzero exit code records nothing even if it wrote a file. A Codex file changed again after its command ended falls out of that command's window.
- **The main session.** Its `Edit`, `Write` and Bash calls (no `agentId`) go to `$.state` key `rabe.edits`, so the tab shows its files and a file the main session and an agent both changed as a conflict.


## Files outside the project

Tested: `$.fs.stat` and `$.fs.read` read files under `~/.codex/sessions` and `/tmp/claude-<uid>/…/tasks/` without a prompt or a denial.


## Diff content (issue #162)

The Effects diff takes content only from what Claude Code and Codex already hand over, when the operation happens:

- Edit and Write results carry `structuredPatch` hunks (`types/claude-code-tools.d.ts`). A Write that created a file carries `content`. An update with an empty patch and `originalFile: null` was too large to diff.
- `bashEditDiff.files[].hunks` carries hunks for shell edits when the host sends them (the same conditions as `changedFiles`: not shared, skipped or unavailable).
- Codex rollout `FileChange` items carry `unified_diff` for an update and `content` for an add; a delete has none.

A file read or `git diff` would show a different change than the operation Rabe attributes to its editor and breaks the stat-only rule above, so neither is used. Content that was never sent shows `diff n/a: content not recorded`. Not yet checked live: whether agent (not main-session) Bash calls carry `bashEditDiff.files` hunks.

## Still to test at runtime

- Live check (2.1.296, `--settings` with `bashEditDiffEnabled: true`, git repo): a main-session script that rewrote one file and created another delivered both in `bashEditDiff.changedFiles`, and the Effects tab listed both as `via shell`. Without the setting the field was absent and the tab listed neither. Agent Bash calls and `auto` mode are not yet checked live.
- Does Rabe's own turn line (`✻ Brewed for 5s`, one empty line above) sit where the engine's did, in every transcript layout?
- Which words does the hint use for agents, workflows and teammates in its task part? `stripTasks` drops parts like `1 background agent`; others stay.
- Is the pane readable in light terminal themes? Plain text and the background use the terminal's default; chips, panels and the selected row use fixed dark 256-color backgrounds.
- A subagent's monitor ends from its output file only once Rabe knows some task output path (a shell's, or a monitor end notification's), since the Monitor result carries none. Does a subagent ever start a monitor before any such path is known?

- Does `$.session.usage().cost` count the subagents' requests as well as the main thread's? Rabe labels it the session cost either way.
- Does `CronList` also list `ScheduleWakeup` wakeups, and with which id?
- Is a `prompt.submit` raised for a task notification delivered into a running turn, as for one dequeued when idle?
- What does the output file of a monitor that hit its timeout end with?
- Is Codex's `cache_write_input_tokens` part of `input_tokens`, as `cached_input_tokens` is? Every record seen so far had 0 writes.
- Does Claude Code ever give a subagent 1-hour cache writes on purpose (a setting, a model), which Rabe bills at the 5-minute price?

- Do `TaskStop` and `CronList` run without a prompt in auto mode too?
- Does a live `codex:codex-rescue` run fold into its job within one poll, in the foreground, in the background and after the Bash timeout? Does `$.ui.copy` reach the clipboard over SSH (OSC 52) in the terminals people use?
- Does the pane's `x: stop` on a Codex job act during a turn? It runs `/rabe-stop` through `$.command.run`, which the API says is "queued and run once the session is idle" (d.ts `command.run`); the command is registered with `immediate: true`, which may or may not apply to a plugin's call.
- How much does a band redraw every second cost while the user types?

## Diagnostic versions

`/rabe-diag` prints the Claude Code version from `$.session.version()` and the Rabe version from `version` in `${plugin.root}/.claude-plugin/plugin.json`. Either shows `n/a` when the call or the file fails.
