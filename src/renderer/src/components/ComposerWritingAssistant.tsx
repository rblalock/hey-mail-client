import { RotateCcw, Sparkles, Square, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import type { ComposerWritingOperation, MailComposerMode } from "../../../shared/contracts";
import { appSound } from "../sound";
import { isShortcutEvent, matchesBindingStep } from "../../../shared/shortcut-binding";
import { useShortcutHints } from "../shortcut-context";
import { composeWritingSuggestion, draftReviewIssue, type DraftSuggestion } from "../draft-review";
import DraftReviewDialog from "./DraftReviewDialog";

export type ComposerWritingHandle = { open: () => void };

type ComposerWritingAssistantProps = {
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  mode: MailComposerMode;
  subject?: string;
  recipients?: string;
  threadContext?: string;
};

type Selection = { start: number; end: number; text: string };
type RestorePoint = { value: string; applied: string; start: number; end: number };

function selectionFrom(textarea: HTMLTextAreaElement | null, value: string): Selection {
  const start = textarea?.selectionStart ?? value.length;
  const end = textarea?.selectionEnd ?? start;
  return { start, end, text: start < end ? value.slice(start, end) : "" };
}

const ComposerWritingAssistant = forwardRef<ComposerWritingHandle, ComposerWritingAssistantProps>(function ComposerWritingAssistant({ value, onChange, textareaRef, mode, subject, recipients, threadContext, disabled = false }, ref) {
  const hint = useShortcutHints();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>(() => ({ start: value.length, end: value.length, text: "" }));
  const [instruction, setInstruction] = useState("");
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const [restore, setRestore] = useState<RestorePoint>();
  const [announcement, setAnnouncement] = useState("");
  const [suggestion, setSuggestion] = useState<DraftSuggestion>();
  const context = JSON.stringify([mode, subject, recipients, threadContext]);
  const instructionRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const activeRequestId = useRef<string | undefined>(undefined);

  const show = () => {
    if (disabled || activeRequestId.current || suggestion) return;
    setSelection(selectionFrom(textareaRef.current, value));
    setInstruction("");
    setError(undefined);
    setOpen(true);
    requestAnimationFrame(() => instructionRef.current?.focus());
  };
  useImperativeHandle(ref, () => ({ open: show }));

  useEffect(() => {
    if (restore && value !== restore.applied && value !== restore.value) setRestore(undefined);
  }, [restore, value]);

  useEffect(() => () => {
    if (activeRequestId.current) void window.heyAgent.writing.cancel(activeRequestId.current);
  }, []);

  const run = async (operation: ComposerWritingOperation, customInstruction = "") => {
    if (disabled || activeRequestId.current) return;
    const id = crypto.randomUUID();
    const before = value;
    const target = selection.text ? selection : { start: 0, end: value.length, text: "" };
    activeRequestId.current = id;
    setBusyId(id); setError(undefined); setAnnouncement(operation === "draft" ? "Drafting message." : "Revising message.");
    try {
      const result = await window.heyAgent.writing.generate({
        id,
        operation,
        mode,
        draft: value,
        ...(selection.text ? { selectedText: selection.text } : {}),
        ...(customInstruction.trim() ? { instruction: customInstruction.trim() } : {}),
        ...(subject?.trim() ? { subject: subject.trim() } : {}),
        ...(recipients?.trim() ? { recipients: recipients.trim() } : {}),
        ...(threadContext?.trim() ? { threadContext: threadContext.trim() } : {}),
      });
      if (activeRequestId.current !== id) return;
      if (textareaRef.current?.value !== before) throw new Error("Your draft changed while HEY Agent was writing, so the suggestion was not applied.");
      const next = composeWritingSuggestion(before, result.text, selection.text ? target : undefined);
      setSuggestion({ original: before, proposed: next, context });
      setOpen(false); setInstruction("");
      setAnnouncement("Writing suggestion ready to review. Your draft has not changed.");
      appSound.play("receive", "agent");
    } catch (reason) {
      if (activeRequestId.current !== id) return;
      const message = reason instanceof Error ? reason.message : "HEY Agent could not finish that writing request.";
      if (message !== "Writing stopped.") { setError(message); setAnnouncement(message); appSound.play("error", "agent"); }
    } finally {
      if (activeRequestId.current === id) { activeRequestId.current = undefined; setBusyId(undefined); }
    }
  };

  const stop = async () => {
    const id = activeRequestId.current ?? busyId;
    if (!id) return;
    activeRequestId.current = undefined;
    await window.heyAgent.writing.cancel(id);
    setBusyId(undefined);
    setOpen(false);
    setAnnouncement("Writing stopped. Your draft was not changed.");
    requestAnimationFrame(() => textareaRef.current?.focus());
    appSound.play("stop", "agent");
  };

  const restoreDraft = () => {
    if (!restore) return;
    onChange(restore.value);
    const point = restore;
    setRestore(undefined);
    setAnnouncement("Original draft restored.");
    requestAnimationFrame(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(point.start, point.end); });
    appSound.play("undo", "mail");
  };

  const hasSelection = Boolean(selection.text);
  const hasDraft = Boolean(value.trim());
  return <div className="composer-writing-assistant">
    {suggestion && <DraftReviewDialog suggestion={suggestion} currentValue={value} context={context} subject={subject} disabled={disabled}
      onDiscard={() => { setSuggestion(undefined); setAnnouncement("Suggestion discarded. Your draft was not changed."); requestAnimationFrame(() => textareaRef.current?.focus()); }}
      onApply={(next) => {
        const issue = draftReviewIssue(suggestion, textareaRef.current?.value ?? value, context);
        if (issue) return issue;
        onChange(next); setRestore({ value: suggestion.original, applied: next, start: selection.start, end: selection.end });
        setSuggestion(undefined); setAnnouncement("Writing suggestion applied. Nothing has been sent.");
        requestAnimationFrame(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(next.length, next.length); });
      }} />}
    <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
    {restore && <button type="button" className="composer-writing-restore" onClick={restoreDraft}><RotateCcw size={12} /> Restore</button>}
    <button type="button" disabled={disabled} data-tooltip={busyId ? "Stop writing" : "Write with AI"} data-shortcut={busyId ? undefined : hint("composer-write")} className={busyId ? "composer-writing-trigger is-busy" : "composer-writing-trigger"} aria-expanded={open} aria-busy={Boolean(busyId)} onClick={() => busyId ? void stop() : open ? setOpen(false) : show()}>{busyId ? <Square size={11} /> : <Sparkles size={13} />}{busyId ? "Stop" : "Write"}</button>
    {open && <div ref={popoverRef} className="composer-writing-popover" role="dialog" aria-label="Write with HEY Agent" onKeyDown={(event) => {
      event.stopPropagation();
      if (!isShortcutEvent(event.nativeEvent)) { if (event.key === "Enter") event.preventDefault(); return; }
      if (matchesBindingStep(event.nativeEvent, "mod+enter")) { event.preventDefault(); if (instruction.trim() && !busyId) event.currentTarget.querySelector("form")?.requestSubmit(); return; }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); textareaRef.current?.focus(); return; }
      if (event.key !== "Tab") return;
      const controls = [...(popoverRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? [])];
      if (!controls.length) return;
      const first = controls[0]!; const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <header><strong>{hasSelection ? "Revise selection" : hasDraft ? "Help with this draft" : "Draft with HEY Agent"}</strong><button type="button" aria-label="Close writing help" onClick={() => { setOpen(false); requestAnimationFrame(() => textareaRef.current?.focus()); }}><X size={13} /></button></header>
      {hasSelection ? <div className="composer-writing-quick"><button type="button" onClick={() => void run("rewrite")}>Rewrite</button><button type="button" onClick={() => void run("shorten")}>Shorten</button><button type="button" onClick={() => void run("friendlier")}>Friendlier</button></div>
        : hasDraft ? <div className="composer-writing-quick"><button type="button" onClick={() => void run("improve")}>Improve</button><button type="button" onClick={() => void run("continue")}>Continue</button></div> : null}
      <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); if (instruction.trim()) void run(hasDraft || hasSelection ? "custom" : "draft", instruction); }}>
        <input ref={instructionRef} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={hasSelection ? "Or describe the change…" : hasDraft ? "Or tell it what to change…" : "What should this email say?"} disabled={Boolean(busyId)} />
        <button type="submit" data-tooltip="Generate a suggestion to review" data-shortcut="Ctrl+Enter" disabled={!instruction.trim() || Boolean(busyId)}>{busyId ? "Writing…" : hasDraft || hasSelection ? "Suggest" : "Draft"}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <small>Nothing is sent until you use Send.</small>
    </div>}
  </div>;
});

export default ComposerWritingAssistant;
