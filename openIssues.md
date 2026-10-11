# Open review findings

- `hooks/ui/format.ts`: keeping `duration()`'s floor rounding is intentional. It is the pane's shared elapsed-duration format; changing it to round up for cron would make cron use different semantics. Countdown formatting was removed when cron switched to this shared format.

- `CHANGELOG.md`: no PR number or URL is available in the issue text or local branch, so a PR link cannot be added without guessing. The issue link is present; add the PR link when one exists.
