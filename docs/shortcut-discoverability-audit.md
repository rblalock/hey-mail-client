# Keyboard shortcuts and hover hints

Current shortcut behavior and contributor checks. The resolved audit findings have been removed.

## Behavior

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
