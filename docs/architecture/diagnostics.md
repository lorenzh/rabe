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
- `files` and `bytes`: files and text read, from `tally` calls at the read sites.
- `errors` and `lastError`: failures of the last poll. A source reports a read it swallows with `fault`; a thrown poll counts in `collect`. A poll that did not run in a pass keeps its older record.

Polls run one after another, so `tally` and `fault` in `hooks/loop.ts` count into the poll in flight. They need no `$` and no probe argument, which keeps `$` in the source file. An event hook that reads while a poll runs counts into that poll.

The loop writes a record only when `files`, `bytes`, `errors`, `lastError` or the rounded `ms` changed (`mergeDiag`). A steady source causes no state write.

## What is printed

`hooks/diag.ts` registers `/rabe-diag` (in interactive sessions) and answers with `diagText`: the Rabe version from `plugin.json`, the Claude Code version, the three options, item counts per kind and status, and one line per source. The `pricesFile` option shows only `set` or `not set`.

The text has no item titles, prompts, messages or commands. `lastError` goes through `shorten`: each path keeps only its last name, whitespace folds and the text is cut at 120 characters.

`/rabe:report-bug` asks the person to run `/rabe-diag` and to put its text in the draft under Diagnostics.

## Tests

`hooks/diag.test.ts` covers the recorded fields, the unchanged-record rule, the redaction and the command.
