# Keyboard shortcuts and hover hints

Audit and implementation date: 2026-09-05. Status: implemented; original findings retained below as historical evidence.

## Delivered

The three priorities are now implemented using the existing visual system and Impeccable hardening guidance:

- Composer-local shortcut dispatch, shared click/keyboard eligibility checks, synchronous submission guards, nested AI instruction ownership, IME/repeat protection, modal Tab containment and opener focus restoration. Saved-draft Send first saves the visible edits; save failure prevents sending.
- A shared strict shortcut grammar at UI/storage boundaries, one alias per line, contextual conflict and chord-prefix checks, explicit Save/Reset/Disable, inline errors, and serialized per-command updates. Bad edits and failed writes leave the working binding intact. `g ,` is one chord, not two comma-separated aliases. `mod` means Ctrl or Meta; `cmd`/`command` mean Meta. Use `plus` for the plus key. At most two steps and five aliases are supported; composer keys require Ctrl/Meta and one step.
- Resolved hover/focus hints across mail, readers, bulk controls, session controls and composers; local hints for Calendar and Helper forms. Tooltips associate with their triggers, wrap/flip/clamp to the viewport, stay hoverable, dismiss with Escape, and do not advertise disabled actions as available. Calendar's local keys remain separate from the configurable mail/session registry.

Default mail-composer bindings (only where the underlying action is supported):

| Action | Shortcut |
|---|---|
| AI Write | Ctrl+K |
| Send | Ctrl+Enter |
| Save draft | Ctrl+S |
| Focus Cc / Bcc | Ctrl+Shift+C / Ctrl+Shift+B |
| Attach files | Ctrl+Shift+A |

Navigation follow-up: J/K and Up/Down accept held-key repeats; destructive actions, submission, X toggles, and IME input remain one-shot/protected. Shift+J/K and Shift+Up/Down extend a selection through visible list order and shrink it when reversing, preserving pre-existing X selections. Ctrl+Shift+L opens the existing agent rail and focuses its composer without adding context or starting a new session. These are configurable commands. Blocking mail dialogs retain their local focus containment.

Inside AI Write, Ctrl+Enter applies the instruction instead of sending mail. Calendar and Helper forms retain their own local primary-action shortcuts. Escape dismisses the tooltip or innermost editor layer first. Desktop/window-manager bindings can intercept keys before the app; the app cannot detect every system-wide conflict.

### Verification

Run `npm run typecheck`, `npm test`, and `node scripts/check-keyboard.mjs`. The keyboard smoke starts a disposable Vite preview and hidden Electron renderer with synthetic HEY/Pi boundaries. It uses DOM keyboard dispatch and timer-backed animation frames; it does not claim to test OS key delivery. Visible-browser testing separately covered native key dispatch and Tab wrapping, AI instruction submission with zero mail sends, Cc/Bcc focus, repeat/IME/extra modifiers, draft save/send ordering, save failure, invalid/conflicting custom edits, failed settings writes, reset/disable, and updated focus hints. Light/dark and compact/wide Settings were visually inspected.

Unit coverage includes grammar, modifier equivalence, reserved keys, chord ambiguity, persistent disable/reset, concurrent per-command saves, and tooltip edge placement. This is not a complete accessibility certification or an exhaustive live test of every Calendar/Helper mutation. No real email, Calendar record, or model request was used for verification.

## Original audit verdict

The existing tooltip design is suitable. Coverage and keyboard behavior are not yet consistent enough to treat it as a dependable shortcut-discovery system. Reuse the current compact tooltip and shortcut settings; do not introduce a second visual system or an elaborate command framework.

Seven actionable findings: two P1, five P2. No real mail, calendar records, settings, or model requests were changed by this audit. Existing uncommitted Imbox work is separate and preserved.

Scope: new/forward/reply composers, inline AI writing, saved drafts, Reply Together, Calendar navigation/event detail/event editor/search, habit/time forms, Helper editing, recipient picking, mail organization, sidebar, reader controls, and agent-session controls. Source inspection covers these surfaces; browser proof is specifically for the new-message composer and shared tooltip layer. This is not a complete application-wide accessibility certification.

## Evidence and assessment

| Dimension | Assessment within this audit |
|---|---|
| Accessibility | 2/4: focus-triggered tooltips exist, but composer focus containment and tooltip associations need work. |
| Performance | 3/4: shared delegated listeners and one delayed tooltip; no new per-control listeners needed. Source assessment, not a benchmark. |
| Responsive behavior | 2/4: tooltip placement has no collision handling. Composer inspected at 1440×1000 and 900×700; the latter's attachment tooltip fits with only 1.5 px below it. Other edge placements remain unverified. |
| Theming | 3/4: shared tooltip uses semantic theme tokens; dark-theme rendering verified here. This audit did not measure contrast across every Omarchy theme. |
| Implementation integrity | 1/4: action handlers, enabled states, and displayed bindings can disagree. |
| Total | 11/20, scoped assessment: significant work needed. Not a whole-app score. |

The Impeccable detector reported no deterministic findings for TooltipLayer, MailComposer, and ComposerWritingAssistant. That did not catch the runtime issues below.

## P1: AI instruction shortcut can invoke email Send

Location: `src/renderer/src/components/ComposerWritingAssistant.tsx` (popover keyboard handler), `MailComposer.tsx:75`, `ThreadPanel.tsx:380`.

The writing popover consumes Escape and Tab, but not Ctrl+Enter. That key bubbles to the outer composer, which calls Send. In a synthetic preview, with `window.heyAgent.mail.send` replaced by an intercepting function, Ctrl+Enter in the AI instruction input invoked the mail-send API once. No real send occurred. The request was an empty compose request, despite the visible Send button being disabled: MailComposer.submit only guards against an in-flight send, not the button's validity requirements. Backend rejection of invalid data does not solve accidental sending of a valid draft from the wrong context.

Impact: a user trying to submit an AI instruction could instead send the email. Both scope isolation and shared enabled-state checks must precede wider shortcut promotion.

Requirements:

- The active writing popover owns its keyboard events. Its submission shortcut must never reach mail Send.
- Keyboard and click invoke the same action with the same validation and busy guards.
- Handle IME composition, repeated keydown, and extra modifiers deliberately.
- Test nested AI help, recipient suggestions, and confirmation screens before wiring new bindings.

Recommended follow-up: Impeccable harden.

## P1: new-message modal does not contain keyboard focus

Location: `MailComposer.tsx:75`; contrast with explicit traps in `CalendarEventComposer.tsx` and `MailOrganizer.tsx`.

Browser reproduction: with Send disabled, focus Write (the final enabled composer control) and press Tab. Focus leaves the modal for the document body. The composer declares aria-modal but has no equivalent Tab containment or background inertness here.

Impact: keyboard users can leave their writing context, and the next global shortcut may operate elsewhere. Hover hints alone cannot make this journey dependable.

Requirements: contain Tab/Shift+Tab in the active modal, restore focus to the opener, and preserve the existing nested writing-popover focus behavior. Inline reply is not a modal and should not get an inappropriate global trap.

Recommended follow-up: Impeccable harden.

## P2: working shortcuts are undiscoverable on their controls

| Surface/action | Actual current binding | Current gap |
|---|---|---|
| New/forward/reply/saved draft: Write | Ctrl+K while the body textarea is focused | No tooltip on the shared Write trigger; focus scope is invisible. |
| New message and inline reply: Send | Ctrl+Enter | Tooltip already exists and works, including disabled Send in the tested preview. Retain it; correct the scope/guard issue above. |
| Reply Together: Send | Ctrl+Enter | Footer text only; Send lacks tooltip metadata. |
| Calendar event create/edit/review | Ctrl+Enter | Footer text only; action has no shortcut tooltip. Label must reflect Create, Review invitations, or Save. |
| Calendar event close/back from review | Escape | Close/back controls do not explain the state-dependent action. |
| Calendar event detail: edit/delete/back | E / Delete or Backspace / Escape | Footer hints exist; buttons have no shortcut tooltips. Delete opens confirmation, not immediate deletion. |
| Calendar main controls | N new; T today; H/L or arrows previous/next; D/W/Y views; B/G/R sections; / search; Ctrl+F filter | Controls largely lack tooltip metadata. Bindings apply only in the relevant Calendar focus/state. |
| Helper editor: Save/Cancel | Ctrl+Enter / Escape | No shortcut tooltip; Escape may ask to discard dirty changes. |
| Habit/time/category forms: Close | Escape | Close/Cancel labels lack hover hints. Other form submissions are not uniformly Ctrl+Enter-enabled. |
| Calendar search | Enter submits from its input; Escape closes | Search/close affordances do not expose this context. |

Requirements: show concise action text and the valid binding on hover and keyboard focus. Do not put an unrelated global shortcut on an action whose target is different (for example, a particular day's Add event button must not advertise N if N creates on the current anchor instead).

Recommended follow-up: Impeccable clarify.

## Follow-up: custom shortcut editing is not hardened

Subsequent source inspection and disposable settings/matcher checks confirmed these additional gaps before implementation:

- Invalid key names save without field errors; unknown modifiers can be ignored (`cmd+k` can act as plain K).
- Comma-separated aliases conflict with the default `g ,` binding; focusing and blurring that field can change its meaning.
- Spaces around `+` are interpreted as chord boundaries, and chords longer than two steps are not fully matched.
- Conflicting commands are accepted and the first available match wins, without a warning.
- Whole-map saves from stale editor snapshots can overwrite another recent edit. Failed saves have no inline error handling.
- Clearing a field restores the preset rather than disabling the action, without explaining that distinction.

Use one strict parser at the UI and IPC boundary, explicit reset/disable behavior, context-aware conflict reporting, and per-command updates. Preserve the last valid binding on failure. Add tests for ordinary typing, punctuation, aliases, chords, invalid input, conflicts, and save failures before promoting custom bindings as dependable.

## P2: missing dedicated composer bindings

Location: MailComposer, ThreadPanel, DraftsView, and the shortcut catalog.

Cc/Bcc disclosure, Save Draft, and Attach Files do not have dedicated composer bindings. Saved-draft Send/Save also lack parity with the new/reply composer. Native Tab/Enter reachability is not the same as a dedicated shortcut.

Proposed small composer set, subject to conflict checks:

- Ctrl+K: Write; initially advertise its body-focus scope, or intentionally broaden it within the active composer without stealing the global palette in other contexts.
- Ctrl+Shift+C / Ctrl+Shift+B: reveal and focus Cc / Bcc, respectively; repeated use focuses the existing field without clearing recipients.
- Ctrl+S: Save Draft where supported.
- Ctrl+Shift+A: Attach Files where supported; no global attachment action and no binding on forward if attachments are not supported there.
- Ctrl+Enter: Send, or the current form's primary save/review action, never both.
- Escape: dismiss the innermost layer, then close/collapse the composer according to existing draft-preservation behavior.

Do not assign bindings to every minor option. Keep ordinary input editing, selection, Tab, and Enter intact. New bindings must be registered, explained in Settings, and checked against user customizations and desktop-reserved combinations before shipping.

Recommended follow-up: Impeccable harden, then clarify.

## P2: tooltips can disagree with configured shortcuts

Location: `shortcuts.ts`, `ThreadPanel.tsx:295`, `AgentPane.tsx:243`, `ImboxView.tsx:162`, `ReadTogetherView.tsx:94`.

The sidebar already derives labels from resolved shortcut definitions. Reader actions and session tab controls instead hardcode R/L/A/J/K/F/Z/#/Ctrl+T/Ctrl+W; Imbox's Reply Later stack hardcodes 4. These can become inaccurate under custom bindings, and some show a secondary rather than preferred binding (for example L versus Superhuman's H).

Requirements: reuse resolved definitions for global actions. Keep genuinely local bindings distinguishable and consistent between their handler and tooltip. Do not claim a configurable binding for a local handler that still listens to a fixed key. Row aria-keyshortcuts="x" must also track the actual configured selection binding.

Recommended follow-up: Impeccable clarify.

## P2: shared tooltip accessibility and edge placement are incomplete

Location: `TooltipLayer.tsx`, `styles.css:3073`.

The layer supports pointer hover and focus, but has no tooltip ID/trigger aria-describedby association, no Escape-only dismissal, and no viewport-aware flip/clamp. It also reads attributes only when showing, so changing a focused control's action needs careful treatment. CSS uses nowrap; long labels with shortcuts need bounded wrapping rather than clipping. Pointer-events:none means the tooltip itself cannot be hovered to keep longer content visible.

Requirements: preserve the existing visual design; add stable accessible association, viewport-safe placement, and dismissal that does not inadvertently close the underlying form. Verify hover persistence if applying WCAG hover-content requirements. Preserve focus hints for keyboard use and do not show an inactive shortcut as available on a disabled action; an explanation can accompany it.

Recommended follow-up: Impeccable harden and adapt.

## P2: no regression contract for shortcut-to-control parity

Location: shortcut unit tests and component-level checks.

The shortcut matcher is tested, but that alone cannot prove that a displayed shortcut activates the same action as its button, with the same payload, enabled state, and focus scope.

Required verification matrix:

- New mail, forward, reply, saved draft, Reply Together, Calendar event/review, Helper, habit/time forms.
- Hover and keyboard-focus tooltip text, including chosen custom bindings.
- Disabled actions, missing recipients, pending send/save, nested AI help, recipient suggestions, deletion confirmations, and IME composition.
- Cc/Bcc shortcut focuses the correct existing/new field and preserves large recipient lists.
- Escape dismisses one layer; Tab remains inside modal forms; inline forms remain traversable.
- Compact desktop and wide desktop, theme-derived colors, long labels and viewport edges.
- Mock every send/save/delete/model boundary; do not use real user data to prove hotkey dispatch.

Recommended follow-up: Impeccable harden; final Impeccable polish pass after functional fixes.

## Implementation order

1. Fix nested event ownership and shared action guards; prove no accidental sends.
2. Fix composer focus containment and tooltip accessibility/positioning.
3. Wire existing actions to truthful hover/focus hints and resolved settings.
4. Add the small missing composer binding set and safe saved-draft parity.
5. Sweep Calendar, Helpers, organization, reader, bulk, and session controls; perform the regression matrix and one bounded visual polish pass.

Retain the good foundation: one shared tooltip layer, semantic theme colors, resolved shortcut settings already used by Sidebar, native buttons and recipient combobox behavior, and explicit Calendar invitation/deletion review. Do not replace the Pi approach or introduce AI for deterministic keyboard dispatch.
