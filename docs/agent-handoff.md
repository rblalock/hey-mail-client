# Continue in another agent

A user-reviewed, one-way transfer from an existing HEY Agent chat into another agent. Pi remains the app's runtime. There is no results import, automatic sync, or new integration runtime.

## Using the handoff

1. Open a chat in HEY Agent. Attach any mail, Calendar object, file reference, or selected text you want represented before opening the handoff. Let an active run finish or stop it first; a pending agent request also blocks handoff.
2. Open the chat's **Session options** (`…`) and choose **Continue in another agent…**.
3. Confirm the chat title and mail account. Review the **Handoff prompt**, edit the next task, and remove anything you do not want to share.
4. Leave **Copy for any agent** selected and choose **Copy prompt** to paste into any local or web agent. Alternatively, select a detected local agent and choose **Open [agent name]**. Copy remains available with a local destination selected.
5. For a local launch, check the new terminal for sign-in, model, permission, or startup errors. Opening submits a seed prompt to a new session and can invoke the destination's model. Its own model settings, permissions, and normal provider costs apply.

The separate **Continue in terminal** action still resumes the original Pi session. Choosing **Pi** in this new dialog starts a new session instead. Work done outside HEY Agent does not sync back into the source chat.

## What is shared

The editable prompt contains the task, chat and account identity, capture time, local workspace and Pi transcript paths, Pi session ID, recent conversation and readable tool outcomes, and selected or recently returned object references. It includes native links and explicit account/server-scoped HEY CLI read commands where the object has a supported lookup. Calendar remains identity-wide.

The capture is bounded to the last 12 timeline entries and up to 25 references, with further character limits. Long entries are truncated and older entries or additional references can be omitted; the prompt marks those omissions. Selected local text is included, up to its limit. Local file contents and unsent text in the email or chat composer are excluded. Attachments are references, not automatic file uploads. Raw tool traces, Helper instructions, and the full Pi transcript are not exported, although its local path is included for relevant history lookup.

Preparing a handoff does not fetch more mailbox content. Mail already quoted in the chat, selected text, and tool summaries can contain sensitive information; the app does not redact that user content automatically. It does not gather or export HEY credentials. The local launch removes the app's bridge variables and explicit HEY token/cookie/config overrides from its child environment, while retaining normal external-agent configuration and setting the chosen account/server.

A web or remote agent receives only the pasted text. Local paths, native links, and CLI examples do not grant it access to this computer or HEY login. A local agent may use its existing tools and stored authentication. The prompt asks it to verify current state and request approval for external changes, but HEY Agent cannot enforce those instructions or carry its own approval UI into the destination.

## Destinations and persistence

Local discovery checks installed executables and recognized `--help` output for Pi, Codex, Claude Code, Hermes, Cursor Agent, and Grok CLI. Recognition establishes a supported command form, not authentication or model availability. Local opening also requires `xdg-terminal-exec`, Alacritty, or Ghostty. Discovery is cached for the active account runtime; unsupported or unavailable destinations retain the universal copy path. There is no direct web-agent, OpenClaw, arbitrary script, or custom adapter integration.

Preview and copy create no prompt file. Prepared previews stay in memory, expire after 30 minutes, and are rejected if their source conversation or attachments change or if the account switches. Preserve any edits before closing a stale preview and preparing another.

Local opening writes the exact reviewed UTF-8 text to `<profile workspace>/handoffs/<handoff id>/prompt.md`, with directory mode `0700` and file mode `0600`. The prompt file remains after a successful terminal launch; there is no expiry cleanup for those files. The 30-minute preview expiry does not remove them. A launch failure removes the newly created file and leaves the copy path available. One prepared handoff can open a terminal only once, preventing duplicate launches. Terminal spawn success does not confirm that the destination authenticated, read the file, or completed the task.

## Interface contract

This is a narrow extension of the existing native review-dialog pattern. The modal protects keyboard focus and app shortcuts while the user reviews what leaves the chat. Its reading order is title/account, destination, roomy editor, disclosure, and actions. Escape closes the dialog when no action is in flight; focus returns to Session options. Errors preserve edits and status messages distinguish copying from a requested terminal launch.

The implementation uses the app's existing surface, field, ink, border, accent, and font tokens. Desktop width is capped at 940 px, with compact-window sizing below 800 px; the editor takes the available height and footer buttons wrap. Future refinements should preserve this hierarchy and the destination-specific disclosure without changing global tokens or introducing a branded integration dashboard.

## Verification

Tests cover bounded prompt construction, account-scoped references, malformed payload rejection, exact edited-text copy/file read-back, private permissions, stale/expired/foreign previews, launch failure cleanup, and duplicate launch prevention. Synthetic keyboard checks covered the dialog. Production-build account-profile checks exercised the real preload/IPC boundary with a fake terminal and clipboard spy, including account isolation and preserved source session identity.

Reproduce the local checks after building:

```sh
npm test
npm run build
node scripts/check-keyboard.mjs
node scripts/check-account-profiles.mjs
```

These checks did not invoke an actual external model or write live mail. A real destination's authentication, model execution, file-reading behavior, and subsequent actions remain user-path validation in that destination. Custom adapters and remote/URL integrations are possible later extensions. Results import and synchronization are outside the approved scope, not prerequisites or committed follow-up work.

Implementation sources: `src/main/agent-handoff.ts`, `src/main/agent-handoff-prompt.ts`, `src/shared/handoff.ts`, `src/renderer/src/components/AgentHandoffDialog.tsx`, the session menu in `AgentPane.tsx`, and the `.agent-handoff-*` rules in `styles.css`.
