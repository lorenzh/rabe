---
title: Diagnostics
description: How Rabe records the last poll of each source and prints it with /rabe-diag, without private data.
tags: [architecture, diagnostics, privacy]
keywords: [diagnostics, rabe-diag, diag, tally, fault, bytes, skipped, incremental, Probe, mergeDiag, shorten, RabeDiag, n/a, poll record, redaction, report-bug]
---

# Diagnostics

`/rabe-diag` shows why Rabe has `n/a` or misses an item. It prints what each source read in its last poll. The text is safe to paste into a bug report.

## What is recorded

The shared poll loop (see [Shared poll loop](loop.md)) gives each named poll a record in the `$.state` key `rabe.diag` (`Record<string, RabeDiag>`). The names are `agents`, `codex`, `shells`, `monitors` and `worktrees`. A record has:

- `at`: when the poll ran.
- `ms`: how long it took, rounded to 100 ms.
- `files`: content reads from `tally` calls at the read sites. An appended chunk counts as one read. A failed `tail` counts as an error only; its output is not tallied. Where the inode lookup (`ls`) is unavailable, shells and monitors raise no error for it.
- `chars`: UTF-16 units in the returned text.
- `bytes`: UTF-8 bytes in the returned text. Incremental reads count only the returned chunk. They include unfinished lines and discarded oversized records.
- `skipped`: content reads skipped because the file is unchanged. Metadata caches and completed cursors increase this count. Stat and inode checks do not count as content reads.
- `errors` and `lastError`: failures of the last poll. A source reports a swallowed read failure with `fault`. A thrown poll counts in `collect`. Polls that did not run keep their older records.

The worktrees poll also counts output from a failed `git` command. Counts describe returned data rather than successful parsing. Byte counts use decoded text and can differ from raw bytes for invalid UTF-8.

Polls run one after another, so `tally` and `fault` in `hooks/loop.ts` count into the poll in flight. They need no `$` and no probe argument, which keeps `$` in the source file. An event hook that reads while a poll runs counts into that poll.

The loop writes a record only when `files`, `chars`, `bytes`, `skipped`, `errors`, `lastError` or the rounded `ms` changed (`mergeDiag`). A steady source causes no state write. A version conflict retries up to three times; a refused or failed write leaves the records as they are and never blocks the item write.

Limits: an event hook that reads during a poll counts into that poll, so event IO can overlap a poll; and a clean poll (no errors) does not prove that discovery found everything.

## What is printed

`hooks/diag.ts` registers `/rabe-diag` (in interactive and SDK sessions) and answers with `diagText`: the Rabe version from `plugin.json`, the Claude Code version, the three options, item counts per kind and status, and one line per polled source. The `ports` source records the Linux socket scan separately from shell output reads. A source without a record prints `no poll recorded (not due, inactive session, or hook unavailable)`, and a last line says that crons and workflows are event sources without polls. The `pricesFile` option shows only `set` or `not set`.

The report contains only fixed words, numbers and numeric versions. It has no file names or error message text. `shorten` classifies error codes and known messages. Its categories are `not found`, `permission denied`, `timeout` and `too large`. It also uses `exit code N`, `parse error`, `refused` and `other`. Unknown text becomes `other`. The formatter also classifies older stored errors. It checks option values and item kind/status counts before printing them. Invalid versions show `n/a`. Invalid count fields show zero. Non-object diagnostics maps and records count as absent.

`/rabe-diag` is registered `immediate`, so it also runs during a turn. A refused or failed registration keeps the session start result. A failed report returns `diagnostics unavailable` for either command.

`/rabe:report-bug` gets the same text as a context entry (`Rabe diagnostics:` and the report) from a `command.run` hook in `hooks/diag.ts`, which keeps the command's own text and context. If the report fails, the entry says `diagnostics unavailable`. The command puts the entry under Diagnostics, or asks the person to run `/rabe-diag`.

## Tests

`hooks/diag.test.ts` covers recorded fields and unchanged records. It also checks fixed error categories and both commands. Regressions cover malformed records and failed registration or reporting. `hooks/register.test.ts` checks read counts and swallowed failures. It also checks that a refused diagnostics write does not block item updates. Source tests check unchanged-file skips and the bytes returned by appended chunks.
