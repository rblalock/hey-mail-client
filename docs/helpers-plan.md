# Daily Brief, Calendar Triage, and personal Helpers

Status: implemented for local testing, 2026-09-04. Extends the existing Pi Helpers; does not add an agent runtime, background worker, intent router, or deterministic triage engine. See [how to test](#how-to-test) and the evidence boundaries below.

## Experience and scope

- Start explicitly from Ctrl+K, Calendar's compact Helpers menu, or an eligible Helper in Settings. No inference on hover, navigation, startup, or save.
- Every run opens an ordinary named chat with visible context, tool activity, Stop, native links, and follow-up conversation. Do not add a report dashboard or a wall of launch cards.
- Daily Brief uses one chosen day (today outside Calendar). Calendar Triage uses the displayed day/week (this week outside Calendar; Year does not imply scanning a year). Capture the date and local time zone at invocation, so later navigation or midnight cannot change an in-flight run.
- Preserve the established desktop density, theme tokens, animated icons, semantic sound cues, keyboard navigation, and compact-window behavior. Authoring expands only when requested inside Settings.
- General model profile for research; personal Helpers may use General or Quick. Never change Pi configuration or an already-running session's model.

## Daily Brief

Job: explain what deserves attention on the selected day, with enough evidence to act and little enough text to scan.

- Read the authoritative expanded day, distinguishing all-day context from timed commitments. Use HEY's day API, not the unexpanded event-series list.
- Inspect a bounded sample of Imbox and Reply Later, plus narrowly relevant recent searches when necessary. Read full conversations only when needed to establish a decision, deadline, or unanswered request. Do not scan the entire mailbox, enumerate linked accounts, or load private journals by default.
- Separate the user's outstanding commitments from waiting on others; latest replies override stale requests. Age and unread status alone do not establish urgency. Do not call future obligations overdue, newsletters actionable, or a partial sample comprehensive.
- Show the most important items first, with native mail/event links next to the claim. Include schedule context, a few genuine next steps, and a short coverage note. Omit empty headings, greetings, motivational copy, research narration, and repeated source lists.
- Historical/future dates are explicit snapshots: current mail is not evidence of what was known then. State that distinction; do not pretend to reconstruct an earlier inbox.
- A failed Calendar read must not produce 'nothing scheduled'; a failed mail read must not become 'no replies needed'. Give the useful partial result and name the unavailable source.
- Save optional plain-language preferences (priorities, exclusions, what the user finds useful) rather than adding a scoring schema. Preferences narrow research and relevance; they do not authorize mutation or unlimited reads.

## Calendar Triage and follow-through

Job: identify genuine scheduling problems in the selected day/week, explain their consequences, and suggest a small number of concrete options.

- Use expanded occurrences, explicit date/time-zone scope, actual start/end instants, and HEY's visible calendars. Do not infer access to other people's calendars or claim universal availability.
- Distinguish overlapping timed commitments from all-day notes, tentative alternatives, declined/cancelled events, mirrored external copies, and deliberately concurrent blocks. Equal end/start times are back-to-back, not overlap. An overnight event or DST change is not automatically malformed.
- Only flag missing information when it matters to attendance. A missing join link on an in-person appointment, absent attendees on solo focus time, or a blank notes field is not automatically a defect.
- Working hours, travel buffers, breaks, and overload are user-specific. Use explicit preferences or label the assumption; do not invent office hours, geocode locations, or turn every gap into an optimization task.
- Link to the exact event occurrence. Explain the issue and offer an option; no destructive batch-cleanup button or automatic rescheduling.
- Later explicit requests in the same chat may use existing generic HEY tools and approval UI to edit/create events, invite people, adjust reminders, or create a todo when supported. Re-read current objects, resolve the exact target and time zone, surface recurring-series effects, preserve fields, and verify the result. A read-only external event must lead to its owner/HEY flow, not an unlinked duplicate presented as a fix.
- Read-only during the initial review; the user's later request plus the existing approval boundary authorizes any subsequent mutation. Instruction text is not a new security sandbox or permission grant.

## User-authored Helpers

- Manage locally in Settings: create, edit, duplicate, enable/disable, delete with confirmation. Name and instructions are required; context is Any, Mail, or Calendar; model is General or Quick.
- Any can run without attachments or with the explicitly selected context. Mail requires eligible selected conversations; Calendar requires a selected event or a date/window. Show only eligible contextual actions; Ctrl+K remains the main discovery path.
- Keep instructions as plain text. No script upload, executable skill imports, marketplace installation, cron syntax, or automatic expansion of local file access. These run with the user's normal Pi tools and the app's normal HEY approval policy; do not claim arbitrary instructions are sandboxed.
- Persist authoring locally, independently of Pi's global settings. Saving is not running. Resetting interface settings must not erase authored Helpers. Invalid input fails visibly without discarding the editor text; duplicate names are rejected without overwriting another Helper.
- Main process validates IDs, text lengths, context/model enums, unique names, and limits. New-session requests send an ID, not arbitrary skill paths or injected overrides.
- Capture name and instruction text when a session starts. Edits, disabling, or deleting the definition affect future launches only; existing sessions resume the captured version. Deleting a Helper does not delete its chats or Pi transcript.
- Add the two new built-ins once without re-enabling previously disabled Helpers. Preserve existing four Helpers and their behavior.

## Verification and handoff

- Unit coverage: catalog migration, enabled state, custom validation/CRUD persistence, reset preservation, context eligibility, date/day/week/year boundaries, session instruction snapshots, deleted-definition resumption, and packaged skill parity.
- Prompt fixtures: empty/partial sources; DST/overnight/recurring events; back-to-back and true collisions; all-day/tentative/mirrored events; stale mail; injected instructions in source material; native links; bounded research; explicit follow-up mutations only.
- Browser proof at desktop and compact widths: discovery, launch context, authoring validation/save/cancel/delete, disabled state, focus and Escape, transcript identity, and no overflow. Use synthetic data for mutation paths.
- Run tests, typecheck, build, and local packaging. Report precisely which behaviors were exercised with fixtures versus live Pi/HEY; do not send, edit, or delete real user mail/events as a test.
- Hand off exact user test steps. Update the product and AI plans after verification, not before.

## Still deferred

Write Like Me, Workflow Organizer/native Workflows, background runs/auto-drafts, third-party skill import, and cross-machine Helper sync. One-way external agent handoffs were implemented separately on 2026-09-05; see [scope and testing](./agent-handoff.md). Custom adapters and remote/URL integrations remain future work; results import and synchronization are outside that approved scope. No release or push is implied by this feature request.

## How to test

Use the updated desktop build with your normal HEY login and working Pi model. Each launch is a model request and may incur your provider's normal cost. Merely opening Settings, changing preferences, or navigating Calendar does not.

### Daily Brief

1. From mail, press `Ctrl+K`, search **Daily Brief**, and run it. Expect a named chat with today's date and local time zone attached, a short launch request, visible research steps, and a concise answer with native source links.
2. In Calendar, select a different day and choose **Helpers → Daily Brief**. It should use that selected day, not silently return to today. On a week view it uses the selected anchor day; an open event supplies its occurrence day. The request makes the date explicit.
3. Try a day with both appointments and a genuine unanswered mail request. Confirm the latest reply determines whether the request is still open. Newsletters, already-completed requests, and waiting on others should not become your urgent to-dos.
4. Open **Settings → Helpers → Daily Brief**, add a preference such as “Prioritize client replies; keep the brief under 150 words,” save, and launch a new run. Existing chats keep their earlier preferences.

An empty Calendar is different from a failed read. On historical/future dates the answer must distinguish the chosen schedule from mail visible now. Coverage is bounded, not an exhaustive audit of your account.

### Calendar Triage and actions

1. Open a day or week with known appointments. Choose **Helpers → Calendar Triage**. Check the displayed range and time zone in the new chat before judging the results. Outside Calendar it defaults to this week; Year view does not authorize a year-long scan.
2. Useful test cases are two genuinely overlapping timed events, adjacent end/start times, a Maybe alternative, an all-day note, and two mirrored copies of one meeting. Only a genuine consequential collision should be reported as a conflict. Prefer existing examples; no test fixture needs to be created in your real account.
3. In **Settings → Helpers → Calendar Triage**, optionally describe working hours, buffer preferences, or exclusions. Leave blank if you do not want those assumptions made.
4. Ask a read-only follow-up first: “What are two other times for that meeting? Don't change anything.” Suggestions must acknowledge that your Calendar alone cannot establish other people's availability.
5. To exercise actual changes, deliberately choose an event you are willing to modify, then request one exact change. Review the normal approval, including the affected event, time zone, attendees, and recurring-series scope. Cancel to test safely. If you approve a real change, confirm it in the native event view and HEY before continuing.

This is ordinary agent-led Calendar follow-through, not new Calendar permissions. Read-only subscribed events, invitation RSVP, calendar sharing, or other unsupported CLI operations must remain unsupported, with a useful explanation or HEY handoff. Deletion is never an automatic conflict-resolution strategy.

### Personal Helpers

1. Open **Settings → Helpers → New Helper**. Try **Project check-in** with instructions: “Read the attached conversations. Return three short bullets: decisions, unanswered questions, and my next step. Link to the source. Do not change or send anything.” Select **Selected mail** and **General**, then Save.
2. Open a conversation or explicitly select a few in a mailbox. Press `Ctrl+K`, search the Helper's name, and run it. Confirm the right sources are attached. A Mail Helper should not appear with no eligible mail context.
3. Try a second Helper with **Any · context optional** and **Quick**, such as “Ask me which task to focus on, then help break it into three steps.” It can start without attached objects. Quick inherits General unless you configure a separate model in Settings.
4. Try **Calendar event or window** for your own scheduling instructions. From Calendar it receives the displayed window or selected event; elsewhere it defaults to the current week.
5. Edit, duplicate, disable, and delete a test Helper. Names must be unique. Duplicate should focus the new name; Escape/Cancel with unsaved work should offer to keep editing or discard. Deletion must confirm and keep existing chats. Reopen an old chat after changing/deleting its definition: its original name and instructions should remain.
6. Restart the app. Saved Helpers and preferences should remain. Reset settings should preserve authored content. They do not automatically appear on another machine.

Instructions are saved locally and sent to the chosen model when run. This is a focused way to use your normal Pi setup—not a sandbox, arbitrary skill installer, or new grant of permission.

## Verification evidence

- **Automated:** 54 test files / 286 tests, TypeScript, and production build. New coverage includes versioned migration, CRUD validation and disk round-trips, reset preservation, context bounds, time zones/DST/year boundaries, captured instructions, deleted-definition resumption, model forwarding, and bundled skill parity. Both new skill manifests pass the skill validator.
- **Browser preview, synthetic data:** desktop 1440×900 and compact 900×700; Calendar menu, `Ctrl+K`, day/week navigation and captured range, mail eligibility, authoring validation/save/duplicate/discard/delete, and keyboard focus recovery. Compact Settings dismisses the floating chat overlay before authoring. These are UI fixtures, not HEY API proof.
- **Native Electron, isolated settings:** real preload/IPC, six built-ins, validation failures without data loss, reset preservation, instruction snapshots after edits/deletion and cold reopening, and rejection of future launches for a deleted definition. The packaged renderer's `Ctrl+K` path successfully creates an Any-context Helper with no attachments. HEY/Pi executables are deliberately replaced with a failing stub for these checks; the subsequent provider error is expected. This does not exercise live Calendar mutations or claim provider readiness.
- **Local Linux package:** x86-64 AppImage and installer bundle, all six skill resources, installer checksums, and isolated packaged startup. The bundle includes this test guide. No version bump, GitHub upload, or CI trigger.
- **Live Pi, synthetic source text only:** evaluated stale/closed mail, a malicious newsletter instruction, real versus mirrored/tentative/adjacent Calendar events, partial source failure, and personal instructions. No tools, extensions, local context, or saved sessions were enabled. GPT-5.5 handled the final representative cases; an earlier faster-model run misclassified adjacency and over-reported nonissues. Prompts were tightened, but judgment remains model-dependent—not an exhaustive behavioral guarantee. Research Helpers use General; personal Helpers can deliberately choose Quick.
- **Not performed:** sending mail, changing/deleting real Calendar events, credential failure injection against the user's account, public release, or cross-machine sync. Exercise approved Calendar writes deliberately during user testing, not as an automatic smoke test.

Optional prompt calibration (uses the selected provider and its normal cost):

```sh
HEY_HELPER_EVAL_MODEL=openai/gpt-5.5 node scripts/evaluate-helpers.mjs
```

The script prints model answers for review, not a claim that every judgment is machine-verified. It is intentionally separate from `npm test` and packaging.

## Supporting references

The tentative-calendar distinction follows [HEY's Maybe Calendar explanation](https://help.hey.com/article/841-why-do-i-have-a-maybe-calendar). Date-range handling respects [HEY's configurable week start](https://help.hey.com/article/825-change-the-start-day-for-your-week). The installed HEY CLI 1.4.0 help confirms expanded `event day`/`event week` reads; the focused skills use these instead of treating an event-series list as an expanded schedule.

## UI conventions

These local patterns describe the built Settings and Calendar extension. Sources: [HelperSettings.tsx](../src/renderer/src/components/HelperSettings.tsx), [HelperMenu.tsx](../src/renderer/src/components/HelperMenu.tsx), and the Helper rules in [styles.css](../src/renderer/src/styles.css).

- Keep Helpers in Settings' separated name-and-purpose rows, with an enable switch at the trailing edge. Editable rows have a disclosure chevron; the row being edited uses the existing accent.
- Open one inline editor below the list. Keep visible field labels, a resizable instruction area, and adjacent Context/Model choices. Save is the primary action; Run and Cancel are secondary, with Duplicate/Delete quieter. Run remains separate from saving.
- Use the existing theme's surfaces, fields, borders, text, accent, and danger colors, inherited font, and body/meta type roles. Reuse `MorphingIcon` and the existing semantic interface sounds for open, close, hover, select, and deselect.
- Show validation errors and delete/discard confirmation inside the editor, preserving entered text after failures. Confirmation focuses **Keep editing**; returning to the form focuses its first field. Use the existing danger color for destructive actions and errors.
- Focus Name or Preferences when editing starts; duplicating focuses and selects the new name. Closing restores the initiating button, falling back to **New Helper** if it was removed. Escape dismisses confirmation first, then requests discard for unsaved work; `Ctrl/Cmd+Enter` saves when no confirmation is open.
- Calendar exposes eligible Helpers through one toolbar disclosure. Anchor its menu to the trigger, allow long names to wrap, and bound its height with scrolling. Keep the active-calendar scope and `Ctrl+K` discovery hint beneath the actions.
- Opening the menu focuses its first action. Up/Down, `j`/`k`, and Home/End move focus; Escape closes it and restores the trigger. Moving focus outside the menu or clicking outside dismisses it. Preserve the visible focus outline and the shared hover/focus item treatment.
- At compact desktop widths, keep fields within the available Settings column, allow action groups to wrap, and use the surrounding Settings scroll area. Preserve the Calendar toolbar's compact disclosure and continue launched results in the existing chat surface.
