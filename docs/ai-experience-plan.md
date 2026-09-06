# AI surfaces

The app uses Pi for three kinds of work. This describes current behavior; future work lives in the [roadmap](plan.md#deferred-not-dropped).

## Chat rail

- Persistent conversations with explicit mail, Calendar, file, or selected-text attachments.
- Pi chooses tools and resolves context. The app validates execution, presents approvals, and refreshes affected native views.
- Opening another email does not silently replace an existing chat's context.
- General model settings apply to new chats, not an already-running session.

## Contextual commands and Helpers

- `Ctrl+K` and relevant mail/Calendar controls launch work with stable object references.
- Bundled Helpers: Meeting Prep, Follow-up Finder, Thread Recap, Reply Coach, Daily Brief, and Calendar Triage.
- Helpers use focused Pi skills. Their catalog controls naming and eligibility, not intent parsing or a prescribed CLI sequence.
- Each invocation creates a normal visible chat with its own captured context and instructions.
- Research Helpers use General; Reply Coach uses Quick. Personal Helpers can choose either.
- Reply Coach returns a replacement email body, not a question to the app user that could be mistaken for outgoing mail.
- Saving preferences, opening menus, hovering, or navigating never runs a Helper.
- Personal Helper definitions are shared across linked profiles; their chats stay with the launching account.

Setup, scope, and test cases: [Helpers](helpers-plan.md).

## Inline writing

- Write works on an empty body, a selection, or the full draft.
- A task-scoped Pi process uses the Quick profile, with tools and extensions disabled. It cannot send mail or change account data.
- Quick can inherit General. Model selection does not rewrite Pi's own configuration.
- Stop preserves the current draft. Failed generation never clears it.
- [Review suggestion](draft-review.md) lets the user compare and edit before applying. Application changes only the body; sending is separate.
- Inline writing has a bounded Restore action. Rail-to-reply review does not promise the same undo history.
- Changed body, recipients, subject, or source context can invalidate a proposal; re-check before replacement.

## Previews and handoffs

- Native object links provide hover/focus previews and click-through to the normal center surface.
- Missing objects stay missing. An explicit read-only recovery request can ask Pi to find possible matches; the app does not silently substitute an ID.
- [Continue in another agent](agent-handoff.md) prepares a reviewed one-way prompt for copy or a supported local CLI.
- Continue in terminal resumes the original Pi session. Handoff to Pi starts a new session.
- Local paths in a copied prompt do not give a web agent access to files or HEY credentials.

## Contributor rules

Keep generation cancellable, errors local, and user text editable. Temporary dialogs own their keys and restore focus. Model catalogs and command menus should not require paid inference. Use the existing theme and controls rather than a separate AI dashboard.

Tool authority, stable IDs, approvals, and ambiguous-write recovery are defined in [agent boundaries](agentic-hey-requirements.md). Check behavior with [evaluations](agentic-hey-evaluation.md), not exact canned model wording.
