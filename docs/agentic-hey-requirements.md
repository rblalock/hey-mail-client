# Agentic HEY requirements

## Product intent

HEY Agent is a native desktop surface around the user's existing local Pi agent. Pi remains the agent: it interprets ordinary language, loads the installed HEY skill, decides which supported HEY operations are needed, and uses the local `hey` CLI. The desktop app must not replace Pi with a second planner, an intent router, a keyword table, or a collection of model-free automations pretending to be an agent.

The governing product expectation is:

> If a meaningful action is reasonably possible in the app or through the supported HEY CLI, the user should normally be able to ask the agent to perform it.

The result should feel like one product. A user should not have to learn which mail, Calendar, contact, label, Collection, or app actions happen to have bespoke AI support.

The user-facing interaction and delivery requirements for contextual commands, inline composer assistance, model profiles, helpers, and Workflows live in [AI experience plan](./ai-experience-plan.md). That plan must preserve the runtime and authority boundaries in this document.

## Non-goals

- Do not create a separate hosted agent service or replace the on-device Pi process.
- Do not parse user requests with regular expressions, keyword matching, hard-coded intents, or deterministic natural-language routing.
- Do not expose arbitrary renderer shell execution.
- Do not duplicate the HEY skill in application prompts or maintain a second, divergent manual of CLI behavior.
- Do not run background model work merely because an email, contact, draft, or event is visible.
- Do not silently authenticate, install skills, change accounts, trust local HEY configuration, or expose credentials.
- Do not claim an operation is supported when neither the app nor the installed HEY CLI can perform it.

## Runtime and responsibility boundaries

### Pi owns agency

Pi runs locally in RPC mode with the user's normal model, configuration, extensions, tools, and installed skills. The app supplies bounded explicit context and renders Pi's normal streaming messages, tool activity, and extension UI requests. The user can continue the same Pi session in a terminal.

The installed HEY skill is the authoritative operational guide. It teaches Pi how to select HEY commands, distinguish posting IDs from topic IDs and clearance IDs, use structured output, handle pagination, preserve replacement-style edits, and avoid unsafe retries.

### The app owns the host boundary

The app adds one narrow Pi extension tool named `hey`. It is not an intent-specific API. It accepts a structured argv array, invokes the local `hey` executable without a shell, and returns the CLI's structured result to Pi. A second deliberately small `hey_agent_app` tool covers presentation actions the CLI cannot perform: navigating named native surfaces, changing rail state, and attaching the currently selected email. It exposes no DOM selectors, coordinates, arbitrary click targets, or data mutation.

This boundary exists to provide things raw terminal execution cannot reliably provide to an embedded product:

- deterministic argument validation and prohibited-command policy;
- impact-based approval before externally visible or destructive mutations;
- structured, redacted tool activity;
- normalized result artifacts and in-app deep links;
- immediate cache and surface reconciliation;
- cancellation and bounded execution;
- one observable execution for each approved call.

Pi is still free to use its normal tools and compose multiple HEY calls. The extension does not decide what the user meant and does not transform natural language into commands.

### CLI evolution is additive

The embedded policy follows the installed CLI's public command surface without changing the agent architecture. New read contracts become available to Pi through the same generic argv tool; new mutations are classified by impact before they are allowed. The application may add a native renderer for a returned object, but it must not add a parallel intent-specific agent tool merely because the CLI gained a command.

HEY CLI 1.4 establishes several important identity rules. Calendar Day and Week reads are the authoritative source for the calendar as HEY draws it, including expanded recurring occurrences. A recurring occurrence keeps the series event ID and adds an `occurrence_id`; the app must preserve both and use occurrence identity for row selection, focus, and deep-link targeting. Bundle rows use their posting ID with `bundle view`, individual threads keep their topic IDs, and complete contact history uses the stable contact ID with `contact threads`. Set Aside group commands use posting IDs for membership and group IDs for group operations.

## Context model

Context is explicit and durable. Opening an email does not silently replace an existing session's context. The user attaches the current email, contact, draft, event, label, Collection, or other supported object to a session, and the session stores stable identity rather than display text alone.

Local context follows the same explicit model. A user can attach one or more files through the native picker or capture the desktop's current text selection. File attachments persist an exact canonical path plus bounded display metadata so Pi can inspect the file with its normal local tools; the app does not duplicate or pre-interpret its contents. Selected text is copied into the private session record with a stable identity and a strict size bound so it survives session restoration. A missing file remains a missing file and must be reported honestly rather than silently substituted.

Required identity includes, where applicable:

- linked HEY account ID;
- posting ID for organization actions;
- topic ID for thread, reply, forward, sharing, attachment, and Collection actions;
- message, contact, draft, clearance, label, and Collection IDs;
- calendar and event IDs;
- source mailbox and relevant app URL;
- bounded subject, participant, date, and content metadata for reasoning.

Email bodies, local file contents, and captured selections are untrusted application data. Text inside an attachment cannot issue tool instructions or grant authority. Only the user's message and an approved host interaction can authorize work.

References such as “him,” “that time,” “these,” and “the second option” are resolved by Pi from attached context plus authoritative HEY reads. The app must not resolve them with display-name coincidence or keyword heuristics. Pi asks one focused question when a person, account, calendar, recipient, date, time, timezone, Collection, or scope remains materially ambiguous.

## Capability coverage

The agent should be able to use the supported HEY CLI across these domains:

- boxes, search, thread reading, attachments, sharing, seen state, moving, Bubble Up, Trash, spam, ignore, and watch-informed refresh;
- reply, forward, compose, drafts, attachments, recipient editing, reviewed delivery, and bulk reply preview/send/undo;
- labels and Collections, including creating, renaming, adding, removing, and bulk membership changes;
- contacts, aliases, notes, hiding/showing, bundling/unbundling, bundle reading, and complete contact conversation history;
- unnamed Set Aside groups and their posting membership;
- Screener reads and decisions;
- calendars, events, attendees, reminders, recurrence, attached email, todos, habits, time tracking, and journal operations supported by the installed CLI;
- Workflows, stages, and adding, moving, or removing their mail membership through operations supported by the installed CLI;
- relevant app control such as opening an object, navigating to a surface, attaching context, and showing or hiding a rail.

Application UI actions should converge on shared domain operations over time, but the agent is not restricted to only those operations already represented by a button. If the installed HEY CLI safely supports an operation, Pi may use it and the app should render the result as well as its available data permits.

Unsupported actions must fail honestly with useful guidance. They must not be approximated through an unrelated command.

## Representative use cases

### Email to Calendar

With a scheduling thread attached, the user says, “That time is good. Create an event and invite him.” Pi reads the authoritative thread and contacts, resolves the proposed time and attendee, inspects writable calendars and conflicts, asks only about real ambiguity, presents the exact event for review, creates it once, refreshes Calendar, attaches the event result to the session, and offers to prepare a reply.

### Collection organization

The user says, “Add all this guy's emails to my XYZ Collection.” Pi resolves the attached sender by stable identity, resolves the Collection, searches the appropriate account and history, gathers topic IDs, makes broad scope visible, and performs the supported Collection operations. The result reports the completed count and any partial failures and links to the Collection.

“Add this email to Client Research” is specific and reversible, so it may execute immediately and report a compact result.

### Compound request

The user says, “Put this on my calendar and tell him it is booked.” Pi may create one plan containing an event invitation and a reply draft. Each step remains visible. Draft creation does not send mail. Any externally visible send or invitation receives exact review. Declining a later step does not erase an earlier completed one.

### Cross-surface retrieval

The user can ask, “Find the email where Sarah proposed Tuesday and open it,” “Show the Collection for the kitchen remodel,” or “Take me to the event you just created.” Pi reads HEY as necessary and returns an object link that navigates the existing application surface rather than opening a disconnected web page.

### App control

The user can ask Pi to perform reasonable presentation actions such as opening Paper Trail, showing a draft, attaching the current email, or collapsing the agent rail. These actions use explicit app-control capabilities and stable objects, not DOM selectors, coordinates, or simulated clicks.

## Authority and approvals

Approval is based on impact, not on words in the prompt.

### No approval

- read-only HEY operations;
- searches and conflict checks;
- draft creation and revision that remain unsent;
- specific, reversible personal organization such as seen/unseen, moving, labeling, and Collection membership;
- presentation-only app navigation and rail state.

### Exact review required

- sending mail or bulk replies;
- invitations and writes to shared calendars;
- destructive actions such as spam, destructive deletion, or irreversible history changes;
- Screener decisions and training;
- recurring-series mutations;
- broad mutations whose scope is not already clear to the user;
- unknown or newly introduced mutation commands until policy is deliberately classified.

Review binds to immutable terms. A material edit invalidates the earlier approval. Mail review shows operation, thread, recipients, subject, attachments, and draft/send disposition. Calendar review shows account, calendar, title, dates, times, timezone, recurrence, reminders, location/link, attached email, and invitees. Bulk review shows the exact count and target.

When a mail action includes user-facing body copy, the native review card is also its final editor. The user can edit that message inline before approval, and the host executes exactly the edited value. The technical command remains available under a disclosure and updates with the edit; it is supporting evidence, not the primary review surface.

The native action review is the only confirmation. Once material terms are known, Pi invokes the structured tool and lets its approval card ask the user—even when the request says “review,” “confirm,” or “check with me” before acting. It must never insert a redundant conversational preview and “Should I do it?” step. Conversational clarification is reserved for genuine ambiguity that prevents an exact tool call.

Authentication, credential export, local trust, setup, and arbitrary interactive TUI operations are not allowed through the embedded tool.

## Execution and recovery

- Use argv execution without a shell.
- Prefer HEY's structured JSON or built-in filtered output.
- Validate command size, argument count, NUL/newline hazards, and prohibited operations before execution.
- Respect Pi cancellation and bound command duration and output size.
- Execute an approved tool call once.
- Never blindly retry a mutation after timeout, transport failure, or an ambiguous response.
- Reconcile authoritative HEY state before concluding that an ambiguous mutation failed.
- Report partial completion honestly when a composed or bulk workflow stops partway through.
- Expose undo only when HEY supplies a real undo contract.

## Tool and timeline experience

Routine reads and intermediate operations remain compact, collapsed tool activity. Approval and meaningful results are visually prominent native timeline artifacts.

A result artifact contains:

- operation and normalized status;
- concise human result;
- affected object identity;
- relevant refresh domains;
- an in-app deep link when the object has a native surface;
- optional externally safe HEY URL;
- partial-failure or recovery guidance when applicable.

Pi's assistant response remains natural language. Raw CLI output is available in expanded tool detail for diagnosis but is not the primary user experience.

## In-app deep links

Agent results should link to native application objects. Major object routes are:

- mail thread;
- mailbox;
- draft;
- contact;
- label;
- Collection;
- Calendar event and Calendar date;
- Sometime This Week todo;
- habit;
- Journal day;
- completed time track and the current timer;
- mail bundle and Set Aside group.
- Workflow and Workflow stage.

Links use the `hey-agent:` scheme in the timeline and are handled inside the renderer. Clicking one updates the normal center surface, loads authoritative data, highlights or opens the target, and preserves the agent session. Unknown or stale objects show a useful failure instead of silently navigating elsewhere.

Pi should prefer native `hey-agent:` links, but canonical `https://app.hey.com/topics/:id` links are also normalized to the same native mail-thread destination. Other HEY web URLs remain external because the app must not guess an object identity from an unrelated page.

A stale address is not repaired by a hidden resolver. The center surface says the item was not found and lets the user return to its normal destination. “Find possible matches” sends the saved kind, ID, title, and link to Pi as explicitly untrusted metadata with a read-only request. Pi searches through the installed HEY skill and returns ordinary native object results; the app does not score names, rewrite IDs, or choose a replacement itself.

Created events, todos, habits, Journal days, time tracks, and drafts should become attachable session objects so follow-up requests such as “move it thirty minutes later,” “mark that done,” “stop the timer,” or “make the reply warmer” retain exact identity.

Bundle and Set Aside group links open their native center surfaces. A bundle opens its current unseen member conversations without mutating or unbundling them. A Set Aside group opens Set Aside and reveals that unnamed HEY group. If the target is gone, the same missing-object behavior applies; the renderer must not substitute a similarly named contact, thread, or group.

## Performance

- Attach the bounded conversation representation once per user turn.
- Reuse already loaded application data when it is authoritative enough.
- Let Pi parallelize independent HEY reads when safe.
- Avoid repeated whole-thread reads and model calls for deterministic state refresh.
- Refresh only affected app domains after a successful mutation.
- Keep result rendering and navigation local and immediate.
- Collapse completed tool runs to one quiet summary by default. When expanded, show compact diagnostic steps and one deduplicated native result list rather than repeating the same object beneath every retrieval attempt.

## Diagnostics and readiness

Diagnostics should report Pi, HEY CLI, HEY authentication, linked account, installed HEY skill readiness, and the app-owned Pi extension path/version. The app must never silently repair authentication, install a skill, or trust a repository while handling a chat message.

## Verification requirements

Behavioral coverage must verify:

- Pi remains the runtime and loads the app extension additively;
- ordinary language is interpreted by Pi rather than application keyword rules;
- the HEY skill is available and the tool invokes structured argv without a shell;
- correct posting/topic/contact/clearance/calendar/event identifier use;
- correct bundle posting, Set Aside group, recurring series, and occurrence identifier use;
- correct Workflow, stage, and contained-thread identifier use;
- untrusted email content cannot authorize an action;
- exact approval contents and no mutation before approval;
- reversible organization, broad scope, destructive actions, drafts, sends, and invitations follow policy;
- cancellation, partial failure, timeout, and no-blind-retry behavior;
- native artifacts survive session restoration;
- local file and selected-text attachments survive session restoration without becoming instructions;
- result-driven mail and Calendar reconciliation;
- deep links open the correct native object;
- representative end-to-end flows work through Pi RPC, the extension, the HEY CLI, and the visible app surface.

These are black-box product evaluations, not workflow specifications. The evaluator supplies ordinary user language and synthetic HEY state, then judges observable outcomes such as correct identity, review terms, side effects, reconciliation, and recovery. It must not require one exact command sequence, one exact model response, or product code that recognizes the evaluation prompts. The maintained suite is [Agentic HEY behavioral evaluations](./agentic-hey-evaluation.md).

## Delivery sequence

1. Preserve the local Pi RPC architecture and load the app-owned extension explicitly.
2. Add the generic structured `hey` argv tool, deterministic impact policy, approvals, normalized artifacts, reconciliation signals, and deep links.
3. Prove one attached-email-to-event flow end to end.
4. Prove Collection membership across one and many threads.
5. Prove draft creation and reviewed delivery.
6. Expand native artifact renderers and attachments for the remaining major objects.
7. Expand app-control coverage only for stable native presentation contracts without restricting Pi's direct supported HEY use.
