# Contributing to Rabe

Rabe is a Claude Code mod. This guide explains how to propose, change, test and review it. The same rules apply to people and AI agents.

See [AGENTS.md](AGENTS.md) for the full coding conventions.

## Start with an issue

Open or find an issue before you start a change. Agree on its scope before you write code. Keep a change focused on that scope.

Create a branch in a worktree under `.worktrees/`:

```sh
git fetch origin
git worktree add .worktrees/<name> -b <branch> origin/main
cd .worktrees/<name>
```

Use a short branch name that includes the issue number. Keep all changes and commits in that worktree.

To triage the backlog or check whether a bug reproduces, use the repo skill `.claude/skills/triaging-rabe-issues`. It judges issues against `main`, reproduces bugs in a real session with `scripts/live-check.sh` and records the finding in the issue.

## Set up Rabe

Rabe uses Bun 1.4 for development tools. The pinned Claude Code dev dependency is listed in [`package.json`](package.json).

```sh
bun install
claude --plugin-dir .
```

The second command starts Claude Code with the local mod. Saving a file reloads the mod.

## Make and test a change

Write a failing test before you change code. Tests live beside their modules as `*.test.ts` or `*.test.tsx`. They import helpers from `claude-code/testing`.

Run the full test suite with:

```sh
bun run test
```

There is no per-directory test filter. The full suite takes about 40 seconds. Run all checks before you open a pull request:

```sh
bun run check
```

For a live check, use tmux with its own socket and a fresh folder as the Claude Code working directory. Start Claude Code there with `claude --plugin-dir /absolute/path/to/rabe`. Check the changed behavior in the band or `/rabe` pane. When you finish, close the session and remove the temporary folder. See [testing](docs/testing.md) for the test and live-check details.

## Preserve Rabe's rules

- Keep the pane's focus order append-only while it is open. New or removed rows must not move another row under the focus.
- Keep destructive actions armed by the person's own focus or press. Data alone must never arm or trigger an action.
- When a poll finds no changes, do not write state.
- Hooks must not throw. Unless a hook answers on purpose, pass events on with `next(e)`.
- When data is missing or unknown, show `n/a` or nothing. Never guess a value that a file or field does not give.
- Treat file content as untrusted data. Do not put prompts, message text or tokens into persistent state; redact paths and ids in reports.

Read [security guidelines](docs/security.md) before changing file reads, paths, commands or copied text. The guide explains the threat model and the required checks.

## Document the change

Every pull request creates or updates project documentation. When users can see a behavior change, update the README and changelog. If a pull request needs no documentation, explain why in its description and use the `no-docs` label.

Use the [pull request template](.github/pull_request_template.md). It lists the documentation, test and live-check details reviewers need.

## Commit and open a pull request

Use Conventional Commits. Write an imperative, lowercase subject without a final period. Unless the issue asks for `Refs #<issue>`, put `Fixes #<issue>` in the commit body.

Push your branch and open a pull request against `main`. Describe the change, the reason for it, and the checks you ran. Request review and address the review comments. A maintainer squash-merges approved pull requests.

For AI-assisted changes, Codex implements the change. A reviewer from the other model family reviews it. The reviewer must inspect the code and report findings. An agent's own check does not replace review.

## Conduct and security reports

Treat contributors with respect and follow the [GitHub Community Guidelines](https://docs.github.com/en/site-policy/github-terms/github-community-guidelines). If you see conduct that does not meet them, contact the maintainers.

Report security issues privately by email to [lorenz@losoft.dev](mailto:lorenz@losoft.dev). Do not open a public issue for a suspected vulnerability. See [security guidelines](docs/security.md) for Rabe's privacy and security rules.
