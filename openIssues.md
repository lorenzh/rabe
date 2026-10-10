# Open review findings

- `hooks/ui/format.ts`: keeping `duration()`'s floor rounding is intentional. It is the pane's shared elapsed-duration format; changing it to round up for cron would make cron use different semantics. Countdown formatting was removed when cron switched to this shared format.
