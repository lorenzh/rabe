---
title: Incremental file reads
description: Session cursors and bounded parsing for growing output and rollout files.
tags: [architecture, sources, files]
keywords: [incremental, cursor, reading, tail, inode, UTF-8, rollout, metadata, benchmark, reading.ts]
---

# Incremental file reads

The [shared poll loop](loop.md) calls the file readers. Each source owns its engine calls. `hooks/reading.ts` supplies pure cursor and output rules.

## Cursors

Shell and monitor cursors live in `rabe.shellFiles` and `rabe.monitorFiles`. Codex cursors and parser summaries live in `rabe.rollouts`. These keys survive module reloads. Source polls prune entries for items that left the registry.

A cursor holds file size, modification time and the next byte offset. `ls -diL -- <path>` supplies the inode. The mod API has no inode field. A different inode or a smaller file starts a new read. A changed modification time at the same size also starts a new read. Unchanged files cause no content read or state write.

The first read uses `$.fs.read` for files up to 4 MiB. Later reads use `tail -c +N -- <path>`. Each command has a five-second timeout. Output readers still check the resolved task folder and file before every read. Without an inode command, small files use whole reads. Larger files stay unavailable.

A command returns at most 4 MiB of text. A cut result advances through complete lines only. Later polls continue from that offset. Ended items finish their unread backlog without changing their end time. The reader skips a record larger than the command limit through its newline. A Codex rollout with a skipped record stays partial and has no cost estimate.

Byte offsets count UTF-8 bytes. An unfinished line stays behind the cursor until more bytes arrive. Shell and monitor details show that line now. Its completed form keeps the first receive time. A valid final JSON record needs no newline. The parser skips invalid JSON records with a newline.

Polls and final task notifications share one read queue per output source. This prevents two readers from appending the same chunk. The queue holds no session data.

## Parser summaries

The Codex parser carries model settings and token totals between reads. It retains the total at the job's start for resumed threads. Pending tool calls survive until their matching output arrives. Steps keep the last 50 entries. Edits and shell checks keep the last 100 entries.

Each chunk prices only its new requests. Session state keeps the sum rather than every request. An unpriced request makes the sum unknown. If the parser already consumed later records, a completion cutoff resets it. A changed job start also resets it.

Agent metadata uses `rabe.agentFiles`. Codex job and workspace JSON use `rabe.codexFiles`. These files are rewritten rather than appended. An unchanged inode, size and modification time reuse their metadata. The source reads a changed file whole. The Codex cache holds at most 512 parsed JSON files. Eviction causes a later reread.

See [source behavior](sources.md) and the [reader benchmark](../feasibility.md#incremental-reader-benchmark).
