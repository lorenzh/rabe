---
title: Pane interaction state
description: The pure transitions that keep pane focus, held order, regain retries and destructive controls safe.
tags: [architecture, focus, keys, state]
keywords: [interaction, interaction.ts, state machine, focus, arming, hold, regain, arrow keys, all-fit, opening]
---

# Pane interaction state

`hooks/ui/interaction.ts` owns the pane's interaction state. `pane.tsx` feeds events and runs the returned effects through the mod API. The model reads no files and calls no API.

The state holds the ring key, the pending focus key and the last landing evidence. It also holds each surface's focus order and placement. Arming uses the existing pure `arm` rules. A module reload starts with the disarmed `IDLE` state.

| Event | State change or effect |
|-------|------------------------|
| `opened` | Clear held order and landing evidence. Disarm and request the keyboard after 50 ms. |
| `refocused` | Stop opening retries when the pane has the keyboard or is closed. Otherwise request another drawing, up to 40 focus requests. |
| `press-start`, `press-end` | Track presses whose focus work is pending. |
| `reset` | Disarm and clear ring evidence and pending regain. Remember the prior key during a press. Keep held orders until the next view draws. |
| `focus-start` | Clear the previous landing evidence and record the requested key before a plugin focus call. |
| `focus` | Record the engine's landing. Cancel regain and apply the arming rules. |
| `unfocused` | Clear ring evidence when focus reaches an engine stop. |
| `step`, `landed`, `press`, `drawn` | Apply the existing arming transitions. |
| `render` | Check fallback and control targets with the arming rules. Draw the view and feed `draw`. |
| `draw` | Hold the focus order. Request regain after inserted rows, opening focus retries, or focus after a resize. |
| `regained` | Clear a successful regain. Disarm after refusal and allow at most three tries per keyboard grant. Ignore stale results. |

## View changes and arrows

Before a view changes, the pane moves the ring onto a safe tab in the old tree. Tabs keep their indexes in every view. The pane then draws the new view and lands on its row or control. Search edits keep the search Input instead.

In a scrolling pane, row arrows join the press sequence through `ui.scroll`. In an all-fit pane, the engine raises a person-originated `ui.focus`. If a press is pending, `deferredFocus` records that move against the old held order. The pending focus key covers arrows received before the safe-tab landing returns. It also keeps the safe-tab origin for an arrow delivered after the press ends. Repeated `autoFocus` landings keep that origin. The next person move consumes it. After the press lands, `movedFocus` applies it to the new held order. The pane requests fresh focus instead of sending the engine an old focus request. Separate person and plugin focus hooks let the fresh call reach Rabe. The plugin hook checks the engine trace before it records a landing.

If a carried arrow lands as asked on a live row, it arms list controls. Plugin landings after view changes leave list controls disarmed. External stop, delete, copy and message calls release the focus sequence before waiting.

## Safety rules

The renderer keeps its append-only focus rule and inert gone slots. The Items and Effects lists can insert rows into their groups. While a regain is pending, the pane holds back row and group presses.

The press hook handles fixed tab actions directly. When a drawing releases a tab handler, its key still works. Item and Input handlers still expire with their drawings. The pane drops stale item and Input events.

See [Focus order and arming](focus-order.md) for target and arming rules. See [Focus and keys](focus-and-keys.md) for the controls. `interaction.test.ts` checks transitions and the queued all-fit arrow sequence. Existing pane and renderer tests continue to check the API boundary and held order.
