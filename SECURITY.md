# Security policy

## Report a vulnerability

Please report security vulnerabilities by email to [lorenz@losoft.dev](mailto:lorenz@losoft.dev). Do not report a vulnerability in a public issue. You get a reply by email, and we can discuss the issue and a fix privately before disclosure.

Include the affected Rabe version, the impact, and steps to reproduce. Remove secrets and personal data from examples. There is no fixed response-time commitment; the maintainers will review reports as they can.

## Privacy

Rabe runs inside Claude Code. Its runtime hooks make no network requests. Successful stop, delete, and message actions add notes that name each item by kind and ID to the next prompt sent to Claude. Other session data is not sent by Rabe. The hooks read:

- Claude Code events for agents, workflows, turns, tool summaries, background tasks, cron jobs, session usage, and file changes.
- Agent metadata files and background shell and monitor output files, plus workflow scripts. Agent turns arrive through Claude Code events; Rabe records transcript paths but does not read the transcript files.
- Codex plugin job and state files, Codex session logs, and Claude Code's installed-plugin list to find the Codex plugin.
- Rabe's bundled price table and, when configured, the user's `pricesFile`.
- File metadata and directory listings for paths named by shell commands, to check which files changed. Rabe does not read those files' contents for this check.
- Git worktree information from `git worktree list`.

Paths depend on the host and session. Rabe reads only the files needed to build the activity view; it does not upload or keep a separate copy of the source files.

### Data kept by Rabe

Rabe uses the Claude Code plugin state keys declared in `types/index.d.ts`:

| Key | Data |
|---|---|
| `items` | Background work details, which can include names, prompts, commands, IDs, file paths, token counts, and cost estimates. |
| `turns` | Agent reply text (up to 16,000 characters per turn) and tool names or summaries. |
| `lines` | Background shell and monitor output lines. |
| `edits` | File paths and timestamps for changes by the main session. |
| `worktrees` | Git worktree paths and branches. |
| `actions` | Kinds and IDs of work Rabe successfully stopped, deleted, or messaged, for the next prompt's private context; message text is not kept here. |
| `tab`, `query`, `folded`, `selected`, `open`, `order`, `removed`, `window` | Pane selection, search, ordering, and display state. |

These values are in Claude Code's session state. Rabe also uses `$.store` under `previous:<project folder>` for a summary of the previous session: its session ID, start and end times, counts by work type, background tokens, session cost, and failed item titles. This summary lets the Timeline tab show the previous session. Rabe does not store full transcripts in `$.store`.

### Bug and feedback reports

`/rabe:report-bug` drafts an issue with what happened, expected behavior, reproduction steps, Rabe version, Claude Code version, operating system, and error lines you provide. `/rabe:feedback` drafts your feedback and an optional example. Both command instructions ask Claude Code to omit home paths, user or project names, prompts, tokens, and email addresses. The `/rabe:report-bug` instructions also ask it to omit transcript text. These are instructions to prepare the draft, not automatic redaction filters. Review the full draft: you can edit it before approval. After approval, the command may create a public issue with `gh` (with Claude Code's command permission) or open a prefilled GitHub issue link. The link does not submit the issue by itself.

See [Privacy](README.md#privacy) for the short user-facing summary.
