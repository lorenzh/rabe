---
title: Incremental file reads
description: Session cursors and bounded parsing for growing output and rollout files.
tags: [architecture, sources, files]
keywords: [incremental, cursor, reading, tail, inode, UTF-8, rollout, metadata, benchmark, reading.ts]
---

# Incremental file reads

The [shared poll loop](loop.md) calls the file readers. Each source owns its engine calls. `hooks/reading.ts` supplies pure cursor and output rules.

## Cursors

Shell and monitor cursors live inside each item’s `rabe.lines` entry. One versioned write commits output and cursor together. A failed write retries against current state. Removing an item drops its cursor with its lines. Codex cursors and parser summaries live in `rabe.rollouts`. Session state survives module reloads. Source polls prune Codex entries for items that left the registry. Readers treat non-object restored maps as empty. Invalid cursor or parser entries are absent and rebuilt.

A cursor holds file size, modification time and the next byte offset. `ls -diL -- <path>` supplies the inode. The mod API has no inode field. A different inode or a smaller file starts a new read. A changed modification time at the same size also starts a new read. Readers compare size and modification time before running `ls`. With a completed cursor, unchanged files cause no process spawn, content read or state write. An unread backlog still advances.

The first read uses `$.fs.read` for files up to 4 MiB. Later reads use `tail -c +N -- <path>`. Each command has a five-second timeout. Output readers still check the resolved task folder and file before every read. Without an inode command, small files use whole reads. When no rollout cursor exists and its modification time matches the item’s last read, Codex skips the inode lookup and content read. Larger files stay unavailable.

A command returns at most 4 MiB of text. A cut result advances through complete lines only. Later polls continue from that offset. Ended items finish their unread backlog without changing their end time. The reader skips a record larger than the command limit through its newline. A Codex rollout with a skipped record stays partial and has no cost estimate. Truncation or inode replacement clears discard mode before reading the new file.

Byte offsets count UTF-8 bytes of decoded output from `tail`. Invalid UTF-8 can change that count and move the offset. A longer replacement with the same inode looks like an append. Readers cannot detect a replacement with unchanged size and modification time. An unfinished line stays behind the cursor until more bytes arrive. Shell and monitor details show that line now. Its completed form keeps the first receive time. A valid final JSON record needs no newline. The parser skips invalid JSON records with a newline.

Polls and final task notifications share one read queue per output source. This prevents two readers from appending the same chunk. The queue holds no session data.

## Parser summaries

The Codex parser (`advanceRollout` in `hooks/sources/codex-data.ts`) carries model settings and token totals between reads. It retains the total at the job's start for resumed threads. Pending tool calls survive until their matching output arrives. Steps keep the last 50 entries. Edits and shell checks keep the last 100 entries.

Each chunk prices only its new requests. Session state keeps the sum rather than every request. An unpriced request makes the sum unknown. If the parser already consumed later records, a completion cutoff resets it. A changed job start also resets it.

Agent metadata uses `rabe.agentFiles`. Codex job and workspace JSON use `rabe.codexFiles`. These files are rewritten rather than appended. Unchanged size and modification time reuse their metadata. The source reads a changed file whole. These caches use no inode lookup and also work without a process host. Each poll prunes the Codex JSON cache against retained jobs and their workspace files. Removed jobs and vanished workspaces leave no cached documents.

Caches keep the parsed agent metadata and Codex rollout fields. Output entries keep the exit status and code. Shell entries also keep the discovered port. The item write happens after these reader writes. If a newer session start discards the pass, the next poll applies the stored fields again. A refused or failed item write has the same recovery. When the source applies an item change, cached agent metadata fills only fields that are `undefined`. This preserves newer event values. A real read of changed agent metadata still applies the full patch. The task-list hook also uses cached exit results. An agent that ends before the retry still gets its missing cached metadata. An unchanged file needs no new content read for this retry.

The [diagnostics](diagnostics.md) record counts each returned content chunk and its UTF-8 bytes. Unchanged files increase `skipped` without increasing reads or bytes. Inode command output does not count as file content. Failed reads and process calls increase `errors`.

See [source behavior](sources.md) and the [reader benchmark](../feasibility.md#incremental-reader-benchmark).
