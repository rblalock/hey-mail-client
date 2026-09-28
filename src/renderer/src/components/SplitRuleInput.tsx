import { X } from "lucide-react";
import { useRef } from "react";
import { MAX_SPLIT_DOMAINS, MAX_SPLIT_PEOPLE, normalizeMailSplitDraft } from "../../../shared/mail-splits";
import "../split-rule-input.css";

export type SplitRuleKind = "people" | "domains";
export type SplitRuleInputValue = { entries: string[]; draft: string; error?: string };

export function splitRuleTokens(value: string): string[] {
  return [...new Set(value.split(/[,;\r\n]+/).map((token) => token.trim().toLowerCase()).filter(Boolean))];
}

/** Accept complete values, retaining every invalid or excess entry for correction. */
export function acceptSplitRuleInput(kind: SplitRuleKind, entries: readonly string[], text: string, complete = true): SplitRuleInputValue {
  const parts = text.split(/[,;\r\n]+/);
  const pending = complete ? "" : parts.pop() ?? "";
  const accepted = [...entries];
  const rejected: string[] = [];
  const maximum = kind === "people" ? MAX_SPLIT_PEOPLE : MAX_SPLIT_DOMAINS;
  let error: string | undefined;
  for (const part of parts) {
    const token = part.trim();
    if (!token) continue;
    try {
      const normalized = normalizeMailSplitDraft({
        name: "Split", enabled: false, labelName: "Split", people: ["preview@example.com"], domains: [], [kind]: [token],
      })[kind][0]!;
      if (accepted.includes(normalized)) continue;
      if (accepted.length >= maximum) throw new Error(`Use at most ${maximum} ${kind === "people" ? "email addresses" : "domains"} per split.`);
      accepted.push(normalized);
    } catch (reason) {
      rejected.push(token);
      error ??= reason instanceof Error ? reason.message : "Check this entry and try again.";
    }
  }
  return { entries: accepted, draft: [...rejected, ...(pending ? [pending] : [])].join(", "), ...(error ? { error } : {}) };
}

type SplitRuleInputProps = {
  id: string;
  kind: SplitRuleKind;
  entries: string[];
  draft: string;
  error?: string;
  describedBy?: string;
  onChange: (value: SplitRuleInputValue) => void;
};

export default function SplitRuleInput({ id, kind, entries, draft, error, describedBy, onChange }: SplitRuleInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const label = kind === "people" ? "People" : "Domains";
  const commit = (text: string, complete = true) => onChange(acceptSplitRuleInput(kind, entries, text, complete));
  const descriptions = [describedBy, kind === "domains" && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ");

  return <div className="split-field split-rule-field">
    <label htmlFor={id}>{label}</label>
    <div className="split-rule-control" data-invalid={Boolean(error)}>
      {entries.length > 0 && <ul className="split-rule-entries" aria-label={`${label} entries`}>
        {entries.map((entry) => <li key={entry} className="split-rule-chip">
          <span>{entry}</span>
          <button type="button" aria-label={`Remove ${entry}`} onClick={() => {
            onChange({ entries: entries.filter((value) => value !== entry), draft, ...(error ? { error } : {}) });
            input.current?.focus();
          }}><X size={13} aria-hidden="true" /></button>
        </li>)}
      </ul>}
      <input ref={input} id={id} value={draft} autoComplete="off" autoCapitalize="none" spellCheck={false}
        placeholder={kind === "people" ? "Add an email address" : "Add a domain"}
        aria-invalid={Boolean(error)} aria-describedby={descriptions || undefined}
        onChange={(event) => {
          if ((event.nativeEvent as InputEvent).isComposing) onChange({ entries, draft: event.target.value });
          else commit(event.target.value, false);
        }}
        onCompositionEnd={(event) => commit(event.currentTarget.value, false)}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text/plain");
          if (!text) return;
          event.preventDefault();
          const node = event.currentTarget;
          commit(draft.slice(0, node.selectionStart ?? draft.length) + text + draft.slice(node.selectionEnd ?? draft.length));
        }}
        onBlur={() => { if (draft.trim()) commit(draft); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === "Enter") { event.preventDefault(); commit(draft); }
        }} />
    </div>
    {kind === "domains" && <span className="split-field-help" id={`${id}-help`}>Exact domains only, such as company.com. Add subdomains separately; wildcards are not supported.</span>}
    {error && <span className="split-field-error" id={`${id}-error`} role="alert">{error}</span>}
  </div>;
}
