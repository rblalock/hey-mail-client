# Product and roadmap

Current decisions and remaining work. Installation is in the [README](../README.md); publishing is in [release.md](../release.md).

## Product

A keyboard-first HEY desktop client with mail in the center and Pi chats in an independent right rail. Mail must remain useful without an agent. The app opens in Inbox and follows HEY's concepts rather than inventing another mail system.

## Keep these boundaries

- Electron main owns HEY/Pi subprocesses, credentials, and validated IPC. The React renderer is sandboxed behind a context-isolated preload; no generic shell bridge.
- Use the installed HEY CLI and `hey watch` for authoritative mail and Calendar state.
- Use the installed Pi through RPC, with its normal configuration and an additive HEY Agent extension. Don't build a second agent runtime or a natural-language intent router.
- Attach context explicitly. Keep posting, topic, contact, account, event-series, and occurrence IDs distinct.
- The selected mail account owns its drafts, caches, chats, and pending actions. Settings and Helper definitions are shared. Calendar remains identity-wide. See [account profiles](account-profiles-plan.md).
- Read-only and bounded reversible organization follow the embedded tool policy. External, destructive, broad, and unknown changes require exact review. Never blindly retry an ambiguous write.
- A local Pi process is not a security sandbox. See [agent boundaries](agentic-hey-requirements.md).
- Preserve the app identity `dev.heyagent.desktop` and existing `hey-agent-app` data paths. Updates must not rename or discard user data.
- Preserve live Omarchy theme/font changes, keyboard ownership, and compact layouts.

## Implemented

- HEY mailboxes, search, screening, labels, Collections, bundles, Set Aside groups, and bulk actions.
- A single primary reader, sanitized HTML, Markdown fallback, reply/forward/compose, drafts, and recipient typeahead.
- Sender-first lists with optional avatars; Bubbled Up, New For You, and Previously Seen sections.
- Paper Trail's account-scoped, device-local visit divider. It does not sync with HEY or infer visits from unread state.
- Held-key navigation, range selection, configurable shortcuts, and hover/focus hints. See [keyboard behavior](shortcut-discoverability-audit.md).
- Calendar Day/Week/Year, search, writable event management, todos, habits, Journal, and time tracking within supported CLI contracts.
- Concurrent Pi chats, persistent context, session history, and local file/selected-text attachments.
- Six built-in Helpers, personal Helpers, inline writing, model profiles, and contextual object previews.
- Reviewed draft comparisons and one-way external agent handoffs. See [AI surfaces](ai-experience-plan.md).
- Local AppImage builds, user-local install/update/remove, signed manifests, and direct GitHub release uploads. No GitHub Actions.

These are implementation statements, not a claim that every path has passed live multi-account or cross-machine testing.

## Next

- Finish [public release readiness](public-release-readiness.md): history/privacy review, license and branding checks, vulnerability reporting, first signed download/install, and server-side release immutability.
- Investigate [intermittent input focus](input-focus-investigation.md). Not reproduced or fixed.
- Test a real second linked account and the downloaded installer on a second machine.
- Add a setup wizard for HEY/Pi readiness and first-run login guidance; don't gather credentials in chat.
- Design signature-verified in-app updates with explicit restart approval and preservation of user data.

## Deferred, not dropped

### Mail and sessions

- Richer Markdown composition controls.
- Sticky and merge bulk actions, only with supported CLI contracts and review.
- Working-directory selection from session options.
- Notifications: decide how app sounds and desktop notifications should cooperate before enabling background cues.
- Optional per-cue sound controls if usage warrants them.

### Helpers and agents

- Write Like Me, using explicitly chosen examples rather than silently scanning sent mail.
- Third-party Helper imports, sharing/export, version history, and cross-machine sync.
- Native HEY Workflows and Workflow Organizer. Deferred by product choice; do not expose unsupported Workflow mutations or placeholder navigation.
- Scheduled briefs, auto-drafts, triage triggers, and unattended Helpers. Require opt-in authority, cost limits, visibility, cancellation, and recovery.
- Additional local handoff adapters and remote/URL integrations. One-way transfer remains the scope; importing or syncing results is not promised.
- Other embedded harnesses, OpenCode/ACP, or an Omarchy agent broker if a stable host contract becomes available.

### Calendar and distribution

- Create-from-email, invitation RSVP, and calendar creation/settings/sharing/import only when the CLI exposes the required authority and identity.
- Keep external calendars read-only; never make an unlinked duplicate and call it an edit.
- Broader Linux/ARM64 compatibility testing and Omarchy packaging/marketplace assessment.
- Shared app metadata across machines; per-profile Settings or Helper overrides only if requested.
- A safe key-rotation/recovery process before changing the release trust anchor.

## Verification

Run typecheck, tests, and the production build. Use synthetic fixtures for mail/Calendar changes. Run the keyboard and account-profile smoke checks when their boundaries change; label synthetic proof separately from live service or model testing.

Detailed behavioral cases: [agent evaluations](agentic-hey-evaluation.md). Open distribution checks: [release readiness](public-release-readiness.md).
