import { ArrowLeft, Check, Pencil, Plus, RefreshCw, Tag, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { MailLibraryItem } from "../../../shared/contracts";
import { normalizeMailSplitDraft, type MailSplit, type MailSplitDraft, type MailSplitPreview } from "../../../shared/mail-splits";
import { trapFocus } from "../composer-keyboard";
import "../split-inbox.css";
import SplitRuleInput, { acceptSplitRuleInput, splitRuleTokens, type SplitRuleInputValue, type SplitRuleKind } from "./SplitRuleInput";

export { splitRuleTokens } from "./SplitRuleInput";

export type SplitInboxManagerProps = {
  splits: MailSplit[];
  labels: MailLibraryItem[];
  initialDraft?: Partial<MailSplitDraft>;
  errors?: Record<string, string>;
  onPreview: (draft: MailSplitDraft) => Promise<MailSplitPreview>;
  onSave: (draft: MailSplitDraft) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onClose: () => void;
};

type EditorFields = {
  id?: string;
  name: string;
  enabled: boolean;
  people: string;
  domains: string;
  peoplePending?: string;
  domainsPending?: string;
  labelId?: string;
  labelName: string;
};

function fieldsFrom(draft: Partial<MailSplitDraft> = {}): EditorFields {
  const people = acceptSplitRuleInput("people", [], draft.people?.join(", ") ?? "");
  const domains = acceptSplitRuleInput("domains", [], draft.domains?.join(", ") ?? "");
  return {
    id: draft.id,
    name: draft.name ?? "",
    enabled: draft.enabled ?? true,
    people: people.entries.join(", "),
    domains: domains.entries.join(", "),
    peoplePending: people.draft,
    domainsPending: domains.draft,
    labelId: draft.labelId,
    labelName: draft.labelName ?? draft.name ?? "",
  };
}

function fieldTokens(fields: EditorFields, kind: SplitRuleKind): string[] {
  return splitRuleTokens(`${fields[kind]}, ${fields[`${kind}Pending`] ?? ""}`);
}

export function splitEditorValidation(fields: EditorFields): Record<string, string> {
  const issues: Record<string, string> = {};
  const people = fieldTokens(fields, "people");
  const domains = [...new Set(fieldTokens(fields, "domains").map((domain) => domain.replace(/^@/, "")))];
  const valid: MailSplitDraft = { name: "Split", enabled: false, people: ["preview@example.com"], domains: [], labelName: "Split" };
  const values = { name: fields.name, people, domains, labelName: fields.labelName, ...(fields.labelId ? { labelId: fields.labelId } : {}) };
  for (const [key, value] of Object.entries(values)) {
    // Validate each field independently with the same rules used by IPC.
    try { normalizeMailSplitDraft({ ...valid, ...(key === "labelName" && fields.labelId ? { labelId: "1" } : {}), [key]: value }); }
    catch (reason) { issues[key] = messageOf(reason, "Check this value."); }
  }
  return issues;
}

function draftFrom(fields: EditorFields): MailSplitDraft {
  return {
    ...(fields.id ? { id: fields.id } : {}),
    name: fields.name.trim(),
    enabled: fields.enabled,
    people: fieldTokens(fields, "people"),
    domains: [...new Set(fieldTokens(fields, "domains").map((domain) => domain.replace(/^@/, "")))],
    ...(fields.labelId ? { labelId: fields.labelId } : {}),
    labelName: fields.labelName.trim(),
  };
}

const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

// Local extension: the existing opaque dialog and theme tokens, with one task per view.
// Preview protects a label-writing action; turning off/removing never removes HEY data.
export default function SplitInboxManager({ splits, labels, initialDraft, errors = {}, onPreview, onSave, onRemove, onClose }: SplitInboxManagerProps) {
  const [fields, setFields] = useState<EditorFields | undefined>(() => initialDraft || !splits.length ? fieldsFrom(initialDraft) : undefined);
  const [preview, setPreview] = useState<MailSplitPreview>();
  const [validation, setValidation] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<"preview" | "save" | "remove">();
  const [removeId, setRemoveId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const id = useId();

  useEffect(() => {
    const node = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    node.showModal();
    return () => { node.close(); if (opener?.isConnected) opener.focus(); };
  }, []);

  const editing = Boolean(fields);
  const editId = fields?.id;
  const hasRules = Boolean(fields && (fieldTokens(fields, "people").length || fieldTokens(fields, "domains").length));
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>(editing ? ".split-editor-name" : ".split-manager-create")?.focus();
  }, [editing, editId]);

  const close = () => { if (!inFlight.current) onClose(); };
  const edit = (draft: Partial<MailSplitDraft> = {}) => {
    setFields(fieldsFrom(draft)); setPreview(undefined); setValidation({}); setError(undefined); setRemoveId(undefined); setNotice(undefined);
  };
  const back = () => { setFields(undefined); setPreview(undefined); setValidation({}); setError(undefined); setRemoveId(undefined); };
  const change = (patch: Partial<EditorFields>) => {
    setFields((current) => current ? { ...current, ...patch } : current);
    setPreview(undefined); setValidation({}); setError(undefined);
  };
  const changeRules = (kind: SplitRuleKind, value: SplitRuleInputValue) => {
    change({ [kind]: value.entries.join(", "), [`${kind}Pending`]: value.draft });
    if (value.error) setValidation({ [kind]: value.error });
  };
  const checkedDraft = () => {
    if (!fields) return;
    const people = acceptSplitRuleInput("people", splitRuleTokens(fields.people), fields.peoplePending ?? "");
    const domains = acceptSplitRuleInput("domains", splitRuleTokens(fields.domains), fields.domainsPending ?? "");
    const nextFields = { ...fields, people: people.entries.join(", "), domains: domains.entries.join(", "), peoplePending: people.draft, domainsPending: domains.draft };
    setFields(nextFields);
    const issues = splitEditorValidation(nextFields);
    setValidation(issues);
    if (Object.keys(issues).length) {
      requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    return draftFrom(nextFields);
  };
  const inspect = async () => {
    if (inFlight.current) return;
    const draft = checkedDraft();
    if (!draft) return;
    inFlight.current = true; setBusy("preview"); setError(undefined); setPreview(undefined);
    try {
      setPreview(await onPreview(draft));
      requestAnimationFrame(() => dialog.current?.querySelector('.split-preview')?.scrollIntoView({ block: "nearest" }));
    }
    catch (reason) { setError(messageOf(reason, "Could not preview this split. Try again.")); }
    finally { inFlight.current = false; setBusy(undefined); }
  };
  const save = async () => {
    if (inFlight.current) return;
    const draft = checkedDraft();
    if (!draft) return;
    if (draft.enabled && !preview) { setError("Preview the matches before saving an enabled split."); return; }
    inFlight.current = true; setBusy("save"); setError(undefined);
    try {
      await onSave(draft);
      setNotice(`“${draft.name}” saved.`);
      back();
    } catch (reason) { setError(messageOf(reason, "Could not save this split. Your changes are still here.")); }
    finally { inFlight.current = false; setBusy(undefined); }
  };
  const remove = async (split: MailSplit) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy("remove"); setError(undefined);
    try { await onRemove(split.id); setRemoveId(undefined); setNotice(`“${split.name}” removed. Its HEY label and mail are unchanged.`); }
    catch (reason) { setError(messageOf(reason, "Could not remove this split. Try again.")); }
    finally { inFlight.current = false; setBusy(undefined); }
  };
  const fieldError = (key: string) => validation[key] ? <span className="split-field-error" id={`${id}-${key}-error`} role="alert">{validation[key]}</span> : null;

  return <dialog ref={dialog} className="split-manager" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} data-keyboard-scope="editor"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onKeyDown={(event) => {
      trapFocus(event, event.currentTarget);
      if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (removeId) setRemoveId(undefined); else close(); }
      event.stopPropagation();
    }}>
    <header className="split-manager-heading">
      <div>{fields && <button type="button" className="icon-button" aria-label="Back to splits" disabled={Boolean(busy)} onClick={back}><ArrowLeft size={18} /></button>}
        <h2 id={`${id}-title`}>{fields ? fields.id ? "Edit split" : "Create split" : "Split inboxes"}</h2></div>
      <button type="button" className="icon-button" aria-label="Close split settings" title="Close (Esc)" disabled={Boolean(busy)} onClick={close}><X size={18} /></button>
    </header>

    {Object.entries(errors).filter(([key]) => !splits.some((split) => split.id === key)).map(([key, message]) => <p key={key} className="split-feedback split-global-error" role="alert">{message}</p>)}

    {fields ? <form className="split-editor" onSubmit={(event) => { event.preventDefault(); void (fields.enabled && !preview ? inspect() : save()); }}>
      <div className="split-manager-body">
        <fieldset disabled={Boolean(busy)} className="split-editor-fields">
          <label className="split-field" htmlFor={`${id}-name`}><span>Name</span>
            <input id={`${id}-name`} className="split-editor-name" value={fields.name} maxLength={80} autoComplete="off" placeholder="Team, VIP, GitHub…" aria-invalid={Boolean(validation.name)} aria-describedby={validation.name ? `${id}-name-error` : undefined}
              onChange={(event) => change({ name: event.target.value, ...(!fields.labelId && fields.labelName === fields.name ? { labelName: event.target.value } : {}) })} />{fieldError("name")}</label>

          <section className="split-rule-fields" aria-labelledby={`${id}-rules-title`}>
            <h3 id={`${id}-rules-title`}>People and domains</h3><p id={`${id}-rules-help`}>Conversations with any of these people or domains belong in this split, including your replies. Press Enter or use commas or new lines to add entries.</p>
            <p className="split-field-help">Leave empty to add conversations yourself.</p>
            <div className="split-rule-columns">
              <SplitRuleInput id={`${id}-people`} kind="people" entries={splitRuleTokens(fields.people)} draft={fields.peoplePending ?? ""} error={validation.people} describedBy={`${id}-rules-help`} onChange={(value) => changeRules("people", value)} />
              <SplitRuleInput id={`${id}-domains`} kind="domains" entries={splitRuleTokens(fields.domains)} draft={fields.domainsPending ?? ""} error={validation.domains} describedBy={`${id}-rules-help`} onChange={(value) => changeRules("domains", value)} />
            </div>
          </section>

          <section className="split-label-fields" aria-labelledby={`${id}-label-title`}>
            <h3 id={`${id}-label-title`}><Tag size={15} />HEY label</h3><p>Open this label in HEY mobile to find the same conversations.</p>
            <label className="split-field" htmlFor={`${id}-label`}><span className="sr-only">Linked HEY label</span>
              <select id={`${id}-label`} value={fields.labelId ?? ""} aria-invalid={Boolean(validation.labelId)} aria-describedby={validation.labelId ? `${id}-labelId-error` : undefined} onChange={(event) => {
                const label = labels.find((item) => item.id === event.target.value);
                change({ labelId: label?.id, labelName: label?.title ?? fields.name });
              }}><option value="">Create a new label</option>
                {fields.labelId && !labels.some((label) => label.id === fields.labelId) && <option value={fields.labelId}>{fields.labelName}</option>}
                {labels.map((label) => <option key={label.id} value={label.id}>{label.title}</option>)}
              </select>{fieldError("labelId")}
            </label>
            {!fields.labelId && <label className="split-field" htmlFor={`${id}-label-name`}><span>New label name</span><input id={`${id}-label-name`} value={fields.labelName} maxLength={120} autoComplete="off" aria-invalid={Boolean(validation.labelName)} aria-describedby={validation.labelName ? `${id}-labelName-error` : undefined} onChange={(event) => change({ labelName: event.target.value })} />{fieldError("labelName")}</label>}
            {!fields.labelId && !hasRules && <p className="split-field-help">The HEY label will be created when you first add a conversation.</p>}
            {fields.labelId && <p className="split-field-help">Conversations already carrying this label also appear in the split.</p>}
          </section>

          <label className="split-enabled"><input type="checkbox" checked={fields.enabled} onChange={(event) => change({ enabled: event.target.checked })} /><span>Enable this split</span></label>
          <p className="split-sync-note">{hasRules ? "Labels are applied while HEY Agent is running." : "Conversations you add are kept in its HEY label."} Turning off a split keeps its HEY label.</p>
        </fieldset>

        {preview && <section className="split-preview" aria-label="Matching conversations" aria-live="polite">
          <header><Check size={16} /><h3>{preview.count} matching {preview.count === 1 ? "conversation" : "conversations"}</h3></header>
          <p>{preview.scope}</p>
          {preview.samples.length ? <ul>{preview.samples.map((posting) => <li key={posting.id}><strong title={posting.sender.name}>{posting.sender.name}</strong><span title={posting.subject}>{posting.subject || "(No subject)"}</span></li>)}</ul> : <p>{hasRules ? "No matching mail in this preview. New matches will appear as mail arrives." : "No conversations yet. Save this split, then add conversations from your mail list."}</p>}
          <p className="split-sync-note">{hasRules ? "Preview only. Saving an enabled split starts applying its label." : "Only conversations you add or that already carry its HEY label will appear here."}</p>
        </section>}
        {Object.keys(validation).length > 0 && <p className="split-feedback" role="alert">Check the highlighted fields.</p>}
        {error && <p className="split-feedback" role="alert">{error}</p>}
      </div>
      {fields.enabled && !preview && <p id={`${id}-review-help`} className="split-review-guidance">Review matching conversations first. You can save the split after reviewing.</p>}
      <footer className="split-manager-footer">
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={back}>Cancel</button>
        <div>{(!fields.enabled || preview) && <button type="button" className="secondary-button split-preview-button" disabled={Boolean(busy)} onClick={() => void inspect()}>{busy === "preview" && <RefreshCw size={15} className="is-spinning" />}{busy === "preview" ? "Checking matches…" : preview ? "Review again" : "Review matches"}</button>}
          <button type="submit" className={`primary-button${fields.enabled && !preview ? " split-preview-button" : ""}`} disabled={Boolean(busy)} aria-describedby={fields.enabled && !preview ? `${id}-review-help` : undefined}>{busy === "preview" && <RefreshCw size={15} className="is-spinning" />}{busy === "save" ? "Saving…" : busy === "preview" ? "Checking matches…" : fields.enabled && !preview ? "Review matches" : "Save split"}</button></div>
      </footer>
    </form> : <>
      <div className="split-manager-body">
        <div className="split-manager-intro"><p>Focus on a group of people or domains, without moving their mail.</p><button type="button" className="secondary-button split-manager-create" onClick={() => edit()} disabled={Boolean(busy)}><Plus size={16} />New split</button></div>
        {notice && <p className="split-notice" role="status">{notice}</p>}
        {error && <p className="split-feedback" role="alert">{error}</p>}
        {splits.length ? <ul className="split-manager-list">{splits.map((split) => <li key={split.id}>
          <div className="split-manager-row"><button type="button" className="split-manager-edit" onClick={() => edit(split)} disabled={Boolean(busy)} aria-label={`Edit ${split.name}`}>
            <span className="split-manager-row-name"><strong title={split.name}>{split.name}</strong><span className="split-state">{split.enabled ? "On" : "Off"}</span></span>
            <span className="split-manager-rule-summary" title={[...split.people, ...split.domains].join(", ")}>{[...split.people, ...split.domains].join(", ") || "Conversations you add yourself"}</span>
            <span className="split-manager-label" title={split.labelName}><Tag size={13} /><span>{split.labelName}</span></span>
          </button><button type="button" className="icon-button" aria-label={`Edit ${split.name} rules`} title="Edit split" disabled={Boolean(busy)} onClick={() => edit(split)}><Pencil size={16} /></button>
            <button type="button" className="icon-button" aria-label={`Remove ${split.name}`} title="Remove split" disabled={Boolean(busy)} onClick={() => setRemoveId(split.id)}><Trash2 size={16} /></button></div>
          {errors[split.id] && <p className="split-feedback" role="status">{errors[split.id]}</p>}
          {removeId === split.id && <div className="split-remove-confirm" role="group" aria-label={`Confirm removing ${split.name}`}><p>Remove this split? Its HEY label and emails will stay.</p><div><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => setRemoveId(undefined)}>Keep split</button><button type="button" className="secondary-button split-remove-action" disabled={Boolean(busy)} onClick={() => void remove(split)}>{busy === "remove" ? "Removing…" : "Remove split"}</button></div></div>}
        </li>)}</ul> : <div className="split-manager-empty"><h3>No splits yet</h3><p>Create one for your team, important people, or a notification sender.</p></div>}
        <p className="split-sync-note">A conversation can appear in more than one split. Its read state and actions stay the same everywhere.</p>
      </div>
      <footer className="split-manager-footer"><p>Splits belong to this account on this computer.</p><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={close}>Done</button></footer>
    </>}
  </dialog>;
}
