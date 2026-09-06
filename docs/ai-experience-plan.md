# HEY Agent AI experience plan

Last updated: 2026-09-05

Status: active roadmap; Phases 1–3, the primary Helpers set, contextual object previews, and one-way external agent handoffs are implemented. The 2026-09-04 Helper expansion adds on-demand Daily Brief, Calendar Triage, and user-authored instructions; see [requirements and testing](./helpers-plan.md). The 2026-09-05 handoff adds reviewed copy and detected local-agent launch; see [scope and testing](./agent-handoff.md). Write Like Me, Workflows, and background assistance remain deliberately deferred.

This document is the durable product and implementation plan for using AI throughout HEY Agent. It complements [the product plan](./plan.md) and [the agentic HEY requirements](./agentic-hey-requirements.md). Those documents remain authoritative for the native application and safety boundaries; this one owns the interaction model, helper experience, model routing, Workflows roadmap, and delivery sequence.

## Product promise

AI should feel like part of the mail and Calendar application, not a chatbot bolted beside it. A user should be able to ask for nearly anything the app or supported HEY CLI can reasonably do, while staying in the surface where the work is happening.

Pi remains the only agent runtime. The app must not add a second planner, a hidden intent router, keyword or regular-expression dispatch, or deterministic prompt-specific workflows. Pi interprets ordinary language, loads the relevant installed skills, chooses supported HEY CLI operations, and composes multi-step work. The app supplies context, presentation, model selection, approval, and safe execution boundaries.

The experience is intentionally user-invoked for now. Background classification, scheduled triage, proactive auto-drafts, and unattended routines remain future work.

## One agent, three surfaces

HEY Agent has three complementary AI surfaces. They share Pi, the same stable object context, and the same safety policy, but each has a different interaction weight.

### 1. The right rail: conversation and compound work

The existing HEY Agent rail is the place for requests that require reasoning, retrieval, iteration, several objects, several tools, or a durable conversation.

Representative requests include:

- “Catch me up on this conversation.”
- “Find the earlier pricing discussion and draft a response that matches what I promised.”
- “That time works. Create an event, invite him, and prepare the reply.”
- “Add all of this sender's project mail to the Client Research Collection.”
- “Create a conference-speaker Workflow and organize these messages into its stages.”

The rail owns visible tool activity, approvals, result cards, session history, stable attachments, and follow-up conversation. It must stay available beside mail and Calendar without stealing the primary work surface.

Current mailbox-aware starters such as “Draft a reply” remain useful. They start a conversational drafting task in the rail. The missing behavior is a clean handoff from a rail draft into the real mail composer.

### 2. The center surface: contextual commands

Lists, selections, and detail views do not need another chat box. `Ctrl+K` is the consistent bridge from the current center context into HEY Agent.

With one email, event, contact, draft, Collection, Workflow, or other supported object open or focused, the palette should offer:

- Ask HEY Agent about this
- Start a new chat with this
- Add this to the current chat, when one is open

With multiple objects selected, it should offer:

- Start a new chat with the selected items
- Add the selected items to the current chat
- A small number of relevant direct tasks, such as “Summarize selected” or “Find what needs a reply”

“Start a new chat” establishes context and focuses an empty agent composer. It does not silently send a request. Choosing an explicit direct task is itself a clear read-only instruction and may begin immediately.

The current view is orientation, not an implicit attachment of everything visible. Starting a chat from Imbox may tell Pi that the user is viewing Imbox, but it must not copy hundreds of messages into context. Pi can use HEY reads when the user's request requires them.

Large selections render as one compact, count-aware context group with disclosure and removable members rather than a long wall of chips. Selection alone never marks mail seen or changes HEY state.

Do not place a permanent AI button on every row. The command palette, selection toolbar, and existing rail are sufficient discovery surfaces and keep the mailbox visually calm.

### 3. The mail composer: inline writing assistance

The composer needs a lightweight writing loop because moving to the rail for every sentence creates unnecessary context switching.

The same `Ctrl+K` palette shell remains available, but composer-relevant actions rank first. A single quiet “Write” control near the composer actions provides pointer discoverability without filling the editor with AI chrome.

When the composer is empty:

- Write a reply from an instruction
- Draft the message I describe

When text is selected:

- Rewrite
- Shorten
- Make friendlier
- Custom instruction

When text exists and nothing is selected:

- Improve draft
- Continue writing
- Custom instruction

The interaction is an anchored, temporary command surface rather than a second chat panel. The user provides a short instruction when needed; a compact “Writing…” or “Rewriting…” state replaces it while Pi works. Stop remains available.

The result opens **Review suggestion** before changing the composer. Existing drafts default to **Changes**, using Pierre's word-level comparison without file headers or line numbers; new drafts default to **Draft**, an ordinary editable text area with native spellcheck. Switch between views without losing edits. Wide windows compare the original and suggestion side by side; compact windows use an inline comparison with struck-out removals and underlined additions. Only **Use this draft** (Ctrl+Enter) replaces the body. Discard/Escape keeps the original. Inline AI never sends mail or changes recipients, subject, or attachments. The normal composer remains the final authority for delivery.

The same review gate covers **Use in reply** from the AI rail. A draft or originating-context change invalidates an open suggestion; newer text is never silently replaced. Blank and unchanged proposals cannot be applied. Comparison rendering is loaded on demand and long drafts or a renderer failure retain the editable Draft view. Editing deliberately uses the app's normal text editor rather than Pierre's beta edit mode, which disables native spellcheck. Partial acceptance and structured, versioned draft artifacts remain follow-ups.

Implementation and testing details: [Draft review](./draft-review.md).

After accepting inline Write, the previous text remains available through one-step Restore until the user makes another material edit. Rail handoffs use the review gate but do not yet offer this post-apply Restore. Cancellation and failure preserve the user's original draft and selection. Focus returns to the changed text, and inline writing status changes are announced to assistive technology.

Inline assistance receives only the active compose mode, bounded thread context when replying or forwarding, recipients and subject, the current draft, the selected text range, and the user's instruction. Email content remains untrusted reference data. The task cannot inherit authority from quoted mail.

The composer does not render Pi's full tool transcript. Requests that grow into retrieval, cross-object work, or a multi-step action offer “Continue in HEY Agent,” which opens the rail with the thread and current draft attached. Conversely, a useful rail draft offers “Use in reply” or “Use in composer.” These handoffs prevent the rail and composer from becoming competing drafting products.

### Cross-surface invariants

- Context is explicit. Opening an object does not silently replace the current chat's attachments.
- “Start new chat” and “Add to current chat” are separate commands; the app never guesses whether unrelated context should be merged.
- A handoff carries stable object identity and the current draft, not only a display title.
- An object already attached to a session is not shown with a redundant attach action.
- Native object results keep in-app deep links and remain useful after session restoration and context compaction.
- A missing deep-link target shows the normal missing-item surface and may offer agent-assisted possible matches; the renderer does not invent a replacement.

## Contextual object previews

Stable references now support a compact native preview without forcing the user to leave their current mail, Calendar, or agent context. Rich object kinds include Calendar invitations and events, dates, contacts, referenced HEY conversations, bundles, labels, and Collections. The same contact and conversation behavior appears in ordinary conversation headers, sender identities, Markdown mail, and safe structured links inside rich HTML mail. Other stable objects retain a metadata preview and can gain richer data once their authoritative read APIs and user value warrant it; Workflows remain deferred with the rest of that surface.

These are quick-access previews, not background AI. Rendering a known object must use authoritative app or HEY data and must not require a model call. Pi may help resolve an ambiguous reference only after the user deliberately asks, rather than the renderer aggressively turning every name or date into a guessed object.

The interaction:

- previews after a short intentional hover or immediately on keyboard focus; click, Enter, or touch continues directly to the full native object;
- shows a concise read-only summary, such as event time and location, the first events on a date, or the latest bounded conversation text;
- contains no mutation controls; safe actions still belong to the full native surface and its existing authority boundaries;
- preserves focus, consumes Escape before background shortcuts, keeps one preview open, and repositions safely during scroll or resize;
- shows a direct stale or unavailable state without invoking Pi, while the full native open path retains the shared missing-object recovery experience;
- uses structured references and stable IDs from app state, agent artifacts, and tool results rather than brittle text matching or sender-specific rules.

Richer persistent inline cards can be considered later when they are materially more useful than the transient preview. They must share the same object-reference contract, native destination, and action policy rather than becoming separate integrations.

## Helpers: product-facing specialists backed by Pi skills

Superhuman presents a catalog of specialized “agents,” including meeting preparation, Calendar triage, daily briefs, inbox assistance, recaps, and writing-style help. The useful idea is not a fleet of separate autonomous runtimes. It is a discoverable set of focused jobs with good instructions, clear context, and an obvious place to invoke them.

In HEY Agent, the product term should be **Helpers** unless later naming research finds something better. Technically, a helper is a thin product wrapper around one or more Pi skills plus optional local preferences. It does not receive an independent identity, memory, model process, or private tool implementation.

### Helper contract

A helper may declare:

- stable ID, title, one-sentence purpose, and provenance;
- the Pi skill or skills that provide its instructions;
- applicable surfaces such as composer, mail selection, thread, Calendar event, or Workflow;
- accepted context kinds;
- optional setup questions or local preferences;
- a preferred model profile such as General or Quick, which the user may override;
- whether it is enabled, pinned, or available only by search;
- whether it is bundled, user-created, or externally installed.

The manifest is presentation metadata, not an intent router. It can determine where a helper is eligible to appear, but it cannot parse the user's request or prescribe a HEY command sequence. Pi still reasons about the request and uses the generic tools.

Pi already handles skills through progressive disclosure: skill names and descriptions are available at startup, and the full `SKILL.md` is loaded only when a task matches or the user explicitly invokes it. Bundled helpers should use that native mechanism. Do not paste the full helper catalog or all helper instructions into every system prompt. Explicit helper invocation may force the relevant skill for that turn.

### Helper prompt quality

The shared Pi session prompt must identify the product as HEY Agent and make clear that its working directory is execution context, not the presumed subject of the user's request. An explicitly loaded Helper skill owns the focused job and output contract. This prevents Pi's general coding-assistant defaults from turning an attached email into a question about “the repository” while preserving Pi as the runtime and its normal agentic tool use.

Each bundled Helper skill should read like a brief for a capable teammate: name the job, identify its authoritative attached context, state the decision rules that separate a useful answer from a plausible one, bound any research and authority, and define the user-visible result. Include a few compact behavioral examples only where the output boundary is otherwise easy to misread. This follows current primary guidance to be clear about the desired result and constraints, provide relevant context, and use representative examples, as well as Superhuman's own agent-builder guidance to define role, tone, rules, and examples. References: [Anthropic prompting best practices](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prompt-templates-and-variables), [Google prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies), and [Superhuman agent builder](https://help.superhuman.com/hc/en-us/articles/47453035724685-Create-and-configure-agents-with-the-agent-builder).

Reply Coach has the strictest UI contract: every completed answer is paste-ready replacement text. It must read the full attached thread, infer the latest response job, revise an included draft without changing its position, and return only an email body. Missing information becomes a natural question to the recipient inside that body; Reply Coach must never ask the app user a meta-question that the UI then labels `Use in reply`. Superhuman's published contextual-reply flow similarly begins with the full thread and produces a draft ready for review rather than another discovery step: [Superhuman Mail MCP use cases](https://help.superhuman.com/hc/en-us/articles/46005872462605-Superhuman-Mail-MCP-Use-Cases).

Prompt evaluation must cover at least: a direct question with a grounded answer, a missing fact that should become a question to the recipient, a forwarded link or FYI without an explicit ask, an existing draft whose intent must survive revision, a superseded commitment, an already-resolved follow-up, overlapping threads, sparse meeting context, and prompt injection inside attached mail. The test succeeds on behavior, grounding, authority, and fit to the UI action—not on matching canned wording.

### Initial helper candidates

The Helper roadmap should cover distinct jobs rather than many differently named rewrite buttons:

- **Meeting Prep** — collect recent mail, Calendar context, commitments, unanswered questions, and relevant links for an upcoming meeting.
- **Reply Coach** — help decide what a reply must accomplish, then draft or revise it in the user's voice.
- **Write Like Me** — learn from explicitly chosen sent examples or user-provided guidance; never silently train from the whole mailbox.
- **Follow-up Finder** — inspect a selected set or requested scope for unanswered commitments and prepare next steps.
- **Thread Recap** — summarize decisions, changes, owners, and open loops across one or more conversations.
- **Daily Brief** — on explicit request, combine the chosen day's expanded Calendar with bounded Imbox and Reply Later research, highlighting genuine commitments and outstanding replies. Broader sent-mail retrospectives and Workflow summaries remain later extensions.
- **Calendar Triage** — on explicit request, review a day/week for genuine scheduling problems, respecting tentative alternatives, mirrored events, all-day context, and personal preferences. Follow-up changes use ordinary Pi tools and existing approvals.
- **Workflow Organizer** — create, inspect, and reorganize HEY Workflows from ordinary language using the generic HEY tool.

The original primary set—**Meeting Prep**, **Follow-up Finder**, **Thread Recap**, and **Reply Coach**—is implemented on the shared Pi Helper foundation. **Daily Brief** and **Calendar Triage** extend that set to six bundled skills. They use the same visible chat, native links, General model profile, and explicit-launch boundary. Each captures its date range and local time zone when invoked; there is no background scan or separate triage engine.

The remaining Helpers are deferred, not discarded:

- **Write Like Me** is explicitly deferred by product choice. If revisited, it needs an explicit-example and privacy model; it must never silently learn from the whole mailbox.
- **Workflow Organizer** remains planned after the native Workflow surface and its agentic contracts exist.

Helpers live in compact Settings rows and eligible contextual menus, with `Ctrl+K` as the searchable entry point. Calendar's Helpers menu opens only on request. Saving, navigation, and hover never invoke a model. Launch by catalog ID captures the correct instructions; ordinary chat remains available for free-form requests, without a new keyword router.

User-authored instruction-only Helpers are implemented: name, instructions, context (Any/Mail/Calendar), and model profile (General/Quick), with edit, duplicate, enable/disable, and confirmed deletion. Settings are local; each session retains its captured name and instructions after later edits or deletion. Daily Brief and Calendar Triage also accept optional plain-language preferences. None of these settings expands authority or creates a sandbox around normal Pi tools.

Importing reviewed third-party skills remains a separate milestone. Arbitrary skills may contain scripts; the app must not silently install, trust, or update them. Sharing/export, version history, and cross-machine Helper sync are also deferred rather than implied by local authoring.

### No proactive execution yet

Helper eligibility and suggestions are not background automation. No helper runs because a message arrived, a Calendar date opened, or a timer elapsed. Triggers, schedules, notifications, and unattended work belong to the future background-assistance phase and require separately designed authority, observability, cost controls, and recovery.

### External agent and automation handoffs

**Implemented, 2026-09-05:** a chat's Session options now offers **Continue in another agent…**. The user reviews and edits a bounded prompt, copies it for any destination, or opens a detected local Pi, Codex, Claude Code, Hermes, Cursor Agent, or Grok CLI in a new terminal session. Unsupported and web agents use the same copy path. See [handoff behavior, persistence, and testing](./agent-handoff.md).

Pi remains HEY Agent's runtime. The one-way prompt includes recent chat and tool outcomes, selected text, stable object references, account-scoped read commands, and local source paths/session identity. It excludes unsent composer text, local file contents, raw tool traces, and a full transcript export; no mailbox fetch or credential collection occurs to prepare it. Quoted mail and other sensitive chat content can be included, so the destination and editable material appear before either action.

Local discovery recognizes supported CLI help output. Launch submits a seed prompt using a private UTF-8 file retained in the profile workspace; it starts a new external session under that agent's own model and permission settings. HEY Agent's approval controls do not carry over and cannot enforce the prompt's request for approval. Copy creates no file. Web agents cannot open local files or run HEY commands merely because the prompt mentions them.

The originating Pi session stays intact. The separate **Continue in terminal** action still resumes that same Pi session; a handoff to Pi starts a new one. Failed or unavailable local launches retain a copy fallback. Results import and synchronization are outside the approved feature scope.

Custom adapters, remote/URL integrations, and broader automation launch mechanisms remain future work. Their availability must not imply authentication, mailbox access, or an app-enforced permission boundary.

## Model profiles and settings

Users may want a capable default model for open-ended agent work and a faster or less expensive configured model for narrow writing operations. The app should support that without taking ownership of the user's provider credentials or changing Pi's global configuration.

### Verified Pi capabilities

The installed Pi 0.84.4 provides:

- `get_available_models` over RPC for the configured model catalog;
- `set_model` over RPC using provider and model ID;
- `set_thinking_level` over RPC;
- `--model`, `--provider`, and `--thinking` at process start;
- the current model in `get_state`.

The app currently starts Pi without provider or model flags, correctly inheriting Pi's configured default. That remains the default behavior.

### Initial settings model

Settings should expose one compact **AI models** section:

- **General agent** — defaults to “Use Pi default.” An explicit provider/model and thinking level affect newly created HEY Agent sessions. Existing sessions retain their current Pi model unless the user changes that session directly.
- **Quick writing** — defaults to “Same as General agent.” An override applies to composer generation and short transformations without changing the visible rail session's model.

Each choice comes from Pi's configured available-model response. The app stores provider, exact model ID, and thinking level, not a fuzzy display name. A refresh action asks Pi for the current catalog. If Pi removes a configured model or its provider becomes unavailable, Settings keeps the saved value visible as unavailable, explains the fallback, and uses the inherited Pi default rather than silently choosing a different paid provider.

Model metadata may show provider, context size, image support, reasoning support, and Pi-reported price where available. The app must not label a model “fast” without measured or provider-supplied latency data. “Quick writing” describes the workload profile, not a guaranteed property of its selected model.

Changing the General setting must not rewrite Pi's own `settings.json`. It changes only app-created sessions. Changing Quick writing must not hot-swap the model of a running sidebar session.

### Execution lanes

Durable rail conversations use normal persisted Pi RPC sessions. Quick composer operations use the same installed Pi runtime and configured model providers but a separate task-scoped execution lane so a temporary model choice cannot race with or mutate the active chat. That lane receives only bounded composer context and starts with tools and extensions disabled. It can return replacement text; it cannot send mail or perform unrelated HEY mutations.

The initial implementation uses a short-lived Pi RPC process per writing request. This keeps model selection isolated and cancellation explicit. A warm reusable process is a later performance option only if measurement shows the cold start is material; it must preserve the same no-chat, no-tools, bounded-context, and no-side-effect behavior.

A future Background profile may be added only when background assistance is designed. Do not expose a nonfunctional setting now.

Helpers inherit General or Quick according to their declared workload. An advanced per-helper override can come later if real usage requires it; the first version should avoid a matrix of model selectors.

## HEY Workflows roadmap

HEY CLI 1.4 supports Workflow list, view, create, rename, delete, stage management, and adding, moving, and removing email threads. Workflows need first-class product coverage rather than falling through the generic unknown-operation presentation.

### Native Workflow experience

- A center surface lists Workflows and opens a Workflow with its ordered stages and contained conversations.
- The structure follows HEY's Workflow concepts and language rather than presenting a generic project board.
- The user can create and rename a Workflow, add/rename/reorder/delete stages when supported, add or remove selected conversations, move conversations between stages, and delete a Workflow.
- Keyboard navigation, selection, `Ctrl+K`, loading, optimistic reconciliation, errors, and focus return follow the established mail and Calendar behavior.
- Workflow and stage results receive stable native object kinds, attachments, result cards, refresh hints, and `hey-agent:` deep links.
- Missing Workflow or stage links use the shared missing-item surface and optional Pi-assisted possible matches.

### Agentic Workflow experience

Pi uses the installed HEY skill and generic `hey` argv tool for requests such as:

- “Create a Workflow for conference speakers with Invited, Confirmed, and Complete stages.”
- “Add these selected conversations to Invited.”
- “Move everyone who confirmed into Confirmed.”
- “Show me what is stalled in this Workflow and draft the follow-ups.”

The renderer must not implement those sentences as scenarios. It supplies stable selected objects, renders the generic calls and results, and refreshes affected Workflow and mailbox surfaces.

Workflow policy must deliberately classify every CLI operation. List and view are read-only. Bounded add, remove, and move operations are reversible organization. Creation and rename require scope-aware treatment. Stage or Workflow deletion is destructive. Broad mutations and previously unknown operations require exact review. Because a HEY for Domains Workflow may be shared, review must make shared scope visible without implying that its contained emails are automatically shared.

## Background assistance: future roadmap only

Potential later work includes auto-drafts, scheduled Daily Briefs and Calendar triage, reply reminders, inbox preparation, Workflow monitoring, and other unattended Helper triggers. Only explicitly launched briefs and triage are implemented today.

Before any background feature ships, it needs its own requirements for:

- explicit opt-in and visible schedules or triggers;
- separate model and cost settings;
- declared read and mutation authority;
- quiet-hours and notification behavior;
- run history, cancellation, and failure recovery;
- stale-context and duplicate-run prevention;
- exact approval before externally visible effects;
- privacy and retention controls.

## Design and accessibility requirements

The three-surface model is the defense against an AI-heavy interface. The rail may be rich because it is a deliberate workspace. The center surface exposes AI through existing commands. The composer adds only one local affordance and a temporary interaction.

- Never show more than four immediate AI choices at one decision point; place the rest behind search or disclosure.
- Preserve keyboard parity for every pointer action.
- Keep focus inside temporary composer UI, return it predictably, and announce generation state and completion.
- Respect reduced motion and never animate layout in a way that moves the draft under the pointer or caret.
- Keep user text legible and visually primary; AI provenance and Restore remain available without becoming a permanent card around the draft.
- Errors are local, concise, and non-destructive. A failed generation never clears or replaces the draft.
- Tool activity and approvals use the existing compact visual language; helpers do not introduce a second design system.

## Performance requirements

- Opening `Ctrl+K`, helper suggestions, and selection context is local and immediate; no model call is required to show available commands.
- Starting a new contextual chat shows its attachments optimistically while stable identity is persisted.
- Inline generation shows its working state immediately and supports cancellation.
- Quick actions do not perform redundant HEY reads when authoritative thread context is already loaded and bounded.
- A helper loads full instructions only when used.
- Model catalog refresh is explicit, cached, and independent of a paid inference request.

## Delivery sequence

### Phase 1 — Contextual entry and handoff

Implemented for mail on 2026-09-03. The command palette now supports explicit single- and multi-conversation session context, direct read-only selection tasks, compact grouped context, and reply drafts moving between the rail and reply composer without sending. Calendar and future Workflow objects should adopt the same generic attachment pattern as their selection surfaces mature.

1. Add object-aware and selection-aware HEY Agent commands to the existing `Ctrl+K` registry.
2. Support Start new chat, Add to current chat, and compact grouped attachment presentation.
3. Add rail-draft “Use in reply/composer” and composer “Continue in HEY Agent” handoffs.
4. Verify no implicit send, seen-state change, or context replacement.

### Phase 2 — Inline composer assistance

Implemented for new messages, replies, forwards, and saved drafts on 2026-09-03. `Ctrl+K` and the quiet Write control open the same anchored surface. Empty drafts accept an instruction; selections can be rewritten, shortened, or made friendlier; whole drafts can be improved or continued. Results replace ordinary editable text, Stop preserves the current draft, Restore returns the previous text, and nothing can send from this lane.

1. Add the restrained composer affordance and composer-scoped command ranking.
2. Implement empty, selected-text, and whole-draft operations through a task-scoped Pi lane.
3. Add Stop, Restore, focus recovery, and accessible status.
4. Verify compose, reply, forward, saved drafts, recipient edits, attachments, and compact-window behavior.

### Phase 3 — Model settings

Implemented on 2026-09-03. Settings reads and caches Pi's configured model catalog without inference, preserves exact provider/model IDs, offers General and Quick profiles plus supported thinking levels, retains unavailable selections visibly, and falls back to Pi's inherited default only when the catalog confirms the saved model is absent. General applies only to new durable sessions; Quick runs in its isolated composer lane.

1. Add typed model catalog and model-profile settings contracts.
2. Query Pi's configured available models and supported thinking levels.
3. Apply General only to newly created durable sessions and Quick only to task-scoped writing runs.
4. Handle stale or unavailable selections without silently changing providers.

### Phase 4 — Workflows

The approved one-way transfer is implemented; additional integration mechanisms remain future work.

1. Complete Workflow impact classification, artifacts, refresh domains, attachments, and deep links.
2. Add the HEY-native Workflow list/detail and management surface.
3. Add Workflow-aware selection and `Ctrl+K` entry points without prompt routing.
4. Prove ordinary-language create, organize, inspect, and follow-up flows through Pi and the generic HEY tool.

### Phase 5 — Helpers

1. **Implemented:** package the primary four as bounded Pi skills behind one small presentation-and-eligibility manifest.
2. **Implemented:** expose enabled state in Settings and context-aware `Ctrl+K` commands without adding an intent parser.
3. **Implemented:** invoke Meeting Prep from an open Calendar event; invoke mail Helpers from an open conversation or eligible explicit multi-selection; invoke Reply Coach directly from the reply composer with the current draft.
4. **Implemented:** keep every run as a normal visible Pi session with stable attached objects, native links, and normal tool activity. Research Helpers use General; Reply Coach uses Quick, which may inherit General in Settings.
5. **Implemented:** test explicit skill loading without disabling normal Pi discovery, persisted Helper identity, bounded context, read-only authority, replacement-only Reply Coach output, and unavailable-skill recovery.
6. **Implemented:** optional plain-language preferences for Daily Brief and Calendar Triage, applied only to new sessions.
7. **Implemented:** on-demand Daily Brief and Calendar Triage, bounded research, captured date/time-zone scope, partial-source reporting, calibrated conflict guidance, and user-requested Calendar follow-through through existing approvals.
8. **Implemented:** local instruction-only authoring, context and model choices, CRUD/disable controls, validation, and immutable session instruction snapshots.
9. **Deferred:** Write Like Me, Workflow Organizer, third-party skill installation, sharing/version history/sync, and scheduled runs. Each retains its separate privacy, capability, or authority requirements.

### Phase 6 — External agent and automation handoffs

One-way handoffs are implemented. The user has now confirmed a real handoff works; broader destination coverage remains future work, not a requirement for this slice.

1. **Implemented:** bounded editable prompt with recent conversation/outcomes, selected references/text, source identity, native links, and account-scoped CLI reads.
2. **Implemented:** explicit destination review, universal copy, and recognized local CLI launch through a retained private prompt file into a new session.
3. **Implemented:** stale/account-changed preview rejection, private file permissions, exact edited-text transfer, launch failure recovery, and duplicate-launch prevention.
4. **Verified with fixtures:** unit coverage and keyboard/production IPC checks with clipboard and terminal spies, preserving the source Pi session. Actual external model execution and live mail writes were not exercised.
5. **Future:** custom adapters and remote/URL integrations. Results import and synchronization are outside the approved scope.

### Phase 7 — Contextual object previews

1. **Implemented:** extend the structured native reference contract with Calendar dates while reusing stable IDs and `hey-agent:` links already produced for Calendar events, contacts, and mail.
2. **Implemented:** show a compact accessible preview after intentional hover or keyboard focus, while retaining click or Enter as the direct path into the full native object.
3. **Implemented:** resolve conversation, contact, Calendar event or invitation, Calendar-day, bundle, label, and Collection previews from authoritative HEY APIs without invoking Pi. Other stable objects retain a quiet metadata fallback instead of gaining bespoke workflows.
4. **Implemented:** open date references in Calendar Day view and every other reference through the existing native deep-link path. Do not put mutation controls in the preview surface.
5. **Implemented:** cover delayed loading, empty days, stale events, unavailable data, Escape dismissal, compact windows, theme contrast, cache bounding, and live repositioning during scroll or resize.
6. Later, add richer previews for other stable HEY objects only when their authoritative read APIs and real user value justify more than the metadata fallback.

### Future phase — Background assistance

Design and validate the separate authority, scheduling, cost, observability, and recovery model before implementing any trigger or unattended run.

## Acceptance scenarios

- From an open reply composer, the user selects a paragraph, invokes `Ctrl+K`, asks for a warmer version, receives editable replacement text, restores the original, and sends nothing until using the normal Send action.
- A rail conversation finds relevant prior mail and produces a draft card; “Use in reply” opens the correct conversation composer with the draft filled and editable.
- A complex composer request moves into a new visible rail session with the thread and current draft attached exactly once.
- Selecting many conversations and choosing Start new chat creates a new session with one compact grouped context artifact and no mailbox mutation.
- General sessions continue to inherit Pi's default model by default; selecting a Quick writing model changes composer assistance without changing the active rail session.
- An unavailable saved model is shown honestly and falls back to Pi default rather than another arbitrary provider.
- Invoking Meeting Prep loads the relevant helper skill on demand and produces a bounded brief with native links; merely opening the event does not run it.
- Hovering or focusing a native conversation, contact, Calendar event, date, bundle, label, or Collection reference reveals a bounded authoritative preview without invoking Pi; the same is true for supported links and identities inside ordinary mail, and activating one opens the full native object.
- From an idle chat with the intended references attached, the user chooses “Continue in another agent…” and reviews a bounded prompt, then copies it or requests a new local-agent terminal session. The app exports no credentials or unsent composer text; the destination's own permissions apply and nothing syncs back.
- A user asks Pi to create and populate a Workflow. Pi chooses supported CLI operations, exact shared or destructive effects receive review, and the result opens in the native Workflow surface.
- Keyboard-only and screen-reader users can invoke, stop, restore, hand off, approve, and navigate every AI result.
- Prompt injection inside mail, helper input, or attached files cannot grant authority or cause an unreviewed external effect.

## Reference products

- [Superhuman Agents](https://superhuman.com/agents) — contextual specialist positioning and help that appears in the surface where work occurs.
- [Superhuman Agent Store](https://superhuman.com/store/agents) — discoverable specialist/template catalog, including Meeting Prep, Calendar Triage, Daily Brief, Email Assistant, Recap, and Write Like Me.
- [HEY Workflows](https://help.hey.com/article/767-workflows) — HEY's native organization model and domain-sharing expectations.
