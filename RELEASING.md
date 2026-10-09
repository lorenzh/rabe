# Releasing Rabe

How a Rabe version gets from `main` to the people who use it, and what to check first.

## How people get updates

Rabe is installed from this repository as a marketplace:

```
/plugin install rabe --marketplace lorenzh/rabe
```

Claude Code keeps the copy it made at install time. A person gets a new version with `claude plugin update rabe` and then `/reload-plugins`, or the next session. Because `plugin.json` declares a `version`, **a new commit alone does not reach people: every release must raise the version** ([Claude Code docs: release a new version](https://code.claude.com/docs/en/plugins/host-marketplace#release-a-new-version)).

A folder loaded with `claude --plugin-dir .` (development) reloads on every save and needs none of this.

## Versions

- The version lives in one place: `version` in `.claude-plugin/plugin.json`.
- Rabe follows [semantic versioning](https://semver.org/). While it is `0.x`:
  - `0.MINOR.0` for new features and for changes people notice (new keys, removed keys, new views).
  - `0.x.PATCH` for fixes only.
- Each release gets a tag `vX.Y.Z` on its merge commit on `main` and a GitHub release with the notes from `CHANGELOG.md`.

## Before a release

All of these must be true. Tick them in the release pull request.

**Code**
- [ ] Every change for the release is merged into `main` through a pull request.
- [ ] CI passes on `main` (lint, typecheck, strict validate, tests).
- [ ] The release's changes were reviewed by GPT-6.1 Sol at high effort until it approved.
- [ ] A live check in a real Claude Code session passed: band, `/rabe`, arrow keys, Enter, a mouse click on a row, every tab, a detail of each kind, `x` on a shell, Esc. Note the Claude Code version it ran on.

**Docs**
- [ ] `README.md` matches what Rabe does: keys, mouse, commands, options, requirements, what it cannot see.
- [ ] `docs/architecture.md` matches the code (modules, data flow, focus rules).
- [ ] `docs/feasibility.md` lists every data source Rabe reads and every limit found since the last release.
- [ ] `AGENTS.md` commands and rules still work.
- [ ] `docs/assets/demo.gif` shows the current pane, recorded without private data.
- [ ] `CHANGELOG.md` has an entry for the release (see below).

**Compatibility.** A migration note is needed when one of these changes. If none does, say so in the release pull request.
- [ ] Data Rabe keeps across sessions (`$.store` keys and their format). Today only `previous:<folder>`, the summary of the previous session.
- [ ] Options in `userConfig` (`plugin.json`): renamed, removed or a changed default.
- [ ] Slash commands: renamed or removed (`/rabe`, `/rabe-stop`, `/rabe:report-bug`, `/rabe:feedback`).
- [ ] Keys: a key that did something before does something else now.
- [ ] The lowest Claude Code version Rabe needs: the version the live check ran on, the pinned `@anthropic-ai/claude-code` in `package.json`, and `README.md` requirements must agree. (The first line of `types/claude-code.d.ts` names the version that wrote the types, not a minimum.)

- [ ] Session state (`$.state` keys and item formats in `types/index.d.ts`). It starts empty in a new session, but it **survives a plugin reload**, and an update is applied with `/reload-plugins`. So the new code must read the old format, convert it, or ignore it safely; otherwise the release notes tell people to start a new session after the update.

## Changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/). Each release has the sections that apply: Added, Changed, Fixed, Removed. Write what a person notices, in plain words, and link the pull requests. Put migration steps first under the version when there are any.

## Steps

0. Before you publish anything, set up the upgrade test with the **current** published version:
   - In a new shell: `export CLAUDE_CONFIG_DIR="$(mktemp -d)"`, and note the folder for step 9.
   - Install Rabe from the marketplace and set the option `hideBuiltinTasks` to `false` (not the default), so step 9 can see that options survive.
   - In one project folder, start some background work (a background shell is enough), end the session, start a new one in the same folder, and check that `/rabe` shows the previous-session summary. It is saved when a session ends while background items exist.
1. Create a release branch in a worktree and work there: `git worktree add .worktrees/release -b release/vX.Y.Z main`, `cd .worktrees/release`, `bun install`.
2. Set `version` in `.claude-plugin/plugin.json` to `X.Y.Z`.
3. Move the changes from "Unreleased" in `CHANGELOG.md` to a new `## [X.Y.Z] - YYYY-MM-DD` section and add the compare link at the end of the file.
4. Run `bun run check`.
5. Open a pull request `chore: release vX.Y.Z` with the checklist above, ticked.
6. After CI passes, merge it.
7. Tag the merge commit and push the tag:
   ```sh
   git tag -a vX.Y.Z -m "Rabe vX.Y.Z" <merge commit>
   git push origin vX.Y.Z
   ```
8. Create the GitHub release from the changelog section:
   ```sh
   gh release create vX.Y.Z --title "Rabe vX.Y.Z" --notes-file <notes.md>
   ```
9. In a shell with the same `CLAUDE_CONFIG_DIR` as step 0, run `claude plugin update rabe` and `/reload-plugins`. Check that `claude plugin list` shows `X.Y.Z`, `/rabe` works, the options kept their values and the previous-session summary still shows. Then start a fresh session and check `/rabe` again.
10. Remove the release worktree.
