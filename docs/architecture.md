# Architecture

Electron main owns HEY/Pi subprocesses and validated IPC. React renders mail, Calendar, and the chat rail through a context-isolated preload. Keep the renderer sandboxed; there is no generic shell bridge.

## HEY and Pi

- The installed HEY CLI and `hey watch` supply authoritative mail and Calendar state.
- Pi runs locally through RPC with the user's configuration and installed HEY skill. The app adds its extension; it does not replace Pi's planner or route natural language through keyword rules.
- The extension's `hey` tool accepts structured argv, executes without a shell, checks authority, and returns structured results. `hey_agent_app` handles presentation actions, not arbitrary clicks or data mutations.
- Successful tool results refresh affected native views and become attachable objects. Unsupported commands fail explicitly.
- Pi and external agents run with the OS user's access. App profiles and tool approvals are not an OS sandbox.

The bridge shares one argv parser for ownership checks and approvals. Values stay literal, including text beginning with `--`; unknown flags and unsupported shorthand forms stop before execution. `resources/hey-cli-flags.mjs` defines the supported subset, not the whole CLI. When adding an option, check its type and aliases with the installed command's `--help` and add a regression test. Never infer an unknown flag's arity or treat it as harmless. Calendar calls use the profile's server/environment but remain identity-wide, not isolated by mail account.

## Context and identity

Attachments are explicit and persist with the session. Opening another email must not change an existing chat's context. Mail bodies, files, and selected text are untrusted data, not instructions or authorization.

Keep account, posting, topic, contact, draft, and clearance IDs distinct. Calendar rows retain both series and occurrence identity; use expanded Day/Week reads. Bundle reads use posting IDs, full contact history uses contact IDs, and Set Aside groups have their own IDs.

Native `hey-agent:` links open the existing center surface. Missing objects stay missing; an explicit read-only request can ask Pi to find possible matches. Never silently replace an ID using a similar name.

Library opens contacts, labels, and Collections into conversation lists, using 50-thread cursor pages. AI object previews remain limited to four threads. Returning from a Library conversation retains its loaded pages, filter, and scroll. HEY CLI 1.4.3 only lists attachments per thread, so there is no aggregated All Files or contact-files browser; do not build a background mailbox crawler to approximate one.

## Linked profiles

- Linked accounts under one HEY login have separate mail, drafts, chats, history, and pending actions. No All Accounts view or separate-login support.
- Appearance, sound, shortcuts, models, and Helper definitions are shared. Calendar remains identity-wide.
- Profile keys hash server origin and account ID. Chats/workspaces live under `profiles/<key>`; legacy history migrates once to its first selected owner.
- Switching reloads the renderer with a new immutable preload token. Stale requests must not retarget another account.
- Native and embedded mail calls pass explicit account/server scope and check object ownership without changing the CLI default.
- Active runs, approvals, open editors, and unresolved write receipts can block switching. Acknowledging an interrupted write does not retry it.

## Approval and recovery

Read-only work, unsent drafts, specific reversible organization, and presentation actions follow the embedded policy without extra confirmation. Sending, invitations/shared-calendar writes, destructive changes, Screener decisions, recurrence, and broad or unclassified mutations require exact review or remain blocked.

Review binds to the operation, account, targets, recipients, content, attachments, dates/time zone, and recurrence as applicable. Execute the reviewed values once. Material changes invalidate approval. Use the native review rather than adding a second conversational confirmation.

Bound execution time and output, support cancellation, and never blindly retry an ambiguous write. Read authoritative state first; report partial completion. Only offer undo when the CLI has a real undo contract. Authentication, credential export, trust changes, and setup are not embedded chat operations.

## Writing and handoffs

Inline writing uses a task-scoped Pi process with tools/extensions disabled and the Quick model profile. It preserves the draft on stop or failure. Review allows editing and comparison before replacing only the body; changed source context invalidates stale suggestions. Inline Restore is separate from rail-to-reply review.

External handoffs are reviewed one-way prompts. They include bounded recent conversation, object references, scoped lookup commands, and local Pi history paths—not credentials, file contents, or unsent composer text. Web agents cannot access local paths merely because they appear in a prompt. Continue in terminal resumes Pi; a handoff starts a new destination session.

Prepared handoffs expire after 30 minutes or source changes. Local launches retain a private prompt file under the profile workspace (`0700` directory, `0600` file); successful files have no automatic expiry cleanup. A failed launch removes its new file. Launch success is not proof of destination authentication or task completion.

## UI and testing

Keep mail useful without AI. No model calls on hover, navigation, startup, or preference changes. Preserve live Omarchy theme/font updates, compact layouts, and app identity `dev.heyagent.desktop` with existing `hey-agent-app` data paths.

Dialogs own their shortcuts, contain focus, and restore the opener. Submission/destructive keys reject repeat and IME events; list navigation accepts held keys. Custom bindings validate syntax and contextual conflicts before saving; failed updates preserve the working binding.

Run `npm run typecheck`, `npm test`, and `npm run build`. After keyboard or account-boundary changes, also run `node scripts/check-keyboard.mjs` and `node scripts/check-account-profiles.mjs`. These use synthetic boundaries, not live mail/model proof. See [behavior tests](evaluations.md).
