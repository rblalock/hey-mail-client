# Roadmap

## Next

- First-run setup for HEY/Pi readiness and login guidance.
- Signature-verified in-app updates with restart approval and preserved app data. Updates are manual today.
- Live testing with a second linked account. The laptop install passed; real two-account switching still needs testing.
- Investigate intermittent typing failure after opening the app. Hiding/showing restored input; it has not been reproduced. On recurrence, check window focus, active element, inert ancestors, and dialog state without logging typed text. Don't add unconditional refocus loops.

## Deferred

### Mail and desktop

- Richer Markdown composition controls.
- Sticky/merge bulk actions where supported by the CLI.
- Session working-directory selection.
- Desktop notification and sound behavior; optional per-cue controls if needed.

### Helpers and agents

- Write Like Me with explicitly selected writing samples.
- Helper imports, sharing/export, version history, and cross-machine sync.
- HEY Workflows and Workflow Organizer. Not currently in scope.
- Scheduled briefs, auto-drafts, triage triggers, and unattended Helpers, with opt-in authority, cost limits, cancellation, and recovery.
- More local handoff adapters and remote/URL integrations. Handoffs remain one-way; results synchronization is not promised.
- Other embedded harnesses or an Omarchy agent broker if a suitable host contract becomes available.

### Calendar and distribution

- Native create-from-email, RSVP, and calendar creation/settings/sharing/import where the CLI supports them. External calendars stay read-only.
- Broader Linux/ARM64 testing and Omarchy packaging/marketplace support.
- Shared app metadata across machines. Per-profile Settings/Helper overrides only if requested.
- Verified signing-key rotation and recovery before changing the release trust anchor.
