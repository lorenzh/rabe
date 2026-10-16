# Agent Instructions

## Package Manager
- Use **Bun 1.4** for development tools: `bun install`. Never npm, pnpm or yarn.
- The mod runs inside Claude Code's sandbox: no Node, no Bun, no npm packages at run time. Import only from `claude-code` and from files in this repo.
- Claude Code is pinned as a dev dependency; `bun run` scripts use that version.

## Commands
| Task | Command |
|------|---------|
| All checks (CI runs these) | `bun run check` |
| Tests | `bun run test` |
| Live-check script tests | `bun run test:scripts` |
| Live check in tmux | `scripts/live-check.sh --help` |
| Typecheck | `bun run typecheck` |
| Lint / fix | `bun run lint` / `bunx biome check --write .` |
| Validate manifest and module | `bun run validate` |
| Run the mod in a session | `claude --plugin-dir .` |

## TDD
- Write the failing test first, then the code. `docs/testing.md` has the kit, examples and the live check.
- Tests live next to the module as `*.test.ts` or `*.test.tsx` and import from `claude-code/testing`.
- `bun run test` runs every test; there is no single-file filter, and the suite takes about 40 seconds.
- UI tests mount on `terminal` and `desktop` and find elements by type and text; `Text` keeps no `key`.
- Logic that needs no `$` (parsers, formatting, the next cron run) lives in plain functions with their own tests.
- A test's `$` has no `state` noun: watch writes with a test hook on `state.set`. A test needs `mock.clock(on)` when the code reads the clock.

## Code Layout
- `hooks/register.tsx`: entry point; owns the shared poll loop and calls `sources(on, pricesFile, pollers)`, `band(on)`, `pane(on, hours)` (the option `timelineHours`), `diag(on, options)` and, unless the option `hideBuiltinTasks` is false, `builtin(on)`.
- `hooks/model.ts`: the item types and pure item helpers. `hooks/registry.ts`: pure changes to the item list.
- `hooks/sources/<kind>.ts`: one module per source (agents, codex, shells, monitors, crons, workflows) that turns events and files into items, and `worktrees.ts`, which keeps the git worktrees in `rabe.worktrees`; `hooks/sources/index.ts` calls each one. `agent-items.ts` holds the pure metadata, transcript, turn and item helpers of `agents.ts` and the shared `MAX_EDITS` limit. `codex-data.ts` holds the pure job, rollout and item helpers of `codex.ts`. Poll callbacks stage item changes for one shared commit. Each file's event-hook `write($, change)` caps the list and drops the per-item state of the items it removed; a timer's write skips the plugin's own `state.set` hooks.
- `hooks/tasks.ts`, `hooks/schedule.ts`: pure parsers for task notifications, task output files and cron schedules. `hooks/shell-words.ts`: pure shell words and here-doc tokenization. `hooks/writes.ts`: pure, the files a shell command line may write (candidates the sources check on disk). `hooks/forwarders.ts`: pure, the Codex companion calls of agents and the jobs they started. `hooks/codex-exec.ts`: pure, a direct `codex exec` call in a Bash command line, its `-o` file and whether a `&` detaches it. Views read session state only, never files.
- `hooks/diag.ts`: `/rabe-diag` and its pure `diagText`. A source counts reads with `tally` and swallowed failures with `fault` from `hooks/loop.ts` and names its poller; see [`docs/architecture/diagnostics.md`](docs/architecture/diagnostics.md).
- `hooks/testing.ts`: test helpers (`memoryState`, `files`, `core`); the test's `$` has no `state` noun.
- `hooks/ui/`: band and pane drawing. `pane-data.ts` filters clipboard and toast text and validates stored summaries. `touched.ts` holds pure file edits, conflicts and worktree rows. Only `band.tsx`, `pane.tsx` and `builtin.tsx` touch `$`. Views are pure `View` functions in `hooks/ui/views/` that return lines (Text parts and one plain Button per selectable row) and their controls; `render.tsx` draws them; the cell engine in `hooks/ui/cells/` draws charts only (see [`docs/architecture/ui.md`](docs/architecture/ui.md)).
- Colors: only xterm-256 entries from `hooks/ui/cells/palette.ts`; a list never reorders while the pane is open (`stable` in `hooks/ui/lists.ts`).
- `$.state` keys: declare each in `types/index.d.ts` and name that file as `"types"` in `.claude-plugin/plugin.json`.
- `data/prices.csv`: list prices per model. The agents and Codex sources read it at run time under `$.plugin.root`, with the user's file (option `pricesFile`) first; `hooks/prices.ts` parses and applies it (see `docs/feasibility/prices.md` and `docs/architecture/prices.md`).
- `types/claude-code.d.ts`, `types/claude-code-tools.d.ts`: API types and built-in tool types written by Claude Code (`.claude-plugin/types/claude-code/` and `claude-code-tools/`). Do not edit; replace both when the pinned Claude Code version changes.

## Shared helpers: look here before writing one
Search this table and grep before you write a helper. Put new shared logic in the named file and add a row in the same pull request. Helpers that take `$` stay in their hook's file.

| Need | Helper | File | Test |
|------|--------|------|------|
| Is a value an object (not an array) | `isRecord`, `rec` | `hooks/reading.ts` | `hooks/reading.test.ts` |
| Safe `list`, `str`, `num` from unknown JSON | `list`, `str`, `num` | `hooks/reading.ts` | `hooks/reading.test.ts` |
| Parse one JSON object or a JSONL text | `parseJson`, `jsonRecords` | `hooks/reading.ts` | `hooks/reading.test.ts` |
| Cursor after a read; is a path the task's own file after symlinks resolve | `nextCursor`, `isOwnFile` | `hooks/reading.ts` | `hooks/reading.test.ts` |
| `n/a` for an unknown value or id; cut text with `…` | `na`, `idOrNa`, `cut` | `hooks/ui/format.ts` | `hooks/ui/format.test.ts` |
| Tokens and dollars of workers, one unknown makes the sum unknown; which items are workers | `spend`, `spendBy`, `isWorker`, `harnessOf` (`totals` wraps them) | `hooks/ui/lists.ts` | `hooks/ui/lists.test.ts` |
| The item that started an item; its workflow run; the list of kinds | `parentOf`, `runOf`, `KINDS` | `hooks/model.ts` | `hooks/model.test.ts` |

## Key Conventions
- Get data from the mod API first, then from files on disk, then from the Claude Code or Codex source. Record each new source in the relevant document under `docs/feasibility/` and add it to [`docs/README.md`](docs/README.md).
- Hooks pass on with `next(e)` unless they answer on purpose.
- Give each hook in a source a matcher: an event may have only one hook without a matcher in the whole module, or the module does not load. `pane.tsx` owns the plain `session.start` (see [`docs/architecture/sources.md`](docs/architecture/sources.md#starting-work-sessionstart-with-a-matcher)).
- Helpers that take `$` are top-level function declarations in the same file as the hook; `claude plugin validate` refuses closures inside `register` that receive `$`, and the scan never follows `$` across an import. Shared code is pure; see [`docs/architecture/state.md`](docs/architecture/state.md#the-engines-rule-for-).
- A `$.state` reference or atom is written in the file that uses it, with literal `plugin` and `key`.
- Files on disk are undocumented: a missing file or field shows `n/a`. Never throw from a hook.
- Security: follow `docs/security.md`. File content is data, `$.process.run` takes argument arrays, no network, never read process environments (they hold session tokens).
- Take file paths from tool results; build a path only when no result carries it.
- `$.fs` rejects reads over 4 MiB: read large files with `tail` or `jq` through `$.process.run`.
- Module variables reset on every reload. Keep session values in `$.state` and values across sessions in `$.store`.
- Poll with `$.clock.every`, and write state only when a value changed.
- Keys: focusable Buttons and lowercase letter hotkeys only. `X`, `/`, space and `←→` cannot be bindings.
- UI text: sentence case, plain words, no emoji. Status always has a word, never only a colour. Raster cells take width-1 BMP characters only; `safe()` replaces the rest.
- Workflows: pin actions to full SHAs, least-privilege `permissions`.
- Skills a workflow needs live in this repo (`.claude/skills/<name>/`) or come from the public plugin `lorenzh/skills`, installed in the job and pinned to a commit SHA. Never rely on a skill in a home folder; an automatic run follows the limits in `.claude/skills/triaging-rabe-issues`.

## Documentation
- Contributor setup and workflow: [CONTRIBUTING.md](CONTRIBUTING.md).
- Every pull request creates or updates documentation in `docs/`, `README.md`, `CHANGELOG.md`, `RELEASING.md`, `AGENTS.md`, or a new doc. The only exception is a PR labelled `no-docs`, with the reason in the PR body.
- Read the docs before the code: start with the table under External References.
- Every change updates the docs in the same pull request: behaviour, data sources, hooks, modules, commands and settings.
- The first code that adds a module also creates an architecture document; each later module updates the relevant document under `docs/architecture/` and [`docs/README.md`](docs/README.md).
- A new or changed data source updates the relevant document under `docs/feasibility/` and [`docs/README.md`](docs/README.md).
- User-visible changes also update `README.md`.
- User-visible changes add a line under `## [Unreleased]` in `CHANGELOG.md`, with the pull request link.
- Each file in `docs/` starts with frontmatter: `title`, `description`, `tags`, `keywords`.
- Docs say what a part does and why; code comments do not repeat them.
- CI enforces documentation changes for code under `hooks/`, `commands/`, `types/index.d.ts`, `data/`, and `.claude-plugin/`; add the `no-docs` label only with a reason in the PR body.

## Commits and PRs
- Conventional Commits, imperative, lower case, no period.
- Commit email: `5694425+lorenzh@users.noreply.github.com`.
- No AI attribution, generated-by lines or `Co-Authored-By` trailers.
- Changes reach `main` through pull requests.
- Create git worktrees only under `.worktrees/<name>` in the repo: `git worktree add .worktrees/<name> -b <branch>`. Run `bun install` inside it, and remove it with `git worktree remove .worktrees/<name>` after its branch is merged.

## External References
| Need | File |
|------|------|
| Documentation index | [`docs/README.md`](docs/README.md) |
| Architecture and module behavior | [`docs/architecture.md`](docs/architecture.md) |
| Data sources and limits | [`docs/feasibility.md`](docs/feasibility.md) |
| Security rules for changes and review | [`docs/security.md`](docs/security.md) |
| How to test: unit, UI, live checks, CI | [`docs/testing.md`](docs/testing.md) |
| Release steps, versions, migration checks | `RELEASING.md` |
| What changed per version | `CHANGELOG.md` |
| Mod API (grep a name, read its doc comment) | `types/claude-code.d.ts`; tool inputs and results in `types/claude-code-tools.d.ts` |
| UI mockups (private) | https://claude.ai/artifact/1Fb364t1W9Fa1Gbi2KXvMq |
