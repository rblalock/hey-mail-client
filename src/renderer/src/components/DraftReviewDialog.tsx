import { Check, X } from "lucide-react";
import { Component, Suspense, lazy, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { draftReviewIssue, type DraftSuggestion } from "../draft-review";
import { isShortcutEvent, matchesBindingStep } from "../../../shared/shortcut-binding";
import { trapFocus } from "../composer-keyboard";

// Operate: review email wording before replacement. Inherits the app's fonts,
// opaque surfaces and restrained theme; original stays immutable. A roomy native
// dialog protects focus, with Draft/Changes above the text and explicit apply below.
const DraftDiffPreview = lazy(async () => {
  const [{ preloadHighlighter }, component] = await Promise.all([import("@pierre/diffs"), import("./DraftDiffPreview")]);
  // Mount only after the plain-text renderer is ready; otherwise the library's
  // initial hydration can leave an empty comparison with no loading indicator.
  await preloadHighlighter({ langs: ["text"], themes: ["pierre-light", "pierre-dark"] });
  return component;
});
class ComparisonBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="draft-review-message" role="status">The comparison couldn’t load. Switch to Draft to read and edit the suggestion.</p> : this.props.children; }
}

type Props = {
  suggestion: DraftSuggestion;
  currentValue: string;
  context: string;
  subject?: string;
  disabled?: boolean;
  onApply: (text: string) => string | void;
  onDiscard: () => void;
};

export default function DraftReviewDialog({ suggestion, currentValue, context, subject, disabled, onApply, onDiscard }: Props) {
  const [proposed, setProposed] = useState(suggestion.proposed);
  const [view, setView] = useState<"draft" | "changes">(suggestion.original.trim() ? "changes" : "draft");
  const [applyError, setApplyError] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const applied = useRef(false);
  const id = useId();
  const issue = draftReviewIssue(suggestion, currentValue, context);
  const unchanged = proposed === suggestion.original;
  const canApply = !disabled && !issue && !unchanged && Boolean(proposed.trim());
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => { node.close(); };
  }, []);
  const apply = () => {
    if (!canApply || applied.current) return;
    const error = onApply(proposed);
    if (error) { setApplyError(error); return; }
    applied.current = true;
  };
  return <dialog ref={dialog} className="draft-review-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onCancel={(event) => { event.preventDefault(); onDiscard(); }} onKeyDownCapture={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) onDiscard(); return; }
    if (matchesBindingStep(event.nativeEvent, "mod+enter")) { event.preventDefault(); event.stopPropagation(); if (isShortcutEvent(event.nativeEvent)) apply(); }
  }} onKeyDown={(event) => { trapFocus(event, event.currentTarget); event.stopPropagation(); }}>
    <header className="draft-review-heading">
      <div><h2 id={`${id}-title`}>Review suggestion</h2><p title={subject}>{subject?.trim() || "New message"}</p></div>
      <button type="button" className="icon-button" aria-label="Discard suggestion" title="Discard suggestion (Esc)" onClick={onDiscard}><X size={18} /></button>
    </header>
    <div className="draft-review-toolbar">
      <div role="tablist" aria-label="Suggestion view" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "draft" : event.key === "End" ? "changes" : view === "draft" ? "changes" : "draft";
        setView(next); document.getElementById(`${id}-${next}`)?.focus();
      }}>
        {(["draft", "changes"] as const).map((tab) => <button type="button" role="tab" id={`${id}-${tab}`} key={tab} aria-selected={view === tab} aria-controls={`${id}-${tab}-panel`} tabIndex={view === tab ? 0 : -1} onClick={() => setView(tab)}>{tab === "draft" ? "Draft" : "Changes"}</button>)}
      </div>
      <p id={`${id}-help`}>{view === "draft" ? "Edit the suggestion before using it. Markdown is preserved." : "Compare the wording. Switch to Draft to make edits."}</p>
    </div>
    <div id={`${id}-draft-panel`} className="draft-review-content" role="tabpanel" aria-labelledby={`${id}-draft`} hidden={view !== "draft"}>
      <textarea aria-label="Suggested email draft" spellCheck value={proposed} onChange={(event) => setProposed(event.target.value)} />
    </div>
    <div id={`${id}-changes-panel`} className="draft-review-content" role="tabpanel" aria-labelledby={`${id}-changes`} hidden={view !== "changes"} tabIndex={0}>
      {view !== "changes" ? null : unchanged ? <p className="draft-review-message">No wording changes. Switch to Draft to edit the suggestion.</p>
        : suggestion.original.length + proposed.length > 100000 ? <p className="draft-review-message">This draft is too long for a word-by-word comparison. You can still review and edit it in Draft.</p>
        : <ComparisonBoundary><Suspense fallback={<p className="draft-review-message" role="status">Preparing comparison…</p>}><DraftDiffPreview original={suggestion.original} proposed={proposed} /></Suspense></ComparisonBoundary>}
    </div>
    {(issue || applyError) && <p className="draft-review-error" role="alert">{issue || applyError}</p>}
    <footer className="draft-review-footer"><span>Only the message body changes. Nothing is sent.</span><div>
      <button type="button" className="toolbar-button" onClick={onDiscard}>Discard suggestion</button>
      <button type="button" className="primary-button" title="Use this draft (Ctrl+Enter)" disabled={!canApply} onClick={apply}><Check size={16} />Use this draft</button>
    </div></footer>
  </dialog>;
}
