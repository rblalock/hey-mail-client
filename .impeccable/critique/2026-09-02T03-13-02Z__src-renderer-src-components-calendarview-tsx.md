---
target: src/renderer/src/components/CalendarView.tsx
total_score: 35
max_score: 40
p0_count: 0
p1_count: 0
method: dual-agent
timestamp: 2026-09-02T03-13-02Z
slug: src-renderer-src-components-calendarview-tsx
---
# Calendar design critique

Method: dual-agent assessment (Assessment A: `/root/calendar_design_assessment`; Assessment B: `/root/calendar_detector_assessment`)

## Baseline

Design specificity: partial pass. The day/week structure and quiet HEY treatment were recognizable, but the surface behaved like a read-only inspector rather than a complete operating surface.

| Heuristic | Score |
|---|---:|
| Visibility of system status | 2/4 |
| Match to real-world calendar model | 3/4 |
| User control and freedom | 2/4 |
| Consistency and standards | 2/4 |
| Error prevention | 3/4 |
| Recognition rather than recall | 2/4 |
| Flexibility and efficiency | 2/4 |
| Aesthetic and minimalist design | 3/4 |
| Error recovery | 3/4 |
| Help and documentation | 1/4 |
| **Total** | **23/40** |

Priority findings were the absent creation path, visual highlighting without real focus, viewport-based rather than pane-based responsiveness, seven repetitive empty-day dead ends, an inconsistent loading treatment, and an event-detail title louder than the mail reading surface.

## Treatment

Design specificity: pass. The Calendar now behaves as a HEY-native operating surface with native creation, a compact agenda, a wide week board, exact keyboard focus, clear source-of-truth handoffs, and calm loading and empty states.

| Heuristic | Score |
|---|---:|
| Visibility of system status | 4/4 |
| Match to real-world calendar model | 4/4 |
| User control and freedom | 3/4 |
| Consistency and standards | 4/4 |
| Error prevention | 4/4 |
| Recognition rather than recall | 3/4 |
| Flexibility and efficiency | 4/4 |
| Aesthetic and minimalist design | 4/4 |
| Error recovery | 3/4 |
| Help and documentation | 2/4 |
| **Total** | **35/40** |

What worked:

- New event is available in the header, from empty dates, by double click, and with `N`.
- Container queries produce a seven-column week board when space allows and an agenda when the Calendar pane is compact.
- Actual event focus replaces an unowned visual highlight; detail and composer restore the exact triggering control.
- Initial load preserves the calendar structure with a stable skeleton. Refresh keeps the last good result visible.
- Empty ranges have one actionable state instead of seven repeated absences.
- Event detail now shares the mail reader's typographic authority.
- Invitation creation adds an immutable review before sending invitations.

Detector results:

- Baseline deterministic detector findings: 0.
- Treatment deterministic detector findings: 0.
- Browser errors: 0.
- Compact portal stacking, exact trigger restoration, compact shortcut footer, and forward/backward focus trapping: verified.

Remaining product work is intentionally outside this treatment: guarded deletion for shared and recurring events, broader HEY Calendar surfaces, and the shell-level policy for simultaneous compact navigation and agent rails.

## Persona check

- Keyboard-first user: resolved for creation, range navigation, event traversal, filter, detail, and dialog focus.
- Keyboard and screen-reader user: resolved for modal trapping and focus restoration; unsupported HEY surfaces still need their own semantics when built.
- Compact-window user: Calendar content adapts to its actual pane width; the larger app shell still needs a deliberate rail policy.

## Why this approach

The treatment fixes the smallest complete Calendar loop: accurately read the visible range, create a full event, reconcile it immediately, and preserve a clear handoff to HEY for unsupported mutations. It avoids inventing CLI capabilities and keeps irreversible actions out until their blast radius can be explained.

Provocative next questions:

1. Should guarded delete be the next mutation, with explicit shared-calendar and entire-series language?
2. At compact widths, should the agent rail become modal or should the navigation rail auto-collapse?
3. Should the next HEY-native slice be event-to-agent context or a focused Journal and Time Tracking surface?
