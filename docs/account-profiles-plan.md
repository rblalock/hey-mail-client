# Linked account profiles

Linked mail accounts under one HEY login have separate app workspaces. Separate logins and an All Accounts view are not supported.

## Behavior

- The footer shows the real name/email from HEY. Switching appears only with multiple linked accounts.
- Mail location, compose/reply/forward buffers, saved-draft edits, unsent chat input, chats, and archived history belong to a profile.
- Appearance, sound, shortcuts, model choices, and Helper definitions are shared.
- Calendar, todos, habits, Journal, and time tracking remain identity-wide. Calendar Helper mail research uses the launching profile.
- Finish or stop active agents and inline writing before switching. Pending writes, approvals, and other open editors can also block switching.
- After an interrupted write, check its outcome in HEY before acknowledging the local receipt. Acknowledgment does not retry it.
- Restart after linking a new account to refresh discovery.

## Implementation boundaries

- Profile keys hash the authoritative server origin and numeric account ID, not the name or email.
- Chat indexes and Pi workspaces live under `profiles/<key>`. Composer/navigation buffers use versioned profile storage keys.
- Switching reloads the renderer with a new immutable preload token. Old callbacks, reads, and writes cannot retarget the new account.
- Native mail and embedded HEY calls use explicit account/server scope without changing the CLI's global default.
- ID-targeted commands also check object ownership. Unknown IDs fail closed; locate them through account-scoped search. Verification is bounded by HEY's listing limit.
- Workflow mutations, identity-wide Screener clearing, and arbitrary box-ID reads remain blocked. Use individual senders and named mailboxes.
- External HEY web links use the browser's account selection, not an enforced app profile.

Profiles prevent accidental context mixing; they are not an OS sandbox around Pi or external agents.

## Existing data

Legacy chat history is copied once to its first selected owner without changing IDs or transcript references. The original remains intact and other profiles do not import it. Migration is repeatable; an unresolved account must not cause arbitrary reassignment.

Older transcripts can contain identity-wide context. Migration does not retroactively isolate their contents.

## Test

```sh
npm test
npm run build
node scripts/check-account-profiles.mjs
```

The smoke check uses real Electron/main/preload with synthetic HEY/Pi executables and temporary XDG roots. It covers two-account discovery, scoped arguments, separate histories/drafts, shared Helpers, stale requests, wrong-account IDs, pending writes, migration, and switching back. It does not send real mail or invoke a model.

Live two-account testing remains a release check:

1. Leave an unsent draft in one account, switch away, then return and check its recipients, body, and attachments.
2. Confirm mail and chats stay separate while a new Helper is available in both profiles.
3. Confirm switching is blocked during a Helper run and Calendar remains shared.
4. Restart and check the selected account and its saved state.

The remaining profile features are tracked in the [roadmap](plan.md).
