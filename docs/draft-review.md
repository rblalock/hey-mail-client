# Draft review

## Overview

The **Review suggestion** dialog lets someone read, compare, and edit AI wording before replacing an email body. It serves inline writing assistance and the AI rail’s **Use in reply** action. It uses the app's existing theme and typography.

Implementation: [DraftReviewDialog](../src/renderer/src/components/DraftReviewDialog.tsx), [DraftDiffPreview](../src/renderer/src/components/DraftDiffPreview.tsx), and their rules in [styles.css](../src/renderer/src/styles.css).

## Colors

The dialog inherits the app’s surface, ink, border, field, and accent tokens. Changes use the existing red and green tokens alongside struck-out removals and underlined additions, so color is not the only distinction. The comparison follows light/dark theme changes.

## Typography

Both views use the app font at 16px with a 1.75 line height. Email text wraps naturally. The comparison hides file headers, line numbers, code gutters, and metadata; labels read **Your draft / Removed wording** and **Suggested revision / Added wording**.

## Layout

The centered dialog is capped at 1120 × 780px, with viewport clearance. Its header, Draft/Changes controls, and explicit actions surround a scrolling reading area. The Draft editor centers its text within approximately 74 characters of reading width when space allows.

Above 800px, Changes shows the original and revision side by side. At 800px and below it becomes a unified comparison; the dialog nearly fills the window, padding narrows, and the toolbar and footer stack.

## Components

- **Draft** is a controlled native textarea with spellcheck and a visible keyboard focus outline. It preserves plain text and Markdown. Edits survive switching views and feed the next comparison.
- **Changes** is a read-only, word-level Pierre comparison. An existing nonblank body opens here; an empty body opens in Draft. The original remains immutable throughout review.
- **Use this draft** replaces only the message body. Recipients, subject, and attachments are unaffected. Nothing is sent; delivery remains a separate composer action.
- **Discard suggestion**, the close control, and Escape leave the composer unchanged and return focus to it. Applying also returns focus to the composer.
- Inline writing assistance offers **Restore** after application, retaining the original body and selection until a later material edit invalidates that restore point. The rail handoff does not provide this Restore action; do not promise a shared undo history.

### Keyboard and focus

The native modal keeps the underlying composer inert and traps Tab/Shift+Tab within the review. Arrow keys and Home/End move between Draft and Changes. Ctrl+Enter applies an eligible suggestion and is consumed by the dialog so it cannot send mail underneath. Repeated or composing shortcut events do not apply; Escape during text composition does not discard.

### Guards and fallback

A changed composer body or originating context makes the suggestion stale and displays an explanation. Application checks the current editor value again before replacement. Inline context includes compose mode, subject, recipients, and thread context; the rail review binds to the originating posting ID.

Blank or unchanged proposals cannot be applied, and application is disabled while the composer is unavailable. Comparison code loads on demand with a visible preparing message. A renderer failure or a combined original/proposal length over 100,000 characters explains the limitation and leaves Draft available for reading and editing.

## Do's and Don'ts

- Do keep the review before application and preserve user edits across views.
- Do retain native editing, readable wrapping, app fonts, and non-color change marks.
- Don't turn the email comparison into a code editor or imply that reviewing/applying sends mail.
- Don't describe partial acceptance or versioned draft history as implemented features.

## Validation and user testing

Unit tests and the synthetic keyboard/review smoke cover comparison loading, retained edits, focus containment, Escape/discard, Ctrl+Enter application, inline Restore, stale-draft and blank-proposal guards, empty-draft defaults, and IME/repeat protection. Its preview bridge records zero mail sends.

These checks use synthetic data; real HEY writes and real model calls were not tested. No human usability session is claimed. A concise user session should ask someone to compare and revise wording, switch views, discard once, then apply once, and explain what happened to the original body and whether anything was sent. Repeat in a compact window to check comparison comprehension.

The production Electron/profile smoke also loads the real file:// renderer and preload with synthetic generation, checks lazy Pierre rendering, and confirms explicit application. A browser check separately exercised AI-rail handoff discard and edited application with zero mail sends.

To try it: open Compose or Reply, write a few sentences, and choose **Write → Improve** (or give an instruction). Review Changes, edit in Draft, then choose Use this draft. Try Discard once to confirm the original stays put. For Reply Coach, use its **Use in reply** action to open the same review.
