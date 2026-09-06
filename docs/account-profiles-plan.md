# Linked account profiles

Status: implemented September 5, 2026. Automated two-account and browser checks pass; live two-account testing remains pending because this login has one real account.

## Delivered behavior and implementation

- The footer shows the name/email from `hey account list`. One account has no fake dropdown; two or more show a keyboard-accessible account picker. All Accounts is excluded. Restart after linking a new account to refresh discovery.
- A profile key hashes the authoritative server origin and numeric account ID. Email/name changes do not create new profiles. The CLI exposes no separate stable login ID; server/account IDs are used, revalidated against the current login on startup and switching.
- Chat indexes, tabs, archived history and Pi working directories live under `profiles/<key>`. The old `chats.json` is copied once to its first selected owner without rewriting IDs or transcript references. The original remains untouched; other profiles never import it. Existing in-memory drafts in an older running build must be saved before restarting; that older build did not persist those buffers.
- Compose/forward/reply buffers, recipients, attachments, the saved-draft editor, unsent chat input and the mail location are persisted locally under versioned profile keys. Settings, models and Helper definitions stay in the existing shared store. Other open editors must be finished or closed before switching.
- Switching reloads the renderer with a new immutable preload token, discarding old caches, contact suggestions and callbacks. Main-process handlers reject old tokens before actions and after reads. Each profile gets its own Pi manager and HEY watcher; retired managers cannot start a delayed Pi process.
- Native mail calls and the embedded Pi HEY tool share account/ID guards. They pass explicit account/server flags, deny overrides, and verify IDs using scoped lists/search results. Restored IDs absent from current memory are checked against named mailboxes (and trash search); verification is bounded by HEY's 100-page listing limit. Unknown objects fail closed and should be located with an account-scoped search before retrying.
- Active agents, pending approvals, inline writing and pending native changes block switching. Interrupted/unconfirmed mail and agent HEY writes leave per-operation receipts, surviving restarts. Switching then requires the user to check the outcome in HEY and explicitly acknowledge it; acknowledgment only clears local receipts, never retries an operation.
- Calendar remains identity-wide and shows “Shared” when multiple accounts are available. Calendar Helper mail research uses the launching profile.

### Deliberate limits

Workflow mutations remain deferred along with the native Workflow feature. Identity-wide Screener clearing is blocked; select individual senders instead. Arbitrary box-ID reads are blocked; use named mailboxes. These restrictions do not change the CLI's global account default. External HEY web links still open the web app, whose account selection is independent; this app cannot impose its profile on the external browser.

Profiles are application organization, not a local-agent security sandbox. User-authorized terminal continuations and normal Pi filesystem tools still run with the OS user's access. Existing migrated transcripts may contain older identity-wide context.

### Verification and how to test

Run `npm test`, `npm run build`, then `node scripts/check-account-profiles.mjs`. The last command launches actual Electron/main/preload with disposable synthetic HEY/Pi executables and temporary XDG roots; no real mail is sent and no model inference runs. It checks two-account discovery, scoped subprocess arguments, isolated chat histories, shared custom Helpers and settings, active-run blocking, stale read/write rejection, wrong-account IDs, pending sends, interrupted-write acknowledgment, and switching back.

Browser checks cover wide dark/light views, the compact collapsed sidebar, menu clipping, keyboard arrows/Escape/focus return, sender display, an empty destination draft, and restoration of the original draft's recipient/subject/body. No console errors were observed. Unit checks cover migration preservation/idempotence, removed accounts, corrupt indexes, scoped IDs, tool approvals and interrupted-write receipts.

On this machine, restart the installed app and check the real footer and existing chat history. With a second linked account, write an unsent reply or new message, close its composer if necessary, switch using the footer, and confirm the other profile has its own mail/chats. Switch back and reopen the composer: the original draft should still be there. A new Helper should be available in both profiles, but its chats should stay separate. Try switching during a Helper run; stop or finish it first.

## Product decisions

- Support linked mail accounts under the existing HEY login only. Separate logins are out of scope.
- Each actual mail account has a separate app profile. Do not offer All Accounts in this first version.
- Show the real account name and email, with initials when no avatar is supplied. Show switching only when multiple accounts exist.
- Switching puts away one workspace and restores the other: mail location, local drafts, chat tabs, session history, and archived sessions.
- Share one Settings surface across profiles, including appearance, sound, shortcuts, model choices, Helper definitions, enabled Helpers, and Helper preferences. Users should not duplicate their Helpers. Profile-specific settings are deferred until requested.
- Helper definitions are shared; each invocation, its attachments, conversation, and resulting draft belong to its launching profile.
- Calendar, todos, habits, time tracking, and Journal remain shared across the HEY identity. Do not imply that switching mail accounts isolates those records. Calendar Helper chats still belong to their launching app profile, and their mail research stays scoped to that profile.

## HEY contract and limits

Verified against installed CLI 1.4.0 and its linked-account documentation:
https://github.com/basecamp/hey-cli/blob/v1.4.0/README.md#linked-accounts

Account selection is a mail filter within one login, not a separate credential store or security sandbox. Explicit account selection takes precedence over environment and persisted defaults. Replies and forwards use the source thread's account. Never mutate the CLI's global account default as part of app switching.

Application profiles prevent accidental context mixing; they do not isolate an unrestricted local Pi process from other files accessible to the OS user. Strong process/credential sandboxing is out of scope and must not be claimed.

## Implementation sequence

1. **Account discovery and profile identity.** Read authoritative linked accounts and login readiness. Exclude the synthetic `all` entry; handle empty, unavailable, removed-account, and auth-error states without falling back to All Accounts. Persist the selected valid account. Determine a stable server/identity/account key from supported data before finalizing storage keys; do not use display names or email alone as identity. Replace the hard-coded footer.
2. **Local state and migration.** Namespace mail caches, contact autocomplete, draft buffers and attachments, conversation selections, chat/session indexes, archived history, Pi transcript/workspace locations, pending approvals, and navigation state by profile. Keep the global settings store shared. Bind any long-lived or restored object references to their origin profile.
3. **Request and agent scope.** Capture the profile at request/run creation, including inline writing, Helper launches, previews, bulk operations, draft sends, undo, and external-link routing. Explicitly apply the captured account to mail calls, with matching tool-policy enforcement. Inspect account semantics and authoritative ownership for ID-targeted commands: `--account` is not sufficient proof that an arbitrary ID belongs to that profile. Deny mismatched/unknown ownership rather than guessing. Reject account-changing tool overrides. Retain identity-wide Calendar behavior.
4. **Switching lifecycle.** Require an active agent/writing run to finish or be explicitly stopped before switching. Temporarily block switching during a send/save or an unresolved external mutation; do not abort and retry an ambiguous send. Preserve unsent drafts locally in their source profile. Cancel obsolete reads/watch subscriptions where possible and discard all late results using profile/request identity. Clear transient selection and popovers; restore only the destination profile's tabs/history. Never retarget a live Pi session.
5. **Read-back and acceptance.** Verify the matrix below, then package/install without changing current user data or sending real mail unasked. No commit, push, or release publication implied by this plan.

## Migration agreed for this machine

The user confirmed the currently linked HEY account is their actual profile. Revalidate discovery at migration time; real account IDs and addresses are not documentation fixtures or application defaults.

Assign existing local drafts and sessions to that confirmed profile once, preserving identifiers, files, and transcript references. Do not copy old history into every new profile. Existing sessions may contain earlier identity-wide context; migration does not retroactively isolate their contents. Preserve global Settings and Helper definitions. If the account cannot be resolved, leave existing data intact and request a choice rather than assigning it to an arbitrary account. Migration must be repeatable without duplicating or losing data.

## Acceptance matrix

- Single linked account: real footer identity, no misleading switch affordance, no All Accounts option.
- Two linked accounts: separate mail results, searches, contact suggestions, tabs, histories, and local drafts; global preferences and Helper definitions remain shared.
- Switch away with an unfinished draft, then return: original body, recipients, attachments, and sender account restored.
- Switch during slow reads: old results never appear in the destination profile, even if cancellation fails.
- Active Helper/inline writing: switch waits or offers an explicit stop; no output or approval transfers to another profile.
- Sends, draft actions, undo, and referenced-object actions retain their original account and fail closed on mismatch.
- Calendar remains visibly identity-wide; mail research from Calendar Helpers uses the launching profile.
- Restart: selected profile, its tabs/history, drafts, and shared settings restore correctly.
- Missing account or changed login: no automatic fallback to All Accounts, no exposure of another profile's data.
- Existing-state migration: idempotent, preserves all content, and does not duplicate sessions.
- Deterministic two-account fixtures exercise native IPC, child-process account arguments, and agent tool policy. A real second linked account is required before claiming live multi-account verification; current login has only one actual account.

## Deferred

Separate HEY logins; All Accounts/unified inbox; per-profile Settings or Helper overrides; cross-profile chat/context transfer; background cross-profile agent runs; OS-level security isolation.
