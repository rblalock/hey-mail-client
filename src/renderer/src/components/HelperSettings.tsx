import { ChevronDown, ChevronRight } from "lucide";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import type { AppSettings, HelperSettings as HelperPreferences } from "../../../shared/contracts";
import { customHelpersError, helperCatalog, MAX_CUSTOM_HELPERS, MAX_HELPER_INSTRUCTIONS, type CustomHelper, type HelperId } from "../../../shared/helpers";
import { appSound } from "../sound";
import MorphingIcon from "./MorphingIcon";
import { isShortcutEvent, matchesBindingStep } from "../../../shared/shortcut-binding";

type Props = { settings: AppSettings; onSettings: (settings: AppSettings) => void; onRun: (id: HelperId) => void; onEdit: () => void; runnable: HelperId[]; busyHelpers: Set<HelperId> };
type Editor = { kind: "custom"; value: CustomHelper; original?: CustomHelper } | { kind: "preferences"; id: "daily-brief" | "calendar-triage"; value: string; original: string };

// Operate: extend Settings' quiet rows. Editing unfolds in place; no new dashboard.
export default function HelperSettings({ settings, onSettings, onRun, onEdit, runnable, busyHelpers }: Props) {
  const [editor, setEditor] = useState<Editor>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState<"delete" | "discard">();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const newHelper = useRef<HTMLButtonElement | null>(null);
  const firstField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const keepEditing = useRef<HTMLButtonElement | null>(null);
  const custom = settings.helpers.custom ?? [];
  const catalog = helperCatalog(custom);
  const editorId = editor?.kind === "custom" ? editor.value.id : editor?.id;
  const dirty = editor && (editor.kind === "custom" ? JSON.stringify(editor.value) !== JSON.stringify(editor.original) : editor.value !== editor.original);

  const close = () => { setEditor(undefined); setConfirm(undefined); setError(undefined); requestAnimationFrame(() => (trigger.current?.isConnected ? trigger.current : newHelper.current)?.focus()); };
  const requestConfirm = (action: "delete" | "discard") => { setConfirm(action); requestAnimationFrame(() => keepEditing.current?.focus()); };
  const dismissConfirm = () => { setConfirm(undefined); requestAnimationFrame(() => firstField.current?.focus()); };
  const save = async (helpers: Partial<HelperPreferences>, finish = false, enabled = true) => {
    setBusy(true); setError(undefined);
    try {
      onSettings(await window.heyAgent.settings.update({ helpers }));
      appSound.play(enabled ? "select" : "deselect", "interface");
      if (finish) close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the Helper. Try again."); }
    finally { setBusy(false); }
  };
  const open = (next: Editor, button: HTMLButtonElement) => { trigger.current = button; setEditor(next); setError(undefined); setConfirm(undefined); onEdit(); appSound.play("open", "interface"); };
  const submit = () => {
    if (!editor || confirm) return;
    if (editor.kind === "preferences") {
      void save({ preferences: { ...settings.helpers.preferences, [editor.id]: editor.value.trim() } }, true);
    } else {
      const next = editor.original ? custom.map((helper) => helper.id === editor.value.id ? editor.value : helper) : [...custom, editor.value];
      const error = customHelpersError(next);
      if (error) { setError(error); return; }
      void save({ custom: next, enabled: editor.original ? settings.helpers.enabled : [...settings.helpers.enabled, editor.value.id] }, true);
    }
  };
  const duplicate = () => {
    if (editor?.kind !== "custom") return;
    let title = `${editor.value.title.slice(0, 49)} copy`;
    for (let n = 2; catalog.some((helper) => helper.title.toLowerCase() === title.toLowerCase()); n++) title = `${editor.value.title.slice(0, 49)} copy ${n}`;
    setEditor({ kind: "custom", value: { ...editor.value, id: `custom-${crypto.randomUUID()}`, title } });
    setConfirm(undefined); setError(undefined);
    requestAnimationFrame(() => { firstField.current?.focus(); firstField.current?.select(); });
  };
  const remove = () => {
    if (editor?.kind !== "custom" || !editor.original) return;
    void save({ custom: custom.filter((helper) => helper.id !== editor.value.id), enabled: settings.helpers.enabled.filter((id) => id !== editor.value.id) }, true);
  };

  return <div className="helper-settings" data-helper-controls>
    <div className="settings-section-toolbar"><span>Run from Ctrl+K, mail, or Calendar.</span><button ref={newHelper} type="button" className="secondary-button helper-create" disabled={busy || Boolean(editor) || custom.length >= MAX_CUSTOM_HELPERS} onClick={(event) => open({ kind: "custom", value: { id: `custom-${crypto.randomUUID()}`, title: "", instructions: "", context: "any", modelProfile: "general" } }, event.currentTarget)}><Plus size={15} />New Helper</button></div>
    <div className="helper-list">{catalog.map((helper) => {
      const authored = custom.find((item) => item.id === helper.id);
      const hasPreferences = helper.id === "daily-brief" || helper.id === "calendar-triage";
      const enabled = settings.helpers.enabled.includes(helper.id);
      const editable = authored || hasPreferences;
      return <div key={helper.id} data-editing={editorId === helper.id || undefined}>
        {editable ? <button type="button" className="helper-row-label" disabled={busy || Boolean(editor)} aria-label={`Edit ${helper.title}`} onClick={(event) => {
          if (authored) open({ kind: "custom", value: { ...authored }, original: { ...authored } }, event.currentTarget);
          else if (helper.id === "daily-brief" || helper.id === "calendar-triage") { const value = settings.helpers.preferences?.[helper.id] ?? ""; open({ kind: "preferences", id: helper.id, value, original: value }, event.currentTarget); }
        }}><span><strong>{helper.title}</strong><small>{helper.purpose}</small></span><MorphingIcon icon={editorId === helper.id ? ChevronDown : ChevronRight} size={13} /></button> : <span><strong>{helper.title}</strong><small>{helper.purpose}</small></span>}
        <button type="button" className="sound-switch" role="switch" aria-checked={enabled} aria-label={`${enabled ? "Disable" : "Enable"} ${helper.title}`} disabled={busy || Boolean(editor)} onClick={() => void save({ enabled: enabled ? settings.helpers.enabled.filter((id) => id !== helper.id) : [...settings.helpers.enabled, helper.id] }, false, !enabled)}><span /></button>
      </div>;
    })}</div>
    {editor && <form className="helper-editor" aria-label={editor.kind === "custom" ? editor.original ? "Edit Helper" : "New Helper" : `${catalog.find((helper) => helper.id === editor.id)?.title} preferences`} onSubmit={(event) => { event.preventDefault(); submit(); }} onKeyDownCapture={(event) => {
      if (!isShortcutEvent(event.nativeEvent)) { if (event.key === "Enter") event.preventDefault(); event.stopPropagation(); return; }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) { if (confirm) dismissConfirm(); else if (dirty) requestConfirm("discard"); else close(); } }
      if (matchesBindingStep(event.nativeEvent, "mod+enter")) { event.preventDefault(); event.stopPropagation(); if (!busy && !confirm) submit(); }
    }}>
      {editor.kind === "custom" ? <>
        <label>Name<input ref={(node) => { firstField.current = node; }} autoFocus value={editor.value.title} maxLength={60} disabled={busy} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, title: event.target.value } })} placeholder="e.g. Project check-in" /></label>
        <label>Instructions<textarea value={editor.value.instructions} maxLength={MAX_HELPER_INSTRUCTIONS} disabled={busy} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, instructions: event.target.value } })} placeholder="What should this Helper do? Describe the useful outcome, sources, and anything to avoid." /></label>
        <div className="helper-editor-options"><label>Context<select value={editor.value.context} disabled={busy} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, context: event.target.value as CustomHelper["context"] } })}><option value="any">Any · context optional</option><option value="mail">Selected mail</option><option value="calendar">Calendar event or window</option></select></label><label>Model<select value={editor.value.modelProfile} disabled={busy} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, modelProfile: event.target.value as CustomHelper["modelProfile"] } })}><option value="general">General</option><option value="quick">Quick</option></select></label></div>
        <p className="helper-editor-note">Saved locally; sent to your model when run. Existing chats keep their instructions. Normal Pi tools and HEY approvals apply.</p>
      </> : <><label>Preferences<textarea ref={(node) => { firstField.current = node; }} autoFocus value={editor.value} maxLength={2_000} disabled={busy} onChange={(event) => setEditor({ ...editor, value: event.target.value })} placeholder={editor.id === "daily-brief" ? "e.g. Prioritize client replies. Include this week's todos." : "e.g. I work 9–5 Eastern. Leave 15 minutes between calls."} /></label><p className="helper-editor-note">Optional. Applies to new runs; nothing runs automatically.</p></>}
      {error && <p role="alert" className="helper-error">{error}</p>}
      {confirm ? <div className="helper-confirm" role="alert"><p>{confirm === "delete" ? "Delete this Helper? Existing chats will remain." : "Discard these unsaved changes?"}</p><button ref={keepEditing} type="button" className="secondary-button" disabled={busy} onClick={dismissConfirm}>Keep editing</button><button type="button" className="secondary-button helper-destructive" disabled={busy} onClick={() => confirm === "delete" ? remove() : close()}>{confirm === "delete" ? "Delete Helper" : "Discard"}</button></div> : <footer>
        <div>{editor.kind === "custom" && editor.original && <><button type="button" className="helper-text-button" disabled={busy || custom.length >= MAX_CUSTOM_HELPERS} onClick={duplicate}>Duplicate</button><button type="button" className="helper-text-button helper-destructive" disabled={busy} onClick={() => requestConfirm("delete")}>Delete</button></>}</div>
        <div><button type="button" className="secondary-button" disabled={busy} data-tooltip={dirty ? "Review unsaved changes" : "Close Helper editor"} data-shortcut="Esc" onClick={() => dirty ? requestConfirm("discard") : close()}>Cancel</button>{editorId && (editor.kind === "preferences" || editor.original) && <button type="button" className="secondary-button" disabled={busy || Boolean(dirty) || !runnable.includes(editorId) || busyHelpers.has(editorId)} title={dirty ? "Save changes before running" : !runnable.includes(editorId) ? "Enable this Helper and select its context to run" : undefined} onClick={() => onRun(editorId)}>{busyHelpers.has(editorId) ? "Starting…" : "Run"}</button>}<button type="submit" className="primary-button" data-tooltip="Save Helper" data-shortcut="Ctrl+Enter" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
      </footer>}
    </form>}
    {!editor && error && <p role="alert" className="helper-error">{error}</p>}
  </div>;
}
