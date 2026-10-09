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
| Typecheck | `bun run typecheck` |
| Lint / fix | `bun run lint` / `bunx biome check --write .` |
| Validate manifest and module | `bun run validate` |
| Run the mod in a session | `claude --plugin-dir .` |

## TDD
- Write the failing test first, then the code.
- Tests live next to the module as `*.test.ts` or `*.test.tsx` and import from `claude-code/testing`.
- `bun run test` runs every test; there is no single-file filter, and the suite takes about 40 seconds.
- UI tests mount on `terminal` and `desktop` and find elements by type and text; `Text` keeps no `key`.
- Logic that needs no `$` (parsers, formatting, the next cron run) lives in plain functions with their own tests.
- A test's `$` has no `state` noun: watch writes with a test hook on `state.set`. A test needs `mock.clock(on)` when the code reads the clock.

## Code Layout
- `hooks/register.tsx`: entry point; calls `sources(on, pricesFile)`, `band(on)`, `pane(on)` and, unless the option `hideBuiltinTasks` is false, `builtin(on)`; nothing else.
- `hooks/model.ts`: the item types and pure item helpers. `hooks/registry.ts`: pure changes to the item list.
- `hooks/sources/<kind>.ts`: one module per source (agents, codex, shells, monitors, crons, workflows) that turns events and files into items; `hooks/sources/index.ts` calls each one. Each file's `write($, change)` caps the list and drops the per-item state of the items it removed; a timer's write skips the plugin's own `state.set` hooks.
- `hooks/tasks.ts`, `hooks/schedule.ts`: pure parsers for task notifications, task output files and cron schedules. `hooks/writes.ts`: pure, the files a shell command line may write (candidates the sources check on disk). `hooks/forwarders.ts`: pure, the Codex companion calls of agents and the jobs they started. Views read session state only, never files.
- `hooks/testing.ts`: test helpers (`memoryState`, `files`, `core`); the test's `$` has no `state` noun.
- `hooks/ui/`: band and pane drawing. Only `band.tsx`, `pane.tsx` and `builtin.tsx` touch `$`. Views are pure `View` functions in `hooks/ui/views/` that return lines (Text parts and one plain Button per selectable row) and their controls; `render.tsx` draws them; the cell engine in `hooks/ui/cells/` draws charts only (see `docs/architecture.md`).
- Colors: only xterm-256 entries from `hooks/ui/cells/palette.ts`; a list never reorders while the pane is open (`stable` in `hooks/ui/lists.ts`).
- `$.state` keys: declare each in `types/index.d.ts` and name that file as `"types"` in `.claude-plugin/plugin.json`.
- `data/prices.csv`: list prices per model. The agents and Codex sources read it at run time under `$.plugin.root`, with the user's file (option `pricesFile`) first; `hooks/prices.ts` parses and applies it (see `docs/feasibility.md` and `docs/architecture.md`).
- `types/claude-code.d.ts`: API types written by Claude Code. Do not edit; replace it when the pinned Claude Code version changes.

## Key Conventions
- Get data from the mod API first, then from files on disk, then from the Claude Code or Codex source. Record each new source in `docs/feasibility.md`.
- Hooks pass on with `next(e)` unless they answer on purpose.
- Give each hook in a source a matcher: an event may have only one hook without a matcher in the whole module, or the module does not load. `pane.tsx` owns the plain `session.start` (see `docs/architecture.md`).
- Helpers that take `$` are top-level function declarations in the same file as the hook; `claude plugin validate` refuses closures inside `register` that receive `$`, and the scan never follows `$` across an import. Shared code is pure; see `docs/architecture.md`.
- A `$.state` reference or atom is written in the file that uses it, with literal `plugin` and `key`.
- Files on disk are undocumented: a missing file or field shows `n/a`. Never throw from a hook.
- Take file paths from tool results; build a path only when no result carries it.
- `$.fs` rejects reads over 4 MiB: read large files with `tail` or `jq` through `$.process.run`.
- Module variables reset on every reload. Keep session values in `$.state` and values across sessions in `$.store`.
- Poll with `$.clock.every`, and write state only when a value changed.
- Keys: focusable Buttons and lowercase letter hotkeys only. `X`, `/`, space and `←→` cannot be bindings.
- UI text: sentence case, plain words, no emoji. Status always has a word, never only a colour. Raster cells take width-1 BMP characters only; `safe()` replaces the rest.
- Workflows: pin actions to full SHAs, least-privilege `permissions`.

## Documentation
- Read the docs before the code: start with the table under External References.
- Every change updates the docs in the same pull request: behaviour, data sources, hooks, modules, commands and settings.
- The first code that adds a module also creates `docs/architecture.md`; each later module adds its section there.
- A new or changed data source updates `docs/feasibility.md`.
- User-visible changes also update `README.md`.
- User-visible changes add a line under `## [Unreleased]` in `CHANGELOG.md`, with the pull request link.
- Each file in `docs/` starts with frontmatter: `title`, `description`, `tags`, `keywords`.
- Docs say what a part does and why; code comments do not repeat them.
- CI fails a pull request that changes code under `hooks/` but not `docs/` or `README.md`. A pure refactor gets the `no-docs` label.

## Commits and PRs
- Conventional Commits, imperative, lower case, no period.
- Commit email: `5694425+lorenzh@users.noreply.github.com`.
- No AI attribution, generated-by lines or `Co-Authored-By` trailers.
- Changes reach `main` through pull requests.
- Create git worktrees only under `.worktrees/<name>` in the repo: `git worktree add .worktrees/<name> -b <branch>`. Run `bun install` inside it, and remove it with `git worktree remove .worktrees/<name>` after its branch is merged.

## External References
| Need | File |
|------|------|
| How Rabe is built (once code exists) | `docs/architecture.md` |
| What data exists and where it comes from | `docs/feasibility.md` |
| Release steps, versions, migration checks | `RELEASING.md` |
| What changed per version | `CHANGELOG.md` |
| Mod API (grep a name, read its doc comment) | `types/claude-code.d.ts` |
| UI mockups (private) | https://claude.ai/artifact/1Fb364t1W9Fa1Gbi2KXvMq |
