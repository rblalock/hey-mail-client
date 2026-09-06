# HEY Agent product and implementation plan

Last updated: 2026-09-06

This file is the durable source of truth for the product direction, architecture decisions, completed work, and next milestones. Keep it current as decisions change and slices land.

## Product definition

HEY Agent is an Omarchy-native graphical HEY client with the interaction density and keyboard fluency of Superhuman, the application structure of Beautiful UI's Harness, and a user's existing local agent as a first-class collaborator.

The app should be useful as an excellent email application without the agent. The agent should become substantially more useful because it can see and manipulate the app's selected email, people, drafts, calendar state, and rendered artifacts.

The app always lands in Imbox.

## Locked decisions

- Desktop runtime: Electron.
- Renderer: React, Vite, Tailwind CSS.
- Visual reference: Beautiful UI Harness, adapted to HEY rather than redesigned into a generic dashboard.
- Icons: use an open-source icon set instead of Beautiful UI's commercial Central Icons dependency.
- Mail authority: the installed `hey` CLI using structured JSON output and `hey watch` for changes.
- Agent harness for the first supported release: the user's installed Pi.
- Pi integration: launch the system `pi --mode rpc`; do not bundle a second Pi runtime.
- Pi identity: preserve the user's normal authentication, models, settings, skills, extensions, tools, and sessions.
- Model selection: the default remains no `--provider` or `--model`, preserving Pi's configured model. The planned AI model settings may explicitly choose a General model for newly created app sessions and a separate Quick writing model without rewriting Pi's own configuration or changing an active session behind the user.
- Product language: say “HEY Agent” in ordinary UI. Mention Pi only where the implementation matters, such as setup, diagnostics, or advanced settings.
- Default working directory: `~/.local/share/hey-agent-app/workspace`, following `XDG_DATA_HOME` when set.
- Configuration: `~/.config/hey-agent-app`, following `XDG_CONFIG_HOME` when set.
- State and diagnostics: `~/.local/state/hey-agent-app`, following `XDG_STATE_HOME` when set.
- Pi transcripts remain Pi-owned. The app stores only the metadata needed to connect a HEY Agent session, UI state, and HEY artifacts to a Pi session.
- HEY Agent tabs and HEY artifacts are many-to-many. A session may attach no thread, one thread, or several threads; a thread may be referenced by several sessions.
- Open sessions are concurrent. Each tab owns a separate system Pi RPC process, switching tabs does not stop work, and closing a tab preserves its transcript link in the sidebar.
- A session may choose another working directory. That directory controls normal Pi project context and project-level settings.
- Interactive sessions use the user's real Pi authority. Background automation will require separately declared authority and review behavior.
- Electron renderer remains sandboxed and receives only narrow, typed IPC operations. It never receives a generic command-execution bridge.
- Omarchy theme and font changes must apply live without restarting the app.
- HEY has no generic archive concept. Paper Trail is a sender destination for transactional mail, not an archive. Seen Imbox mail remains in Imbox under Previously Seen.
- Message reading prefers HEY's original HTML in a sanitized, style-isolated document while preserving Markdown/plain text as the fallback and as the agent-context representation.
- Sender screening is persistent HEY routing. Approving a sender into Imbox, The Feed, or Paper Trail uses the sender's Screener clearance and HEY's designation-box operation; moving one conversation never pretends to teach HEY a sender rule.
- Shortcut behavior is a user setting with three packages: HEY-like, Superhuman, and Custom. The default favors native HEY bindings while retaining non-conflicting Superhuman aliases.

## Product interaction model

### Mail surfaces

- Sidebar destinations: Imbox, The Feed, Paper Trail, Reply Later, Set Aside, Bubble Up, The Screener, Calendar, Sessions, Library, and future HEY surfaces as CLI coverage is connected.
- Dense list-to-reader interaction. Selecting a conversation replaces the mailbox list in the primary workspace; Back restores the mounted list with its search, selection, and scroll state intact.
- Message content never competes with a second mail column. The persistent, independently collapsible right rail belongs to HEY Agent sessions and attached context.
- The left application navigation is explicitly collapsible. Collapsing it changes the real layout geometry, keeps its reopen control reachable, and anchors shortcut tooltips to the compact rail rather than to hidden expanded controls.
- Imbox is a structured home surface rather than a flat box: pending Screener senders appear at the top, followed by Bubbled Up (when reminders return), New For You, and Previously Seen. HEY's `bubbled_up` flag takes precedence over seen/unseen status; returned reminders have their own count and marker, and do not inflate the New For You sidebar count. Row grouping and keyboard navigation share that order. The latest Reply Later item appears as one centered stacked-card handoff at the bottom. Set Aside and scheduled Bubble Up remain direct sidebar destinations rather than competing Imbox footer blocks.
- `E` marks an Imbox conversation seen and moves focus from New For You to Previously Seen. It never moves mail to Paper Trail.
- Keyboard behavior follows an explicit HEY/Superhuman compatibility matrix rather than a loose approximation.
- Native numeric navigation is preserved: `1` Imbox, `2` Feed, `3` Paper Trail, `4` Reply Later, `5` Set Aside, `6` Bubble Up, `9` Previously Seen, and `0` Calendar. HEY's unused `7` and `8` slots become Sessions and Screener.
- Session navigation remains application-level: `Ctrl+T` creates, `Ctrl+W` closes, `Ctrl+Tab`/`Ctrl+Shift+Tab` traverse, and `Ctrl+1` through `Ctrl+9` activate open session tabs.

### Agent surfaces

- Contextual agent: attached to the selected thread, message, contact, draft, or calendar event.
- Durable session: a named Pi session that can span many HEY artifacts and local-machine tasks.
- App artifacts such as drafts, comparisons, approvals, and search results render as native UI instead of transcript-only text.
- Natural-language HEY operations may combine the attached artifact with authoritative mail, contact, and Calendar reads. A request such as “that time works; create the event and invite him” should resolve “that time” and “him” from the explicitly attached thread, present the exact event for approval, execute it once through HEY, and reconcile the result into both chat and Calendar.
- Any app-created session can continue in terminal Pi using the same Pi session.
- AI follows the three-surface contract in [AI experience plan](./ai-experience-plan.md): the right rail owns conversation and compound work, `Ctrl+K` connects list/detail/selection context to the agent, and the mail composer owns a restrained inline writing loop. All three use Pi and the same stable-object and approval boundaries.

## Architecture boundary

```text
React renderer
    │ narrow typed commands and events
    ▼
context-isolated preload
    │
    ▼
Electron main process
    ├── HEY service        -> installed hey CLI + hey watch
    ├── agent supervisor   -> installed pi --mode rpc
    ├── theme watcher      -> Omarchy current theme/font state
    ├── app state          -> local metadata and action history
    └── OS integration     -> notifications, launcher, safe handoffs
```

The app explicitly loads one additive HEY Agent Pi extension for the narrow HEY execution and native-app presentation boundaries. It does not replace or suppress the user's existing Pi configuration, skills, extensions, tools, authentication, model, or session ownership.

## Completed foundation

- Electron, React, Vite, and Tailwind scaffold.
- Sandboxed renderer and context-isolated CommonJS preload.
- Validated per-domain IPC; no renderer shell access.
- XDG path resolution and tests.
- System HEY and Pi executable/version probes.
- Omarchy current theme and font application on startup.
- Live Omarchy theme and font propagation without restarting Electron.
- Imbox as the default route.
- Live HEY Imbox list through `hey box view imbox --json`.
- HEY thread reading, including the CLI's array-shaped thread response.
- Posting IDs and topic IDs kept distinct.
- Harness-derived sidebar, dense mailbox lists, primary message reader, reply surface, and persistent contextual HEY Agent rail.
- Keyboard `j`/`k` row navigation and `/` search focus.
- Sanitized rich email rendering with safe external links, HEY-proxied imagery, gated arbitrary remote content, and Markdown fallback.
- Development-only fake-data visual preview.
- Production build and live Electron IPC/HEY verification.
- System Pi RPC supervision with strict LF-only JSONL decoding.
- Pi readiness, configured default model, session ID, transcript path, and working-directory reporting.
- Streaming assistant messages, compact tool activity, cancellation, retry/error notices, and interactive extension prompts.
- One or more HEY conversations attached as visible context chips and supplied as bounded, explicitly untrusted context.
- Pi-owned session resumption across app restarts and app-owned chat-link metadata.
- “Continue in terminal” through Omarchy's terminal launcher using the same Pi session file.
- Global Harness-style session tabs with create, activate, close, keyboard traversal, `Ctrl+T`, and `Ctrl+W` behavior.
- Real persisted sessions in the collapsible sidebar; closed tabs remain reopenable and do not delete Pi transcripts.
- A concurrent Pi session manager with one lazily started process per open/running tab.
- Chronological agent timelines with Markdown responses and completed activity collapsed into a single plain-language run disclosure.
- Tool detail disclosure with humanized action labels, quiet targets, failures, durations, and sanitized bounded result detail.
- In-app approval/input cards with focus management and precise request-ID responses.
- Context attachment and removal from any tab, including an explicit “Add email to session” action when viewing an unrelated session beside email.
- Contrast-safe Omarchy theme derivation, complete light/dark variable replacement on every live theme change, a readable UI type stack, and Omarchy's font reserved for technical chrome.
- A bounded Impeccable visual pass covering full-width chat, contextual side-panel chat, the fixed composer send control, collapsed and expanded activity, and accessibility semantics.
- Primary mail chrome omits global theme and workspace diagnostics; the Imbox footer is reserved for contextual keyboard hints.
- Feed, Paper Trail, Set Aside, Reply Later, Screener, global search, drafts, contacts, labels, collections, and contact-bundle ungrouping are connected through typed HEY IPC.
- Compose, reply, forward, attachments, draft save/edit/send/delete, read/unread, box moves, Trash, Spam, Ignore, and reversible-action notices are functional.
- A supervised websocket-backed `hey watch` process normalizes change metadata and invalidates the affected live mailbox without polling.
- A centralized shortcut registry drives both direct Superhuman-compatible core mail keys and the discoverable `Ctrl+K` command palette.

## Completed milestone: real HEY Agent sessions

The application starts the installed `pi --mode rpc` lazily in the app workspace and supplies no provider, model, configuration-directory, skill, or general tool overrides. It adds the packaged HEY Agent extension explicitly while Pi retains its normal authority, machine setup, installed HEY skill, and other discovered extensions. The renderer sees a narrow, normalized snapshot rather than the raw RPC stream.

App metadata lives in `~/.local/state/hey-agent-app/chats.json`; Pi remains the transcript owner. On restart, the app restores its open tabs immediately and hydrates the active Pi transcript in the background without blocking the initial shell; other transcripts resume when their tab is activated. Multiple tabs may keep working concurrently. Contextual prompts include every explicitly attached HEY thread within an untrusted-data boundary. Extension input requests are rendered in-app and answered through their exact RPC request IDs.

The UI calls these records “Sessions.” A session can be renamed or removed from HEY Agent; removal deliberately leaves the underlying Pi transcript on disk. Missing transcripts render as a recoverable in-app state instead of rejecting Electron IPC. The tab strip holds a compact session menu for the model, workspace, terminal handoff, rename, and delete actions, leaving the transcript and composer free of diagnostic chrome.

HEY list summaries and the thread bodies supplied to agent context are normalized into readable plain text. Escaped anchor markup, HTML tags, and common/numeric entities are removed or decoded while preserving visible URLs and line breaks. The visual mail reader separately requests HEY's original HTML and never includes that larger representation in Pi context.

Live verification on 2026-08-28 proved:

- Pi selected the user's configured `GPT-5.6 Sol` model without an app override.
- A real streamed request completed through Electron with the exact response `HEY_AGENT_RPC_OK`.
- The same session ID and both messages were restored after a full Electron restart.
- Reopening that exact Pi transcript through the terminal command returned the same session ID and both messages.
- The active Omarchy theme loaded in the production renderer, and a watcher test proved theme-change propagation without touching the user's live desktop state.
- The production build, eight tests, and visual inspection passed.

## Completed milestone: mail core and live sync

The primary mail experience now uses one typed contract across the sandboxed renderer, preload, Electron main process, and the installed HEY CLI. Posting IDs remain reserved for organization actions, topic IDs remain reserved for thread actions, and Screener clearance IDs are a separate type and command path.

The app reads the primary HEY boxes and automatically refreshes an affected open box from normalized `hey watch` events. The watcher follows HEY's websocket change feed, survives reconnects and process exits, and never forwards raw posting bodies to the renderer. A real local watch reached its `ready` state on 2026-08-28.

Mail creation and triage now include compose, reply, forward, file attachments, HEY-owned drafts, mark read/unread, moves among HEY boxes, Trash, Spam, Ignore, and safe inverse actions where HEY exposes a reliable reversal. Destructive or filter-training actions require explicit confirmation and are not presented as reversible. Contact bundles can be ungrouped without substituting their posting ID for a missing topic ID.

Global HEY search, The Screener, and the contacts/labels/collections library use their dedicated CLI contracts. The shared shortcut registry supplies `C`, `/`, `J`/`K`, `Enter`, `Esc`, `R`, `F`, `E`, `H`, `U`, `#`, and `Ctrl+K`; the command palette is generated from the same definitions rather than maintaining a second list.

The Imbox search and triage controls now share the title bar, with container-aware compression when the message detail panel narrows the mailbox. Shortcut-bearing controls expose their bindings through a delayed, app-owned tooltip layer. Compose, Cc, and Bcc use a keyboard-first contact picker backed by every page returned from `hey contact list --all`; it ranks name matches, supports arbitrary addresses, and keeps the final send contract as a plain recipient list.

Verification on 2026-08-28 proved the real HEY watch feed, live production Electron preload and mail reads, global commands, compose layout, search, Screener, and Library surfaces. Typecheck, the production build, and 17 tests passed. No test sent, moved, screened, or deleted user mail.

## Completed milestone: mail interaction hardening

Mailbox reads now request every page from HEY rather than exposing only the CLI's first page. Seen, unseen, move, Bubble Up, Trash, and Spam actions update mailbox state, cursor position, reader visibility, and bulk selection optimistically before the HEY CLI round-trip, then reconcile with a fresh authoritative read after either success or failure. Older in-flight mailbox reads cannot repaint stale state over the local result. A subsequent HEY semantics review superseded the earlier archive behavior: Paper Trail is a destination, not an archive, and `E` is reserved for marking Imbox mail seen.

The command palette owns keyboard focus while open, ranks label and word-prefix matches ahead of incidental substrings, visibly tracks the active result, wraps with arrows or Tab, supports page and boundary navigation, and scrolls its result viewport with the active command. Contact rows now open a full HEY contact inspector with compose and HEY Agent handoffs. Contact-started compose is pre-addressed, while the agent handoff creates an editable contact-history prompt rather than sending it automatically. Escape follows layer order: recipient suggestions first, then the composer.

Live production verification on 2026-08-28 proved prefix-ranked command search, keyboard scrolling to the last command, full contact detail loading, pre-addressed compose, and two-step Escape behavior. The HEY CLI independently reported that The Feed currently contains two total items, so the remaining two-row view is account state rather than an app pagination limit. Typecheck, the production build, and 27 tests passed. Verification did not move, trash, archive, or send user mail.

## Completed milestone: HEY-native navigation and Imbox structure

- Persisted shortcut packages for HEY-like, Superhuman, and Custom bindings, including custom editing and discoverable tooltips.
- Numeric HEY navigation plus Sessions and Screener extensions, with session creation, closing, and traversal in the same registry.
- Imbox regions for Screener, New For You, Previously Seen, and one centered Reply Later stack within the Harness-derived visual system.
- No Archive language or behavior. Reply Later, Set Aside, Bubble Up, explicit one-thread moves, and mark seen/unseen remain distinct HEY operations.
- Screener approval explicitly chooses Imbox, The Feed, or Paper Trail and uses HEY's persistent sender designation operation.
- Sender approval state and future-routing controls appear in contact detail when the CLI returns a clearance ID, with an honest note that the CLI cannot read back the active destination.
- Safe “Open in HEY” handoffs for topics, contacts, and CLI-provided HEY application URLs.
- Runtime status, workspace paths, theme diagnostics, and shortcut configuration live in Settings.

The visual treatment deliberately stays quieter than the structural model: Imbox uses a compact paired-thumbs Screener pill, typographic New For You and Previously Seen separators, and one centered Reply Later stack. The Screener uses HEY's Yes/No language and progressively reveals “Screen in and deliver to…” destinations only after Yes; Settings remains a flat document rather than a dashboard.

A follow-up layout refinement removed Imbox's table headings and sender column. Imbox rows are subject-first with the sender folded into the preview line, separated by spacing rather than borders, with a restrained New For You rule and a quieter Previously Seen field. The sidebar owns an explicit stacking layer above mailbox content so every visible destination remains a reliable click target.

Verification on 2026-08-28 proved HEY numeric navigation, Superhuman `G` chords, persisted custom bindings, the Imbox/Screener/Reply Later layout, and the production build. Ten test files and 31 tests passed. The layout detector returned no deterministic issues, and live Electron development produced no application errors. No user mail or sender rule was mutated during verification.

## Completed milestone: rich email bodies

The graphical mail reader now requests both structured Markdown metadata and HEY's original `thread read --html` document. The main process extracts each complete entry, expands HEY's HTML and image `data-trix-attachment` figures, normalizes the CLI's escaped attributes and line breaks, sanitizes active content, and returns bounded rich bodies only to visual mail surfaces. Agent attachments continue using the smaller normalized text representation.

Structurally rich bodies render inside scriptless, style-isolated documents so email CSS cannot alter the application shell. Full marketing layouts use a document presentation; rich notifications use a compact high-contrast card with their formatted text, links, expandable sections, captions, and inline screenshots; ordinary conversation remains in the app-native Markdown renderer. The selection is structural rather than sender-specific, using imagery, stylesheet use, table layout, attachment metadata, and bounded complexity. Links in every path remain keyboard-accessible and pass through a protocol-limited Electron boundary. HEY's `gopher.hey.com` image proxy loads by default. When an expired HEY URL wraps `camo.githubusercontent.com`, the renderer safely falls back to GitHub's privacy proxy so inline notification images still load; arbitrary third-party images and CSS resources remain blocked until explicitly shown. Tiny tracking pixels, scripts, forms, frames, embedded objects, and unsafe URL schemes are removed.

Live Electron verification on 2026-08-28 exercised two real marketing messages. One complex thread crossed the production preload boundary with a 77 KB sanitized document entry containing 57 tables, 40 links, and 19 HEY-proxied images. Another rendered its full responsive marketing layout automatically; DOM inspection confirmed 29 safe external links, 15 proxied images, no scripts or forms, no literal transport escapes, and no horizontal overflow. A five-entry service-notification regression thread now keeps two ordinary entries native and renders three compact rich cards. Its newest card recovers six inline images and five captions from HEY attachment metadata; browser inspection proved one 20-pixel proxied avatar plus five 1600-by-1200 screenshots loaded at their natural dimensions. Eleven test files and 38 tests, typecheck, the production build, and a zero-vulnerability production dependency audit passed. No mail or sender rule was mutated.

## Completed milestone: primary reader and persistent agent rail

Opening mail now replaces the list inside the primary workspace, matching the reading model used by HEY and keyboard-first mail clients. The mailbox list remains mounted but hidden, so Back returns to the same query, selection, and scroll position. Previous and next conversation controls live in the reader header. HEY Agent sessions occupy a separate right rail that stays available across mailbox navigation, can be hidden or reopened independently, and supports explicitly adding or removing the open email from the active session.

Mailbox results are cached per HEY box instead of sharing one route-sensitive value. The app prefetches secondary boxes after the initial Imbox load, applies `hey watch` invalidation to the affected cache, and never paints one box's conversations beneath another box's title during navigation. The left navigation's compact state now changes the actual sidebar, inner rail, button, and toggle geometry; delayed shortcut tooltips consequently anchor beside the visible icon rail.

Mail identity is now derived from the external posting contact and the original HTML entry header rather than the account owner or the lossy JSON thread creator. Service notifications recover their named actor from HEY's summary when possible. Timezone-less HEY CLI timestamps are treated as UTC before local formatting. Live verification against a service-notification thread showed the named automation senders at the expected localized times instead of the account owner's contact. The same live pass proved a full marketing document in the primary reader, immediate Imbox/Feed cache switching, the independent hide/reopen agent rail, and the collapsed navigation geometry. Eleven test files and 42 tests, typecheck, the production build, diff validation, and the final layout detector passed.

## Completed milestone: keyboard selection and full reply addressing

Mailbox `J`/`K` movement now advances a visible cursor without opening or marking a conversation seen; `Enter` is the explicit open action. Once a conversation is open, `J`/`K` continue to mean previous and next conversation. Reader triage stays continuous: Seen, Unseen, Later, Set Aside, Bubble Up, Trash, and Spam immediately open the following conversation in mailbox order while their HEY mutations reconcile in the background; the end of the sequence returns to the list. This preserves fast list scanning while keeping reader traversal fluent.

The reply surface is collapsed by default and opens from either the Reply action or `R`. Escape collapses it without discarding its current body, attachments, To, Cc, or Bcc values, and reopening restores the in-memory edit. New-message compose retains its own full modal and layered Escape behavior.

Reply addressing matches the capability exposed by HEY's TUI. The app reads HEY's computed reply recipients from the read-only bulk-reply preview, presents editable To plus progressively disclosed Cc/Bcc fields, and uses the complete contacts library for keyboard typeahead. Unchanged recipients use the direct reply path. Edited recipients use only public HEY CLI contracts: create a HEY-owned reply draft, edit its To/Cc/Bcc fields, then either leave it saved or send that draft. If the multi-step path fails, the app directs the user to HEY Drafts and does not retry a possibly completed mutation.

HEY Markdown hard breaks are preserved in thread bodies, so a two-space line break before a signature renders on its own line rather than being collapsed into the link above it.

Live Electron verification on 2026-08-28 proved cursor-only `J`/`K` movement followed by explicit `Enter`, a collapsed-by-default reply, a live multi-recipient To line, progressive Cc/Bcc entry, and Escape/reopen preservation of an unsaved body and added Cc address. DOM inspection confirmed the source Markdown hard break became a rendered `<br>`. Twelve test files and 48 tests, typecheck, the production build, diff validation, and the final layout detector passed. Verification did not save or send mail.

## Completed follow-up: email fidelity and thread read latency

Sender-authored HTML now renders on a neutral email canvas rather than inheriting the active Omarchy foreground and accent colors. The app supplies only conservative browser fallbacks, while preserving the sender's typography, color, table layout, and declared image dimensions. In particular, height-only image metadata is no longer canceled by a global `height: auto` rule, and HEY Trix image figures retain bounded width and height metadata when it is present. Omarchy theming remains limited to the surrounding application chrome.

Conversation bodies now use a bounded least-recently-used cache with in-flight request deduplication. Opening a thread loads it once, then prefetches its immediate previous and next neighbors. `hey watch` changes invalidate the affected topic, and replies force a fresh read, so the cache improves keyboard traversal without hiding live updates. The remaining first-read state uses a contained loading ring that cannot overlap its label.

Live Electron verification on 2026-08-29 exercised a real table-based invitation message and a full marketing document. The invitation retained its small declared header assets, neutral text, and standard link colors; the marketing message kept its sender-authored layout. A prefetched previous-thread navigation was fully rendered in an 80 ms capture with no loading state. Fifteen test files and 55 tests, typecheck, and the production build passed. No mail or sender rule was mutated.

## Completed follow-up: immediate sent-reply visibility

Successful replies now appear in the open conversation immediately as a clearly marked local sent item while HEY's authoritative thread catches up. The app keeps the existing thread visible and retries only read operations on a bounded schedule until HEY returns a new entry; it never retries the send mutation. `hey watch` events for that topic defer to the active reconciliation instead of replacing it with another stale snapshot. Compose and forward completion no longer invalidate an unrelated open thread.

Synthetic reconciliation coverage proves immediate, delayed, and bounded-stale read paths without using mailbox-derived identities or sending test mail. A browser preview also proved that send completion collapses the composer, shows the success notice, scrolls the local sent reply into view, and keeps it visible while the mock thread remains stale. Sixteen test files and 60 tests, typecheck, the production build, and diff validation pass. A real send was deliberately not performed as automated verification.

## Completed follow-up: thread disclosure and keyboard action continuity

Long conversations now open as one reader surface with the newest message expanded and older messages collapsed into quiet, overlapping sender/time/preview cards. Each older card is a real disclosure control that works with Enter or Space, and the conversation menu can expand everything or collapse the older history at once. The reader takes focus when a conversation opens, positions the newest message as the initial reading target, and handles arrows, Page Up, Page Down, Space, Shift+Space, Home, and End even when rich email HTML owns an iframe.

Conversation commands now target either the open thread or the highlighted mailbox row. Forward, Reply, Seen, Reply Later, Set Aside, Bubble Up, Unseen, and Trash appear in Ctrl+K before the reader opens; `F` forwards the highlighted row without opening or marking it seen. Removing a highlighted row preserves a nearby cursor target.

Sidebar sessions now expose one compact Archive control on hover and keyboard focus without shifting the title. Archive is reversible, archived sessions have a separate disclosure section, and running work requires confirmation before archive stops it. Permanent deletion remains in the deeper session menu, where it has explicit confirmation and more context. Browser verification proved highlighted-row forwarding and command discovery, reader keyboard scrolling, individual message disclosure, and session archive/restore. Eighteen test files and 64 tests, typecheck, the production build, diff validation, the React quality review, and the final layout detector pass.

## Completed follow-up: safe bulk reply

- Add HEY-style mailbox selection in Imbox, The Feed, Paper Trail, Set Aside, Reply Later, and Bubble Up. Clicking a row avatar or pressing `X` toggles the highlighted conversation without opening or marking it seen; `J`/`K` continue moving the cursor while selection is active.
- Show one contextual selection bar only while one or more conversations are selected. Keep Reply Together as the primary action for this slice and make clearing the selection explicit.
- Treat HEY's human-facing “Reply to Everyone” as write-once/send-individually: every selected conversation receives its own copy inside its existing thread, and recipients are never exposed to one another through a combined To/Cc/Bcc list.
- Require the read-only `hey bulk-reply preview <posting-id>...` boundary before composition or delivery. Review every replyable thread and its exact To/Cc/Bcc recipients; clearly identify any conversation HEY cannot address.
- Re-resolve the selection through `hey bulk-reply send` at delivery time. Never retry this mutation automatically. Surface HEY's delayed-delivery state and returned undo action immediately after success.
- Support the short-lived Undo Send banner and `Q` shortcut through `hey bulk-reply undo <delivery-id>`. Once HEY's undo window closes, report that honestly instead of implying the replies can still be recalled.
- Verification may exercise real previews and independent read-back, but automated tests must not send or undo user mail. Use privacy-safe synthetic identities in fixtures.

Human behavior references: [Reply to Everyone](https://www.hey.com/features/reply-to-everyone/), [bulk keyboard actions](https://help.hey.com/article/758-keyboard-shortcuts), and [Undo Send](https://help.hey.com/article/820-how-do-i-undo-sending-a-message).

The six primary mailboxes now support HEY-style selection from the row avatar or `X`, with `J`/`K` cursor movement and a contextual Reply Together bar. Reply Together requires a fresh CLI recipient preview and presents each thread's exact To/Cc/Bcc independently before composition. Delivery is one non-retried `hey bulk-reply send` mutation, and delayed sends expose HEY's returned undo ID through a persistent Undo banner and `Q` shortcut.

A read-only preview against the authenticated local CLI confirmed the production response shape without exposing mailbox identities or sending mail. Synthetic browser verification proved keyboard selection, separate recipient review, send completion, and `Q` recall. Eighteen test files and 69 tests, typecheck, the production build, diff validation, the React quality review, and the final layout detector pass.

## Completed follow-up: bulk triage and single-scroll rich email reader

Mailbox selection now supports HEY's direct bulk keys for Reply Later (`L`), Set Aside (`A`), Bubble Up (`Z`), seen (`E`), unseen (`U`), Imbox (`I`), The Feed (`D`), Paper Trail (`P`), Ignore (`-`), and Trash (`T`). Each action sends one aggregate mutation containing the selected posting IDs. Destructive actions use one count-aware confirmation, the selection stays intact after cancellation or failure, and successful actions clear it after HEY accepts the request.

At this stage the contextual selection bar exposed Reply Together as its primary action and added a keyboard-accessible More menu. `;` focuses that menu, Enter or Space opens it, arrows move among available actions, and destinations matching the current mailbox are disabled. Ctrl+K puts the available bulk actions first and names the exact selection count, such as “Move 4 conversations to Trash.” This follows HEY's documented [bulk action shortcuts](https://help.hey.com/article/758-keyboard-shortcuts) without inventing unsupported local behavior. Read Together later became the primary action, and direct then bulk labels and Collections shipped in later follow-ups; stickies and merge still require their own honest review surfaces.

A keyboard refinement makes `;` open the bulk menu immediately instead of stopping at focus, while Escape clears the entire mailbox selection from either the list or the open bulk menu. Collapsing HEY Agent no longer leaves a full-height empty rail: the primary mail surface reclaims the width and exposes one compact expand control in the trailing edge of its top bar.

Ctrl+K now owns focus synchronously whenever the command palette opens or is invoked again. Opening it closes the transient bulk menu, its active result stays bounded as filtering changes the result count, and printable input is redirected to the search field if focus briefly lands on palette chrome. This removes the intermittent visible-but-inert palette state after mailbox multi-selection.

Rich HTML email documents no longer own a nested vertical scrollbar. The sandboxed iframe hides vertical overflow and continuously sizes itself as images, fonts, disclosures, or document structure change; wheel and reader keyboard input are handed to the outer conversation scroller. Arrow keys, Page Up/Down, Space, Home, and End therefore work immediately after opening a conversation without changing the selected thread. Exceptionally long messages collapse behind an explicit “Show entire email” control instead of silently introducing a second scroll region.

Synthetic browser verification proved two-item keyboard selection, count-aware Ctrl+K results, `;` menu focus and arrow navigation, one aggregate Trash request, one-scroll rich HTML, iframe wheel forwarding, and Arrow/Page Down movement without conversation changes. Nineteen test files and 73 tests, typecheck, the production build, the React quality review, visual inspection, and the final layout detector pass. No user mail was moved, ignored, trashed, replied to, or otherwise mutated during verification.

## Completed follow-up: one primary reader across HEY

The Screener and global search no longer maintain their own narrow email-detail panes. Selecting an unscreened sender or a search result hands the conversation to the same full center reader used by the six mailbox lists, while the independent HEY Agent rail keeps its width and context. Back returns to the mounted Screener queue or the still-populated search results instead of discarding the user's place.

Screener clearance IDs remain isolated from posting mutation IDs. Before a sender is approved, the full reader exposes only the honest Screener actions—Open in HEY and spam—while Yes stays in the queue as the Imbox, Feed, or Paper Trail routing choice. Search results are likewise read-only until the app has an authoritative source-mailbox contract for move operations. This removes the split-pane presentation without inventing mutation authority.

Synthetic browser verification proved full-center Screener and search readers, preserved search query/results on Back, and the unchanged independent agent rail. Twenty test files and 74 tests, typecheck, the production build, and diff validation pass. No user mail or sender rule was mutated.

## Completed follow-up: independent sidebar shortcuts and legacy email layout fidelity

The two workspace rails now have distinct global toggles: `Ctrl+B` collapses or restores the navigation sidebar, and `Ctrl+Shift+B` collapses or restores HEY Agent. Both commands appear in Ctrl+K, use the configured shortcut display in their tooltips, and continue to work while the agent composer has focus. Each collapsed rail returns its width to the primary mail surface rather than leaving an empty structural column.

Rich email sanitization now preserves the inert legacy alignment attributes that real email templates still use, along with scrubbed image classes, inline styles, and spacing hooks when HEY's Action Text attachment is converted to a normal image. This fixes sender-authored centering and asset layout without introducing sender-specific exceptions. The isolated document no longer imposes a universal `border-box` reset over the sender's layout. Executable elements, event handlers, forms, unsafe URLs, and unapproved remote content remain blocked.

Read-only verification against a real service message confirmed that three centered containers survive sanitization and its 74-by-24 logo remains inside a centered immediate parent. Synthetic browser verification proved both sidebar shortcuts from the mailbox and from a focused agent textarea, plus discovery in Ctrl+K. Twenty test files and 76 tests, typecheck, the production build, and diff validation pass. No user mail or sender rule was mutated.

## Completed follow-up: semantic sound effects

HEY Agent now has one typed UI SFX player shared across the renderer. It unlocks only after a trusted pointer or keyboard interaction, uses Zen at 30% by default, and maps semantic product outcomes rather than button labels. Mail selection, open/close, compose, send, draft, mutation, error, and undo paths use distinct cues. Quiet, rate-limited `hover` cues follow pointer and `J`/`K` mailbox highlighting, sidebar hover, and previous/next reader traversal; `press` confirms navigation to a sidebar destination; `drop` confirms file attachments and closing either sidebar; `snap` confirms opening a sidebar; `streak` confirms a completed Screener decision; and `expand`/`collapse` remain reserved for message disclosures. User typing, routine refreshes, agent text chunks, and hidden status updates remain silent.

Settings persist a master switch, all twelve sound styles, volume, interface/mail/agent categories, agent activity loops, and background notifications. Agent activity is enabled by default because it is an intentional part of this product's local-agent experience; background notifications stay off until OS-notification overlap is designed. Continuous handles are retained and stopped on success, failure, cancellation, settings changes, session changes, and unmount.

Agent sends, completed responses, failures, and connection states use their matching cues. A run starts with `processing`, switches the same retained loop to `streaming` once visible assistant output begins, and stops on completion, failure, cancellation, settings changes, session changes, or unmount. Text chunks do not add one-shot sounds over that bed. The loop controller stops the previous cue before starting its replacement, so transitions never leave two continuous sounds active.

Editable controls now short-circuit pending shortcut chords before any completion is evaluated, so moving focus into a text field cannot turn its next character into navigation. The first editable keystroke also clears the stale chord and hint. Hidden dialog scrims explicitly disable layout and pointer interception as a second guard against invisible overlays blocking inputs.

Implementation follows UI SFX's current agent integration guidance: one player, no autoplay or queued pre-unlock sounds, async outcome cues only after accepted actions, and audio that reinforces visible state rather than replacing it. Twenty-one test files and 82 tests, typecheck, the production build, live mailbox and sidebar cue inspection, reader traversal, message disclosure, sidebar settlement, settings interaction, mute/pack/category changes, thinking preview, pending-chord input recovery, agent-composer focus, and a no-page-error browser pass all succeed.

## Completed follow-up: HEY-native search and conversation organization

Global mail search now exposes every refinement supported by the installed HEY CLI: all words, any words, excluded words, an exact phrase, sender, recipient, subject, date, mailbox, label, and attachment type. The ordinary query remains primary, while a progressively disclosed Filters area keeps the full search grammar available without turning the initial surface into a form. Filter options come from `hey search filters` instead of being duplicated in the renderer. Filter-only searches are valid.

Search follows HEY's numbered, ten-result pages. “Load more” requests the next page, deduplicates by authoritative HEY IDs, and preserves the query, refinements, result list, and scroll context when a result opens in the shared full-center reader and the user returns.

The conversation More menu now opens one Labels and Collections organizer. Existing memberships are shown as toggles, and an empty account can create and immediately apply either kind. The implementation preserves HEY's two separate identity boundaries: label membership uses a posting ID, while Collection membership uses the thread's topic ID. Membership reads use the CLI's dedicated label and Collection view operations with bounded concurrency; mutations are issued once and are never automatically retried. If a search result does not contain the ID required for one side, that section explains why it is unavailable rather than guessing.

Read-only checks against the authenticated HEY CLI confirmed version 1.2.1's search grammar, filter response shape, pagination, and label/Collection command contracts. Synthetic browser verification proved refinement-only search, load-more behavior, preserved search state, full-center result reading, organizer focus and layered Escape handling, empty-account create-and-add states, and no page errors. Twenty-one test files and 85 tests, typecheck, the production build, and diff validation pass. Verification did not send or move mail and did not create, edit, or remove any real label or Collection.

## Completed follow-up: authoritative actors and modal keyboard ownership

Sender attribution now has one main-process owner shared by every production mail surface: all six mailboxes, global search, thread entries, The Screener, rich-HTML entry metadata, composer/reply context, and agent attachments. HEY's authoritative `alternative_sender_name` wins over relay/contact names; narrow notification grammar is only a fallback when HEY omits an explicit actor. Every normalized posting carries a required sender before it reaches React, and renderers no longer reinterpret `contacts[0]` independently. This keeps list rows, opened messages, search results, Screener detail, and agent context aligned without sender- or domain-specific UI exceptions.

Global Search owns Escape at the topmost visible dialog layer, while the command palette owns keyboard focus for its entire lifetime. If focus is displaced to mailbox chrome behind Ctrl+K, a modal focus guard immediately returns it to the command input; printable keys, navigation, Enter, and Escape are captured by the palette instead of leaking to the underlying mailbox. Nested organizers use the same topmost-dialog rule so Escape closes one layer at a time.

Mailbox title bars retain the working local search and refresh controls. The inert Filter, Sort, and mailbox-options buttons were removed: HEY's box result order remains authoritative, and the app no longer advertises controls that have no behavior.

Live production Electron verification against the authenticated HEY account proved the reported Paper Trail invitation row and opened thread resolve to the same actor and subject, Search closes with Escape, a deliberately displaced Ctrl+K focus returns before typing and filters to “Move to Trash,” and no inert header controls remain. A read-only parity audit also compares every currently visible posting across all six boxes and every pending Screener entry with its opened thread identity. Twenty-two test files and 92 tests, typecheck, the production build, diff validation, and a no-page-error browser pass succeed. No mail or sender rule was mutated.

## Completed follow-up: communicative state icon morphs

[Morphicons](https://www.morphicons.com/) 1.7.1 now provides a narrow state-transition layer alongside the existing static Lucide React vocabulary. The matching Lucide 1.35 data package supplies morph geometry, while one local `MorphingIcon` component owns a fast, critically damped spring and explicitly honors the user's reduced-motion preference. Buttons retain their existing focus, labels, shortcuts, handlers, and layout; only the SVG geometry changes.

State morphs cover the navigation and agent rail toggles, active and archived session disclosures, global-search filters, older thread entries, agent run/tool disclosures, the Sound heading, and the agent send/stop control. Both rail toggles now use a neutral panel glyph at rest and preview their open/close destination on hover or keyboard focus, so the motion is visible before the rail changes layout even when the controls occupy different anchors.

Every primary navigation item now has a restrained semantic pair. Hover or keyboard focus previews the destination-specific icon, while the selected route keeps that endpoint visible: Compose, Drafts, Imbox, The Feed, Paper Trail, Reply Later, Set Aside, Bubble Up, The Screener, Calendar, Library, and Settings all share this behavior without changing their labels, shortcuts, click targets, or sound cues.

Synthetic browser verification proved visible in-flight interpolation, stable icon bounds, rapid-toggle interruption, persistent selected-route endpoints, hover/focus rail previews, clean agent-rail remounts, thread and search disclosure states, sound on/off, the collapsed navigation rail, and an instant endpoint swap under `prefers-reduced-motion`. Twenty-four test files and 97 tests, typecheck, the production build, dependency audit, the React quality review, the Impeccable detector, screenshot inspection, diff validation, and a no-page-error browser pass succeed.

## Completed follow-up: authoritative HEY contact avatars

Mail identity normalization now preserves HEY's `avatar_url`, `avatar_background_color`, and `initials` alongside the canonical sender. One reusable fallback-safe avatar renders that identity across all six mailbox lists, search, Reply Later, The Screener when metadata is available, conversation participants and message cards, and Library contact list/detail views. Threads reuse the posting's already-loaded contacts by stable contact ID or normalized email because HEY's thread-entry response omits avatar fields; names alone are never treated as identity.

Remote avatar loading is restricted at the main-process normalization boundary to HTTPS resources served by HEY domains. A failed or absent image falls back to HEY's own initials and background color, then to locally derived initials. The app does not query Gravatar, infer company logos, or make per-message contact requests.

Read-only CLI inspection confirmed current mailbox and contact payloads carry HEY avatar metadata while thread entries do not. Synthetic browser verification proved a real image in the mailbox survives into the opened thread and participant stack, while neighboring rows retain correctly sized fallbacks. Twenty-five test files and 101 tests, typecheck, the production build, visual inspection, and a no-error browser pass succeed. No user mail or contact was mutated.

## Completed milestone: contextual agent starts and transcript hardening

An unused general session is intentionally blank apart from its composer. A session with one attached HEY conversation instead shows that conversation's real subject and sender plus three deterministic starters selected from the attachment's persisted source mailbox. Multiple attachments switch to cross-conversation actions. These starters are ordinary templates rather than generated claims: they read no email body, contact no model, and perform no background inference. Choosing one only places the complete prompt in the focused composer; the existing explicit Send action remains the point where HEY resolves bounded thread context and Pi begins work.

Assistant Markdown now has one dedicated rendering boundary. It retains the existing `react-markdown` and GFM foundation because focused incomplete-token fixtures remained visible without adding another dependency. Raw HTML and remote Markdown images are suppressed, tables stay inside a horizontal overflow boundary, and links leave the sandbox only through the app's validated external-URL IPC. The renderer therefore treats formatting, streaming state, and link/image policy consistently in both the full session workspace and the narrow agent rail.

Synthetic browser verification proved the blank general state, the contextual attached-email state, and a starter click that focused and populated the composer without creating a transcript message or contacting the agent. Twenty-nine test files and 122 tests, typecheck, the production build, visual inspection, and diff validation succeed.

## Completed follow-up: crisp interface typography

HEY Agent bundles Instrument Sans Variable as its dependable interface face instead of naming an unavailable local font and silently falling back. Settings offers an immediate, persisted choice of Instrument Sans, the desktop system UI stack, or System mono. System mono follows Omarchy's selected monospace family through the existing live theme feed; technical chrome continues to use that family regardless of the interface choice.

The Omarchy palette still owns the canvas, surfaces, selections, and accents, while primary, secondary, and tertiary content text is derived through a low-chroma neutral ladder with stronger contrast. Small interface copy no longer inherits negative tracking or forced grayscale font smoothing, and the principal mailbox roles use a compact semantic type scale with weights the bundled variable font actually provides.

## Completed follow-up: HEY-native Read Together

Read Together now follows HEY's documented bulk-reading model across the six primary mailboxes: select conversations from their avatars, choose Read Together from the contextual action bar, or press `O`, then scroll through those independent threads as one continuous page. The action is read-only and composes normal authoritative `hey thread read` results; it does not invent a new HEY mutation or join the selected threads.

The reader preserves mailbox order rather than avatar-click order and keeps one outer vertical scroll owner. It reuses the same thread cards, long-thread disclosures, authoritative sender/avatar enrichment, Markdown fallback, and isolated rich-HTML email renderer as the ordinary conversation reader. Loads are bounded to three concurrent HEY reads, completed threads remain retained for the lifetime of the combined reader even beyond the normal LRU capacity, and `hey watch` changes refresh any visible selected thread. Contact bundles without a `topic_id` are explicitly left out instead of substituting their posting ID.

The existing keyboard model remains intact. `J`/`K` jump between selected conversations; arrows, Page Up/Down, Space, Home, and End scroll the combined page; Escape closes the topmost command palette first and then returns to the still-selected mailbox rows; and Ctrl+K puts count-aware Read Together and Reply Together commands ahead of the applicable bulk mutations. Entering Read Together from unseen Imbox rows marks only the readable selected threads seen in one aggregate HEY operation, matching the ordinary Imbox reader without changing other mailbox semantics.

Human behavior references: [Read Together](https://help.hey.com/article/786-read-together), [Read Together feature overview](https://www.hey.com/features/read-together/), and [bulk keyboard actions](https://help.hey.com/article/758-keyboard-shortcuts).

Synthetic browser verification proved avatar selection, the visible action-bar control, direct `O`, a two-thread continuous reader, one vertical scroll owner, J/K section jumps, Page Down scrolling, count-aware Ctrl+K search, layered Escape behavior, preserved selection on return, compact-width containment, and a no-page-error pass. Thirty test files and 125 tests, typecheck, the production build, React quality review, visual inspection, and diff validation succeed. No user mail was sent, moved, trashed, or otherwise organized during verification; only the preview harness was mutated.

## Completed follow-up: bulk labels and Collections

Mailbox selection now exposes HEY's native `B` Label and `N` Collection shortcuts alongside count-aware Ctrl+K commands and the contextual More menu. One organizer covers both concepts without conflating them: labels apply to selected posting IDs, while Collections apply to the selected threads' topic IDs. A selected bundle that lacks a topic ID remains eligible for labels and is explicitly counted as unavailable for Collections instead of substituting the wrong identifier.

Existing membership is summarized across the entire selection. An empty checkbox means none of the selected conversations belong, a mixed state shows the exact partial count, and a checked state means all belong. Activating none or mixed adds every eligible conversation; activating all removes every eligible conversation. Label and Collection names can be filtered independently, and a new item can be created and applied to the whole eligible selection. The main process validates and deduplicates at most 100 numeric targets, then uses the HEY CLI's variadic bulk contracts. Collection creation remains an honest two-step boundary because the CLI creates first and adds threads second; if the second step fails, the app reports the partial result and never retries the mutation automatically.

Human behavior references: [bulk keyboard actions](https://help.hey.com/article/758-keyboard-shortcuts), [Labels](https://help.hey.com/article/884-labels), and [Collections](https://help.hey.com/article/762-collections).

Read-only checks against the authenticated HEY CLI confirmed version 1.2.1's variadic label and Collection contracts. Synthetic browser verification proved two-item keyboard selection, mixed-to-all membership, `B`/`N` section focus, count-aware searchable Ctrl+K commands, More-menu discovery, layered Escape behavior, and a 700-pixel layout with no horizontal overflow. Thirty-one test files and 129 tests, typecheck, the production build, diff validation, and the final Impeccable detector pass. Verification did not create, edit, or remove any real label or Collection and did not mutate user mail.

## Completed follow-up: HEY-native Calendar reading and event creation

Calendar is a first-class primary workspace rather than a placeholder. Its model follows HEY's day-and-week orientation instead of introducing a conventional month grid: Week is a seven-day board when space permits and a compact continuous agenda when the real pane narrows; Day focuses one date; and the active view/date are remembered when switching back to mail. One scroll owner, container-aware layout, stable skeleton loading, a non-shifting reload indicator, and a single actionable empty-range state replace the original repeated oversized rows.

The read boundary preserves calendar ownership and writability, all-day/timed and multi-day ranges, recurrence, reminders with real durations, time zones, organizers, attendance, meeting/reference links, notes, and safe edit handoffs. Events occupy every visible day they span. Recurring series returned without a usable occurrence date remain explicitly visible in a separate series region rather than disappearing. Reference links are labeled as links; the UI says “Edit in HEY” only when HEY supplies a distinct edit URL.

Event creation uses a narrow typed IPC boundary backed by `hey event add` argv, never renderer shell access. The visible New event action, `N`, individual empty-day actions, and double-clicking open a date-prefilled composer. It supports writable-calendar selection, all-day or timed ranges, timezone, location, link, notes, invitees, reminders, repeat rules, and HEY's circled-day treatment. Guest entry reuses the mail composer's complete HEY contact picker: partial names or addresses produce keyboard-selectable suggestions, selected people become removable chips, large guest lists collapse, and arbitrary email addresses remain available if contact loading fails. Calendars marked personal-service or external are never offered as writable. Invited events require a second immutable review of the calendar, schedule, timezone, recipients, reminders, and recurrence because creation sends invitations; ambiguous mutations are never retried.

The keyboard model preserves HEY expectations while matching the rest of this app: `N` creates, `T` returns to today, `D` selects Day, `W` or `U` selects Week, left/right or `H`/`L` move the active day or week, up/down or `J`/`K` move and focus visible events, Enter opens detail, Escape returns or clears the local filter, `Ctrl/Cmd+F` focuses the explicitly local “Filter this day/week” field, and `0` returns to mail. Calendar shortcuts are scoped to Calendar and do not swallow keystrokes in the editor or the adjacent agent rail.

Native editing and deletion now use narrow typed IPC boundaries backed by HEY CLI 1.4.0. The shared create/edit composer preloads HEY's visible fields, sends only changed values, and saves edits directly without an extra review step. It keeps the calendar fixed, preserves an existing recurrence unless the user deliberately replaces it, and isolates its keyboard boundary so typing cannot trigger application shortcuts. HEY's replacement-style write cannot return an existing countdown, so the editor offers an optional field to restate one. The CLI cannot safely remove every reminder yet, so that one ambiguous edit remains blocked with an honest handoff to HEY. Creating an event with invitees still requires an exact invitation review because that action notifies other people.

Deletion is available only on writable calendars and always requires an inline named confirmation. The confirmation identifies the calendar, attendee impact, irreversible scope, and whether HEY will remove the entire recurring series; the app never presents occurrence-only deletion that the CLI cannot perform. `E` opens the editor from event detail, Delete or Backspace opens confirmation, and Escape unwinds one layer at a time. Read-only and external calendars retain their source-calendar handoff. The local filter does not pretend to be HEY's broader Calendar search, which also covers todos, Journal, and Time Tracking.

Human behavior references: [Calendar overview](https://help.hey.com/article/800-calendar-overview), [Calendar keyboard shortcuts](https://help.hey.com/article/758-keyboard-shortcuts), [Events](https://help.hey.com/article/844-events), and [HEY Calendar](https://www.hey.com/calendar/).

Read-only production Electron verification crosses the real preload/IPC boundary without mutating Calendar data. Synthetic browser verification proves wide week and compact agenda layouts, event creation and immediate reconciliation, invitation review, `N`/Escape behavior, event filtering, calendar selection, focused keyboard traversal, full event detail, one calendar scroll owner, and no page-level horizontal overflow. Thirty-three test files and 138 tests, typecheck, the production build, visual inspection, and the Impeccable design hook pass.

## Completed follow-up: Calendar event density and collisions

Calendar now distinguishes schedule geometry instead of rendering every result as an interchangeable row. Timed events are ordered chronologically and collected into transitive collision groups; simultaneous events share the available horizontal space, and hover or keyboard focus gives the active event more room without moving it out of its time group. Exact adjacency does not count as a collision, invalid zero-length events receive a safe visible duration, and each card shows its full time range.

All-day placement follows the active Calendar view. Day and Week both keep the same slim all-day lane inside the event's actual day, before that day's timed schedule; multi-day events continue through every occupied date. Hover or keyboard focus reveals the full range without turning the schedule into a second large event list. At compact widths, busy days grow to fit their content and scroll as whole agenda sections, preventing one day's events from overlapping the next. Keyboard traversal follows the same visible order, deduplicates continued multi-day events, Enter opens detail, and Escape restores focus to the originating card. Motion is restrained and removed when the operating system requests reduced motion.

Synthetic browser verification covers wide and narrow Week layouts, the compact Day all-day lane, per-date all-day continuation, collision expansion, keyboard traversal, detail focus return, native update and delete, read-only calendars, layered Escape behavior, and horizontal containment. Calendar navigation keeps the loaded header, view mode, empty state, and event geometry together until replacement data is ready, then presents the requested window in one render. Editing focuses the title immediately, contains every editor keystroke, and saves directly; creating with invitees retains its explicit review. Thirty-seven test files and 183 tests, typecheck, the production build, diff validation, React quality review, and the Impeccable layout detector pass. No real Calendar event was created, edited, or deleted during verification.

## Near-term roadmap

### Mail polish

- Keyboard safety and discoverability are implemented: composer-local dispatch, nested AI Write isolation, modal focus containment, validated custom bindings with inline errors/conflicts and explicit reset/disable, and configured hover/focus hints. Keep `node scripts/check-keyboard.mjs` in the local verification cycle. See [implementation and original audit](./shortcut-discoverability-audit.md).
- Extend bulk selection with sticky and merge flows only when each has an honest typed contract and review surface.
- Add richer Markdown composition controls while preserving HEY's Markdown-native send boundary.
- Paper Trail's “New since you last visited” divider is tracked locally per linked-account profile on this device, not synced with HEY's own app (the CLI exposes no visit boundary). The first successful visible visit establishes a baseline; subsequent visits compare posting activity timestamps to the previous visit. Refresh, background prefetch, and opening a thread do not advance the current divider. Filtering hides it; no new rows means no divider. Storage failures are non-blocking and surfaced inline. Never infer the boundary from read/unread state or `observed_at`.

### Durable sessions and artifacts

- Stable attachments now cover Calendar events, drafts, mail threads, contacts, labels, Collections, mailboxes, local files, and captured desktop text selections alongside the shipped multi-thread attachment model.
- Native HEY action approvals and result objects are shipped. Rich draft and diff artifacts remain future work.
- Working-directory selection from the session options menu.

## Completed milestone: agentic HEY actions and native object links

The durable product and implementation requirements for this work live in [Agentic HEY requirements](./agentic-hey-requirements.md). That document is authoritative for the Pi-native runtime boundary, broad HEY capability coverage, non-keyword agent behavior, approvals, result artifacts, reconciliation, and in-app object deep links.

The installed local Pi agent can now operate the HEY CLI from ordinary language without a renderer intent router. The installed HEY skill remains the operational guide. One generic `hey` tool accepts structured argv and owns only the host boundary: validation, restricted-command policy, impact classification, reviewed execution, normalized artifacts, cancellation, and refresh hints. It never parses natural-language keywords. A second deliberately tiny `hey_agent_app` tool covers native navigation, rail state, and attaching the selected email, which the HEY CLI cannot perform.

The renderer preserves stable object IDs, keeps attached email explicitly untrusted, renders structured approval fields, reconciles affected mail or Calendar surfaces, and exposes native links for mail threads, mailboxes, drafts, contacts, labels, Collections, Calendar dates, and events. Those result objects can be pinned to the Pi session; later prompts receive their stable kind, ID, title, and native deep link even after context compaction.

Externally visible, broad, destructive, and unknown mutations require review; read-only and bounded reversible organization can proceed directly. Authentication changes, setup, credential, configuration/trust, skill-management, completion, upgrades, long-running watch, and TUI commands are blocked in the embedded boundary. Base-URL overrides are rejected so embedded work cannot redirect authenticated HEY traffic. Commands execute as argv without a shell and are not blindly retried after ambiguous failures.

The structured approval card is the single confirmation surface once material terms are known. Pi is explicitly guided to invoke the tool directly rather than asking for a conversational yes/no and then presenting a second review; it asks a question only when a real ambiguity prevents exact review.

Reviewed reply, forward, compose, and bulk-reply bodies are editable directly in that native approval card. The technical command stays collapsed by default and updates with the edited message. Empty mail bodies cannot be approved, Escape exits inline editing without dismissing the action, and approval executes exactly the visible edited copy.

Settings readiness now verifies the whole local chain rather than only executable presence: Pi, HEY CLI, current HEY authentication/account scope, the installed HEY skill, and the packaged HEY Agent extension.

Live Electron verification proved Pi chose `hey_agent_app` from an ordinary request to open Calendar, the typed tool completed, and the existing Calendar center surface opened without a renderer keyword rule. In a second real Pi turn, Pi read the installed HEY skill, inspected `event add` through the generic tool, and proposed a 30-minute event. The native review showed the exact title, date, time range, timezone, and argv; choosing No completed the tool without executing `hey event add`. Standalone Pi RPC also loaded the packaged extension alongside the user's normal extensions.

A final isolated acceptance run put a temporary deterministic HEY simulator first in the child process PATH, leaving the authenticated user account untouched while still exercising real Electron, Pi RPC, the installed HEY skill, the packaged tool, approval IPC, result parsing, reconciliation, and native Calendar navigation. Pi produced the exact native review without a redundant conversational confirmation, the safe `No` action received initial focus, Tab/Enter approved the reviewed command, the exact event result linked into its native Calendar detail, the event attached to and named the session, and both the attachment and full transcript restored after an app restart. A second isolated mail run proved inline message editing, required-copy validation, Escape focus recovery, synchronized technical-command disclosure, keyboard approval, and exact edited-argv execution. Pi also detected a deliberately inconsistent simulator response, verified it, and requested reviewed cleanup instead of claiming success or blindly retrying. Compact checks at 1280×800 and 1024×700 found no page-level horizontal overflow, and both rail shortcuts remained functional. Thirty-five test files and 158 tests, typecheck, the production build, browser console/error checks, and diff validation pass. Verification did not mutate real user mail or Calendar data; reviewed mail delivery still requires explicit human acceptance during product use.

Pi-facing guidance now states the general operating contract directly: resolve context with authoritative reads, ask only about material ambiguity, compose compound work itself, retain stable IDs, report partial completion honestly, and reconcile ambiguous mutations without blind retries. This remains guidance for the agent rather than a renderer intent catalog.

Focused results from HEY search and event listings now produce bounded native object artifacts, joining the existing single-object links for threads, drafts, contacts, labels, and Collections. Retrieval and recovery can therefore end in useful app links without turning every broad library listing into visual noise or a bespoke workflow. Stale event, draft, thread, contact, label, and Collection links converge on one quiet “Item not found” center surface. It offers a normal route back and an explicit “Find possible matches” action that sends untrusted saved metadata to Pi for a read-only HEY search; the renderer performs no fuzzy matching or fallback identity inference.

Behavioral breadth is maintained as a black-box product suite in [Agentic HEY behavioral evaluations](./agentic-hey-evaluation.md). The cases cover ambiguity, compound work, Collection scope, timezone and recurrence, recipient review, partial completion, ambiguous transport, stale links, and prompt injection. They grade visible effects and safety invariants while allowing Pi to choose its own supported tool sequence. Production code should grow only when an evaluation exposes a missing safe primitive or renderer/reconciliation boundary—not to recognize a scenario or prompt.

## Completed follow-up: HEY CLI 1.4 native surfaces

The app now adopts HEY CLI 1.4 without replacing or narrowing Pi. The generic `hey` extension recognizes the new read contracts for Day/Week Calendar views, bundles, full contact thread history, and Set Aside groups; it classifies Set Aside membership as reversible, group dissolution as destructive, and raw HTML mail bodies as editable exact-review fields. These are command-policy additions, not natural-language rules.

Calendar reads use `hey event day` and `hey event week`, matching HEY's enabled-calendar view and expanding recurring series into dated occurrences. The shared model preserves `occurrence_id`, and Calendar selection, keyboard focus, and result links distinguish two occurrences of the same series without inventing a new event ID.

Bundle rows now open a full center conversation list through `hey bundle view`; they are no longer treated as malformed threads or implicitly unbundled. Library contacts show their complete conversation history through `hey contact threads`. Set Aside uses `hey set-aside view` so the renderer can group rows by HEY's unnamed `box_group_id`, create a group from the current selection, move selected rows into a group, remove them while keeping them Set Aside, or dissolve a group with an explicit warning that its threads return to Previously Seen.

Pi results can now carry native mail-bundle and Set Aside-group links alongside their bounded summaries and refresh hints. The preview harness includes synthetic bundle, group, and recurring-occurrence states so these surfaces can be exercised without touching authenticated mail or Calendar data.

## Completed follow-up: HEY Calendar routines and records

Calendar now includes the other everyday HEY Calendar destinations without forcing them into event cards. Schedule keeps a compact, incomplete-first Sometime This Week list that floats with its week and supports direct add, completion, uncompletion, and confirmed deletion. Habits appear on the days they belong in Day and Week, with optimistic completion controls plus full create, edit, and confirmed delete management. Habit definitions come from HEY's week view while completion history is joined from the personal Calendar's read-only recording stream, so completed days remain authoritative after a restart.

Journal is a private, date-scoped writing surface inside Calendar. Day and Week navigation choose the entry date, writing saves quietly after a short pause or on blur, and removing an entry requires an explicit confirmation because HEY represents removal as an empty write. Time tracking keeps the running timer prominent, supports start and stop with an optional category, and provides editable completed history, confirmed deletion, category management, and export through HEY CLI 1.4.

Schedule, Habits, Journal, and Time tracking share Calendar's date model, live reload behavior, compact layout, and stable deep-link target handling. Mouse paths are visible, `B`, `G`, and `R` open the three added destinations, and the existing `H`/`J`/`K`/`L` Calendar navigation remains intact. The renderer receives only narrow typed IPC; the installed HEY CLI performs every read and mutation. Pi can create and link these objects through the existing generic HEY tool, native artifacts, refresh hints, and in-app deep links rather than through prompt-specific intent code.

These controls also use the existing semantic sound layer rather than a Calendar-specific soundtrack. Section icons preview with the same quiet, rate-limited hover cue as primary navigation; section changes use `press`; disclosures use `expand`/`collapse`; habit and todo completion uses `select`/`deselect`; the timer uses `start`/`stop`; and completed writes, deletions, and failures use their established outcome cues. Background refreshes and Journal autosave success remain silent.

Human behavior references: [Sometime This Week](https://help.hey.com/article/900-sometime-this-week), [Habits](https://help.hey.com/article/822-habits), [Journal](https://help.hey.com/article/907-journal), [Time Tracking](https://help.hey.com/article/843-time-tracking), and [Calendar keyboard shortcuts](https://help.hey.com/article/758-keyboard-shortcuts).

Synthetic browser verification covers weekly and compact layouts, incomplete-first todo behavior, optimistic habit completion, habit management, Journal navigation/autosave/removal confirmation, and the timer, completed-history, category, and export journeys. Production Electron verification crossed the real preload and read-only HEY CLI boundary for Schedule, Journal, and Time tracking; the authenticated account had no habits, while an isolated CLI/MCP integration test proved authoritative habit-completion joining without touching user data. Thirty-eight test files and 189 tests, typecheck, the production build, console/error checks, diff validation, and the final Impeccable detector pass. No real todo, habit, Journal entry, timer, category, event, or mail item was mutated during verification.

## Completed follow-up: Calendar search and Year

Calendar search now has one explicit HEY-wide surface for events, Sometime This Week, Journal, and tracked time. A submitted query fans out through the four authoritative read-only CLI contracts, tolerates an unavailable source without hiding results from the others, and returns a bounded, unified native result list. Opening a result goes to the real event detail, expands and highlights the matching Sometime item, opens the Journal date, or selects the exact tracked-time record. The existing event field remains an honestly local Day/Week filter. `/` opens the broad search, arrow keys or `J`/`K` move through results, Enter opens, and Escape closes.

Year adds a responsive twelve-month overview without introducing a second Calendar store or recurrence engine. It opens around the currently represented month, marks dated HEY entries, preserves circled-day treatment, and moves directly into the authoritative Day view when a date is chosen. `Y` opens Year, `H`/`L` or the arrow keys move one year, and `T` returns to today. HEY's public year-range listing reports repeating events as series rather than expanded occurrences, so Year deliberately does not place speculative repeat dots; those occurrences appear after opening Day or Week through HEY's occurrence-expanding commands.

Synthetic browser verification covers the unified four-kind search, result keyboard navigation and native destinations, twelve-month navigation, month anchoring, date selection, and wide and compact two-column layouts without horizontal overflow. Thirty-nine test files and 192 tests, typecheck, the production build, console/error checks, and diff validation pass. Verification used synthetic preview data and read-only command fixtures; it did not mutate real Calendar or mail data.

## Completed follow-up: compact desktop shell

The desktop shell now protects the primary workspace when HEY Agent is open at constrained widths. At 1120 pixels and below, the expanded navigation automatically reduces to its icon rail without changing the user's current wide-layout choice. Explicitly expanding it in that state opens a temporary left drawer over the workspace instead of squeezing mail or Calendar; the covered workspace becomes inert until selecting a destination, composing, choosing a session, clicking outside, pressing Escape, closing HEY Agent, or restoring desktop width settles the drawer predictably. Escape returns focus to the visible rail toggle. The independent agent rail retains its existing overlay behavior below 980 pixels.

`Ctrl+B` remains the navigation control in both states. Calendar now yields modified global shortcuts to the shell instead of interpreting `Ctrl+B` as its plain `B` Habits shortcut. Automatic layout changes remain silent, while deliberate open and close actions retain the established rail sounds. The compact drawer gives its sessions region an independent vertical scroll so short windows never place a session underneath the fixed account footer.

Synthetic browser verification covers 1300-, 1050-, and 900-pixel widths, automatic collapse, temporary overlay expansion, outside-click and Escape dismissal including from an input, destination and session selection, agent-rail close/reopen, preference restoration, shortcut ownership, and zero horizontal page overflow. Forty test files and 195 tests, typecheck, the production build, browser console/error checks, and diff validation pass.

## Completed follow-up: local session attachments

HEY Agent sessions now accept local files and the desktop's current selected text from one compact attachment menu beside the composer. The native file picker resolves each selection to its canonical absolute path, verifies that it is a file, records bounded size and modification metadata, deduplicates repeated paths, and keeps the reference durable with the rest of the Pi session. Pi receives the exact path and uses its normal local file tools when the user's request requires reading it; the app does not add a second parser or intent-specific workflow.

On Linux, Selected text reads the desktop selection clipboard directly. The copied text receives a stable identity, an 80,000-character storage bound, and the same durable remove/restore behavior as every other session attachment. Empty or oversized selections fail with local guidance. Files, selections, mail threads, and native HEY objects have distinct context chips and contextual starters, while mixed sessions use neutral item language rather than pretending every attachment is an email.

Every local attachment is described to Pi as explicitly user-attached but untrusted application data. Attachment contents cannot authorize actions or override the user's request. File content is not copied into the chat store; captured text is stored only in the existing private session metadata file. The renderer never receives filesystem authority beyond the validated paths returned by the main-process picker.

Focused tests cover canonical file metadata, duplicate selection, invalid or oversized attachments, private session restoration, prompt boundaries, and context-specific starters. Synthetic browser verification covers file and selected-text addition, distinct removable chips, compact popover containment, Escape focus recovery, and zero page overflow at 1280 and 900 pixels. Forty-one test files and 201 tests, typecheck, the production build, React quality review, and the Impeccable detector pass.

## Completed follow-up: reliable Calendar Year and compact agent activity

Calendar Year now uses a bounded full-year event window while Schedule and Journal retain their narrower 42-day validation. Year does not mount the week-scoped recording surface, so changing into Year cannot issue a stale full-year todo request during the view transition. The authenticated HEY CLI accepted the same 2026 range, and native browser verification loaded all twelve months, moved into 2027, and remained horizontally contained at compact width without an unavailable state.

Completed agent work now settles into one quiet collapsed disclosure. Expanding it shows a compact diagnostic step list and one deduplicated result region, so repeated searches no longer produce stacks of identical object cards. Native object links remain directly actionable, and canonical `app.hey.com/topics/:id` links emitted by Pi now open the corresponding conversation in the app; unrelated HEY pages continue to open externally.

Forty-three test files and 207 tests, typecheck, the production build, authenticated read-only Calendar verification, wide and compact browser inspection, year navigation, internal-link navigation, console/error checks, diff validation, React quality review, and the Impeccable detector pass. No Calendar or mail data was mutated.

## Completed follow-up: contextual and inline AI mail

Mail now has one coherent AI path across its three working surfaces. `Ctrl+K` can start or extend a Pi session from the open conversation or an explicit multi-selection; large selections remain one compact context group and direct summary/reply-review tasks stay read-only. A useful rail answer can fill the normal reply composer, and a reply can move into a new attached Pi session without being sent.

New messages, forwards, replies, and saved drafts now share a restrained inline writing surface. Empty drafts accept an instruction, selected text supports focused transformations, whole drafts can be improved or continued, and the result remains ordinary editable mail. The task-scoped Pi process has tools and extensions disabled, never owns Send, supports cancellation, rejects stale results when the draft changed during generation, and offers one-step Restore.

The anchored reply composer now uses the same roomy writing hierarchy as the full composer while preserving the conversation above it. Large To, Cc, and Bcc lists stay compact until deliberately expanded, and desktop and compact windows reserve useful writing space instead of collapsing the editor to a few lines.

Settings now discovers Pi's configured model catalog without an inference request and provides General and Quick writing profiles. Pi default remains the default. Explicit General choices apply only to new sessions; Quick can inherit General or use its own exact provider/model and thinking level. Catalog reads are cached, manual refresh is available, and a confirmed-missing saved model falls back to Pi default rather than another arbitrary provider.

Forty-five test files and 218 tests, typecheck, the production build, diff validation, React quality review, and the Impeccable design pass succeed. Synthetic browser verification covers single and grouped context, rail/reply handoff, empty and existing compose drafts, selected-text options, Stop, Restore, saved-draft assistance, model override persistence, desktop and compact layouts, large recipient lists, focus recovery, zero page overflow, and a clean page-error check. No real mail was sent or changed, and no paid model inference was required for verification.

## Completed follow-up: primary Helpers

Helpers are focused Pi skills, not separate agent runtimes. The primary bundled set is Meeting Prep, Follow-up Finder, Thread Recap, and Reply Coach. Each starts only from an explicit contextual action or `Ctrl+K` command, creates a normal visible Pi session, attaches stable object context, and loads its focused skill in addition to Pi's usual discovered skills and the existing HEY tool extension. Research uses the General model profile; Reply Coach uses the configurable Quick profile, which can inherit General. Merely opening an event or conversation performs no inference.

Meeting Prep is bounded to one event and a small set of plausibly related mail. Follow-up Finder and Thread Recap accept one to twelve explicit conversations; Reply Coach accepts exactly one and can carry the current draft from the reply composer. The research Helpers are read-only and cite native app links. Reply Coach never saves or sends, and returns only replacement reply text so the existing `Use in reply` handoff remains useful. Single-thread Helpers live quietly in the conversation's More menu, eligible multi-thread Helpers appear in the selection menu, and all contextual commands remain searchable through `Ctrl+K`.

Every Helper remains visible in session identity and persisted metadata, can be disabled in one compact Settings row, and fails locally if its packaged skill is unavailable. A versioned Helper catalog enables the three new mail Helpers once for existing Meeting Prep installations while preserving later user choices. The manifest controls presentation and eligible context only; Pi still interprets the work and chooses generic HEY commands without a keyword router or scenario-specific React workflow.

Forty-six test files and 227 tests, typecheck, the production build, packaged-resource parity, Pi RPC startup for all four skills, diff validation, React quality review, and the Impeccable design pass succeed. Synthetic browser verification covers single-thread menus, multi-selection eligibility, `Ctrl+K`, Calendar invocation, per-Helper session identity, native result links, disabled behavior, compact layout, and the Reply Coach draft-to-replacement round trip. No real Calendar or mail data was mutated and no model inference was required for verification.

## Completed follow-up: contextual object previews

Native references in agent answers, HEY tool results, and ordinary mail now reveal a small preview after intentional hover or keyboard focus. Conversation previews show the latest sender and bounded message text; Calendar events and invitations show their calendar, date, time, place, and useful notes; Calendar dates show the day's first events; contacts show their saved identity and note or mail status. Conversation participant names, the latest sender identity, Markdown email links, and safe structured links inside isolated rich-email documents all reuse the same native preview and click path. The renderer normalizes concise Pi contact and conversation links to the canonical native routes. Email links lazily resolve exact matches from HEY Contacts on hover, focus, or click; a known address previews and opens the native contact, while an unknown address retains ordinary email behavior. New Pi sessions receive the exact canonical link shapes and reuse a known contact link for its email address. The popover is orientation, not a miniature detail screen: click or Enter still opens the full native object, and date links deliberately open Calendar Day view.

The preview layer reads authoritative HEY data directly and never invokes Pi because a pointer crossed a link. Bundles, labels, and Collections now use their current HEY contents for a count and a short subject list rather than relying on agent-authored metadata. Concurrent reads for the same reference are de-duplicated, but completed data is not cached, so a recent mail or Calendar change cannot leave an old preview behind. Loading, empty objects, missing events, failed reads, keyboard dismissal, viewport repositioning, reduced motion, compact windows, and theme-derived colors are first-class states. Other stable object kinds receive their existing title and subtitle as a safe fallback until a richer authoritative read is genuinely useful.

Forty-nine test files and 244 tests, typecheck, the production build, diff validation, and the Impeccable design pass succeed. Synthetic browser verification covers conversation, date, contact, event, bundle, label, stale-event, concise-link normalization, ordinary message participants and senders, structured links inside sandboxed rich email, exact email-to-contact resolution without a premature `mailto:` fallback, confirmed unknown-address fallback, keyboard-focus, layered Escape behavior, native mail and date navigation, Calendar guest typeahead, arbitrary-address fallback, inline invalid-address correction, light and dark themes, desktop and compact layouts, and zero page overflow. No real Calendar or mail data was changed and no model inference ran.

## Completed follow-up: Daily Brief, Calendar Triage, and personal Helpers

Daily Brief and Calendar Triage now join the four original bundled Helpers. Both start explicitly from `Ctrl+K` or Calendar's compact Helpers menu, capture the chosen day/week and local time zone, and continue in the ordinary Pi sidebar. Daily Brief uses bounded mail and expanded Calendar research; Calendar Triage distinguishes actionable conflicts from tentative alternatives, mirrored copies, all-day context, and back-to-back events. Subsequent user-requested changes stay within existing HEY tools, exact approvals, and read-back verification—not a new deterministic workflow engine.

Settings now supports user-authored instruction-only Helpers with Any/Mail/Calendar context and General/Quick model profiles. Name and instructions are captured per chat; editing, disabling, deleting, or resetting interface settings does not erase existing chat instructions. Built-in preferences, duplicate/delete, validation, and compact-window authoring use the existing quiet Settings surface. Detailed scope, evidence, limitations, and user test steps live in [Helpers requirements and testing](./helpers-plan.md).

## Completed follow-up: compact session history

The sidebar keeps the 20 most recently updated unarchived sessions. “View past sessions” replaces the archived accordion and opens a searchable table in the center pane containing all saved sessions, including archived ones. Status filters, archive/restore, and restore-and-open keep older work accessible without deleting sessions or expanding the sidebar indefinitely. Session search now lives in that full-history view.

## Completed follow-up: focused Settings and system mono

Settings now opens as a compact accordion with one section expanded at a time. Headers summarize current choices; keyboard navigation, existing controls, and unsaved Helper edits survive section changes. Browser verification covered wide/dark and compact/light layouts, font application, and Helper draft preservation.

## Completed follow-up: linked account profiles

[Linked account profiles](./account-profiles-plan.md) now provides a real account footer, isolated mail/draft/chat workspaces, shared Settings and Helpers, explicit CLI account scoping, fail-closed object checks, and safe switching with stale-request rejection. Existing history is preserved for its first selected owner. Calendar stays identity-wide. Actual Electron verification uses two synthetic accounts; live multi-account verification awaits a second linked account. See the linked plan for test steps and deliberate command limitations.

## Completed follow-up: sender-first mail lists and optional avatars

The approved single-line layout puts sender, subject/preview, and date on a stable scan path across mail lists, preserving Bubbled Up, New For You, and Previously Seen. Small sender avatars are opt-in under Profile options → Settings → Appearance → Show sender avatars. The preference is shared across profiles, defaults off for existing and new installations, persists through IPC, and surfaces save failures without changing the previous choice. Narrow panes hide previews first, then stack sender and subject without shrinking text. Browser checks covered both avatar choices, keyboard/mouse selection, long-content truncation, compact layouts, and light/dark themes; 347 tests and typecheck passed.

## Completed follow-up: one-way external agent handoff

A chat's Session options now offers **Continue in another agent…**: review and edit a bounded prompt, copy it for any destination, or open a detected local Pi, Codex, Claude Code, Hermes, Cursor Agent, or Grok CLI in a new terminal session. The dialog preserves the app's native theme and keyboard boundary, with chat/account identity, destination, a roomy editor, and sharing/launch disclosures. The original **Continue in terminal** still resumes the same Pi session; the new handoff always starts a new session.

Copy creates no file. Local opening submits the reviewed text through a private prompt file retained in the profile workspace, under the destination's own model and permissions; HEY Agent's approval UI does not carry over. The prompt contains bounded chat/outcomes, selected text, stable references, scoped read commands, and local source paths, but excludes unsent composer text, local file contents, raw traces, and a full transcript export. No mailbox fetch or credential collection occurs during preparation. Results do not sync back. See [feature details and user test steps](./agent-handoff.md).

The implementation passed 402 unit tests, synthetic keyboard checks, and production-build account-profile checks using a fake terminal and clipboard spy. Those checks exercise edited-text transfer, private persistence, account/stale-preview rejection, failure recovery, and source-session preservation; they do not establish real destination authentication/model execution or live mail mutation.

## Remaining roadmap

### Desktop reliability

- Investigate intermittent text inputs ignoring typing until the window is hidden and reopened. Reported 2026-09-06; not reproduced or fixed. See [focus investigation](input-focus-investigation.md).

### AI across the app

The detailed requirements and ordered delivery plan live in [AI experience plan](./ai-experience-plan.md). Contextual mail entry, composer handoffs, inline writing, and General/Quick model profiles are complete. The remaining product slices are:

- Extend the generic contextual attachment and `Ctrl+K` pattern to future Workflow selections as that center surface is eventually implemented. Calendar event context is now connected through Meeting Prep.
- First-class HEY Workflows in the native center surface and agent results, with complete CLI impact policy, stable attachments, refresh, and deep links.
- Six bundled **Helpers** and user-authored instructions are implemented. Write Like Me is explicitly deferred; Workflow Organizer awaits native Workflow support. Third-party imports, sharing/version history, and cross-machine Helper sync remain future work.
- Contextual previews are implemented for Calendar invitations and events, dates, contacts, referenced mail, bundles, labels, and Collections, including structured links and contact identities inside ordinary mail. Metadata fallbacks remain for stable object kinds without a useful authoritative read.
- One-way external agent handoffs are implemented through reviewed copy and detected local CLI launch. Custom adapters and remote/URL integrations remain future work; results import and synchronization are outside the approved scope.
- Background auto-drafts, scheduled briefs, triage, triggers, and unattended helpers remain a later opt-in phase with separate authority, cost, and observability requirements.

### Sound follow-ups

- Decide whether new-mail cues should complement or defer entirely to native desktop notifications before enabling background notifications by default.
- Add optional per-cue muting only if real usage shows one semantic cue becoming fatiguing; avoid a large remapping surface until it is clearly useful.
- Revisit long-running workflow completion as richer agent runs land, reserving `complete` for genuine multi-step outcomes rather than ordinary answers.

### Calendar and broader HEY

- Add create-from-email through HEY's native attached-email flow when the CLI exposes an authoritative attachment contract; until then, hand off to HEY instead of creating an unlinked imitation.
- Add calendar creation/settings/sharing/import/subscription refresh only when supported public CLI contracts exist; external calendars remain read-only.
- Add invitation accept/decline from the source email only when HEY exposes that authority through the CLI.

### Omarchy distribution

- Implemented personal Linux testing distribution: native-architecture AppImage, desktop entry/icon, user-local install/update/remove scripts, build identity/checksum, desktop runtime discovery, and single-instance activation. See [Linux installation](linux-install.md). Initial verified target is x86-64 Omarchy; this is not a public release or automatic updater.
- Notifications and public-release update/distribution policy remain future work.
- Omarchy-native packaging and marketplace assessment.
- Product name confirmed: HEY Agent. Retain the current application identity and existing local data paths. The selected Tokyo Night lavender Omarchy/mail icon is now used by the packaged app and installed desktop launcher.
- Release-cycle setup: explicit patch/minor/major command, synchronized package versions, immutable version tags, local tests/builds, and direct GitHub Releases uploads with checksums/generated notes. **No GitHub Actions or paid CI**; the command blocks local/active remote workflows. See [release operations](releases.md). First authorized upload/download remains pending; public signing and automatic app updates are deferred.

## Deferred decisions

- Public distribution/signing policy; product name and current desktop icon are selected.
- Public arbitrary-harness support.
- OpenCode or ACP adapter.
- A future Omarchy system agent broker, if Omarchy exposes a stable shared service.
- Background automation policy and scheduling.
- Syncing local app metadata across machines.

## Verification baseline

Every completed slice should preserve:

- `npm run typecheck`
- `npm test`
- `npm run build`
- A live Electron check proving the preload bridge is present.
- A real local-service check when the slice touches HEY, Pi, or Omarchy.
- Visual inspection at a representative desktop size.
- No mutation claims based only on mocks or renderer state.
