---
title: Diagnostics
description: How Rabe records the last poll of each source and prints it with /rabe-diag, without private data.
tags: [architecture, diagnostics, privacy]
keywords: [rabe-diag, diag, tally, fault, Probe, mergeDiag, shorten, RabeDiag, n/a, poll record, redaction, report-bug]
---

# Diagnostics

`/rabe-diag` shows why Rabe has `n/a` or misses an item. It prints what each source read in its last poll. The text is safe to paste into a bug report.

## What is recorded

The shared poll loop (see [Shared poll loop](loop.md)) gives each named poll a record in the `$.state` key `rabe.diag` (`Record<string, RabeDiag>`). The names are `agents`, `codex`, `shells`, `monitors` and `worktrees`. A record has:

- `at`: when the poll ran.
- `ms`: how long it took, rounded to 100 ms.
- `files` and `chars`: files and text read, from `tally` calls at the read sites. `chars` counts UTF-16 units of the returned text, not bytes. The worktrees poll also counts the output of a failed `git`, so a count describes returned data, not a successful read.
- `errors` and `lastError`: failures of the last poll. A source reports a read it swallows with `fault`; a thrown poll counts in `collect`. A poll that did not run in a pass keeps its older record.

Polls run one after another, so `tally` and `fault` in `hooks/loop.ts` count into the poll in flight. They need no `$` and no probe argument, which keeps `$` in the source file. An event hook that reads while a poll runs counts into that poll.

The loop writes a record only when `files`, `chars`, `errors`, `lastError` or the rounded `ms` changed (`mergeDiag`). A steady source causes no state write. A version conflict retries up to three times; a refused or failed write leaves the records as they are and never blocks the item write.

Limits: an event hook that reads during a poll counts into that poll, so event IO can overlap a poll; and a clean poll (no errors) does not prove that discovery found everything.

## What is printed

`hooks/diag.ts` registers `/rabe-diag` (in interactive sessions) and answers with `diagText`: the Rabe version from `plugin.json`, the Claude Code version, the three options, item counts per kind and status, and one line per polled source. A source without a record prints `no poll recorded (not due, inactive session, or hook unavailable)`, and a last line says that crons and workflows are event sources without polls. The `pricesFile` option shows only `set` or `not set`.

The text has no item titles, prompts, messages or commands. `lastError` goes through `shorten`: every absolute path (`/x`, `~/x`, `C:\x`) becomes its file name when it has an extension and `…` otherwise, whitespace folds and the text is cut at 120 characters. Free text around a path, such as a deny reason from the host or another plugin, is cut but not rewritten.

`/rabe-diag` is registered `immediate`, so it also runs during a turn.

`/rabe:report-bug` gets the same text as a context entry (`Rabe diagnostics:` and the report) from a `command.run` hook in `hooks/diag.ts`, which keeps the command's own text and context. If the report fails, the entry says `diagnostics unavailable`. The command puts the entry under Diagnostics, or asks the person to run `/rabe-diag`.

## Tests

`hooks/diag.test.ts` covers the recorded fields, the unchanged-record rule, the redaction, the command, the report-bug context and, in `hooks/register.test.ts`, the tally and fault wiring and a refused diag write.
