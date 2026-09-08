# Helpers

Run Helpers from `Ctrl+K`, eligible mail actions, or Calendar's Helpers menu. Each run opens a named chat with captured context, visible tool activity, and a Stop control. Nothing runs just from opening Settings or saving a Helper.

| Helper | Purpose |
| --- | --- |
| Meeting Prep | Prepare a brief from an attached event and related mail |
| Follow-up Finder | Find outstanding commitments in selected conversations |
| Thread Recap | Summarize decisions and open questions |
| Reply Coach | Draft a reply for review |
| Daily Brief | Review the selected day's schedule and relevant mail |
| Calendar Triage | Review a day/week for scheduling problems |

Research Helpers use the General model profile; Reply Coach uses Quick. Daily Brief defaults to today outside Calendar. Calendar Triage defaults to this week. Both capture the date range and time zone when launched; navigating elsewhere does not change that run.

Briefs inspect bounded mail samples, not the entire account. Calendar reviews start read-only. Later requests to change something use the normal tool approval policy. Calendar data is shared across linked accounts; mail research stays in the launching account.

## Create your own

Open **Settings → Helpers → New Helper**. Set a unique name, instructions, context (Any, Mail, or Calendar), and model profile (General or Quick).

For example, name a Mail Helper **Project check-in** and use:

> Read the attached conversations. Return three short bullets: decisions, unanswered questions, and my next step. Link to the source. Do not change or send anything.

Save, select a conversation, then find the Helper in `Ctrl+K`. Mail Helpers need selected mail; Calendar Helpers use the selected event or date range. Any-context Helpers can run without an attachment.

Definitions and preferences are local and shared across linked profiles; chats belong to the launching profile. Editing or deleting a Helper affects future launches, not existing chats. Resetting interface settings preserves authored Helpers. They do not sync between machines.

## Continue elsewhere

Open a chat's **Session options → Continue in another agent…**. Review/edit the prepared prompt, then copy it or choose a supported installed CLI. Current adapters cover Pi, Codex, Claude Code, Hermes, Cursor Agent, and Grok CLI. Copy works for other agents too.

The prompt can include mail quoted in the chat and paths to local history. Remove anything you do not want to share. External agents use their own tools, permissions, and model settings; their results do not sync back. **Continue in terminal** instead resumes the original Pi session.
