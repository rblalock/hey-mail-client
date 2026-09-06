---
target: Middle email list scanability
total_score: 26
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
timestamp: 2026-09-05T19-34-50Z
slug: src-renderer-src-components-imboxview-tsx
---
# Email-list critique

Method: dual-agent (A: list_design_review; B: list_evidence_review). Source, supplied screenshots, and independent browser sessions inspected. No list implementation changes.

## Design specificity and overall impression

Our Imbox combines HEY's subject-first two-line structure with small desktop typography, not Superhuman's stable sender/subject scan columns. It is a coherent HEY/Omarchy app with unresolved list hierarchy, not a replacement-identity problem. The main opportunity is HEY's organization with Superhuman's scan path. Increasing padding or reducing font size will not solve it.

## Strengths

- Preserve Bubbled Up, New For You, Previously Seen: useful task grouping.
- Keyboard j movement and x selection worked; actions remain progressively disclosed.
- Consistent date placement and row alignment, with no card border around every email.

## Priority issues

1. P1: Sender buried below long subject, mixed with snippet. Fix through impeccable layout: stable sender-first column, flexible subject/preview, reserved date. Source ImboxView.tsx:59-67; non-Imbox rows already have separate sender columns.
2. P1: Small information inside spacious rows: 68px rows, 34px avatars, 13px subjects, 11.5px sender/preview. Fix through impeccable typeset: readable principal scan line, promote sender, reduce secondary content before shrinking text.
3. P2: Previews consume all available width. Tested wide summary area exceeded 1300px; narrow panes keep the same structure and truncate. Fix through impeccable distill: bounded short previews, with preview surrendering space before sender/subject. Do not invent AI summaries or rewrite subjects.
4. P2: Bright avatars overpower sender names. Real screenshot is noisier than muted synthetic fixtures. Fix through impeccable quieter: test no avatars in compact list or smaller avatars; preserve unread/selection affordance and detail-view portraits.
5. P2: Section hierarchy weak: 10px headings and read subjects retain the same bright color as unread, with only weight changing. Fix through impeccable typeset: modestly stronger group labels and restrained read-row emphasis. Preserve contrast.

## Recommended direction

HEY organization, Superhuman scan path:

unread/selection | Sender | Subject — short preview | Date

One baseline on wide panes. Stable sender column, readable primary text, provisional 44-48px rows. At narrow widths stack sender and subject and hide preview before shrinking primary information. No new badges, participant stacks, permanent row actions, or density settings matrix. Alternative: retain two-line subject-first rows but strengthen sender hierarchy and sharply limit previews; less efficient for vertical sender scanning.

Test with long real-world subjects and a full mailbox. The reference Superhuman screenshot has only four messages, so apparent calm is partly lower content density.

## Heuristic assessment

26/40: focused improvement needed, not a whole-app quality score.

| Heuristic | Score /4 | Evidence or limit |
|---|---:|---|
| Status | 3 | Groups and selection visible; live writes untested |
| Familiarity | 3 | HEY language fits, sender weak |
| Control | 3 | Keyboard movement and selection exercised |
| Consistency | 3 | Imbox versus other mailboxes changes sender placement |
| Error prevention | 2 | Provisional; real bulk writes untested |
| Recognition | 2 | Sender buried in small secondary text |
| Efficiency | 3 | Accelerators work, visual scan inefficient |
| Minimalism | 2 | Too much repeated secondary text |
| Recovery | 3 | Source recovery controls inspected, not exercised |
| Help | 2 | Footer hints present but tiny; some affordances subtle |

## Cognitive load, emotional journey, personas

Moderate: 3/8 review checklist failures (single visual focus, hierarchy, digestible text groups). Many mailbox rows are not themselves a working-memory violation. Grouping and progressively disclosed actions are strengths.

- Power user: friction occurs before acting, while searching for a person amid long machine-generated subjects.
- Low vision/keyboard: small sender text encourages zoom, reducing visible conversations and increasing scrolling. Keyboard movement/selection tested; full screen-reader and 200% coverage untested.
- New user: group labels are helpful but too weak to make what needs attention immediate.

The emotional valley is triage: interpreting ribbons of message content instead of recognizing a work queue.

## Detector and browser findings

Component CLI scan returned zero findings, zero rules, no false positives. Hierarchy problems require visual/computed evidence; clean scan is not evidence of good design.

Native B browser overlay injection unavailable: document.title is read-only. No live detector server or user-visible overlay was created. Fallback was screenshots and computed geometry. Subject13px, sender/preview11.5px, section10px, time10.5px; unchanged two-line structure at tested widths. Dusk muted text contrast approximately5.62:1 on base but4.28:1 on selected background, below normal-text4.5:1 target. This is specific to tested preview palette, not a claim about every installed theme.

## Minor observations

Attachment indicators could be useful if supported by available data; do not add decoration speculatively. Preserve real subject text, including technical prefixes. Do not copy HEY's giant heading or Superhuman tabs to obtain the useful scan structure.

## Questions to decide before implementation

1. Sender-first single-line list (recommended), or keep two lines and strengthen hierarchy?
2. No avatars in compact rows, or smaller avatars for recognition?

After choosing direction, layout/typeset/distill/quieter should be followed by impeccable polish. No list changes approved or made in this review.
