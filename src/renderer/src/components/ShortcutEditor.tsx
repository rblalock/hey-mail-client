import { useEffect, useState } from "react";
import type { AppSettings } from "../../../shared/contracts";
import { formatBinding, validateCustomShortcuts, type ShortcutDefinition } from "../shortcuts";
import { normalizeBindings } from "../../../shared/shortcut-binding";

export default function ShortcutEditor({ shortcut, settings, onSettings }: { shortcut: ShortcutDefinition; settings: AppSettings; onSettings: (settings: AppSettings) => void }) {
  const [text, setText] = useState(shortcut.keys.join("\n"));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const resolvedText = shortcut.keys.join("\n");
  useEffect(() => { setText(resolvedText); }, [resolvedText]);
  const save = async (action: "save" | "reset" | "disable") => {
    if (saving) return;
    const focused = document.activeElement as HTMLElement | null;
    setError(undefined); setSaved(false);
    try {
      const bindings = action === "reset" ? null : action === "disable" ? [] : normalizeBindings(text.split("\n").filter((line) => line.trim()));
      if (action === "save" && !bindings?.length) throw new Error("Enter a shortcut, or choose Disable or Reset.");
      const candidate = { ...settings.customShortcuts };
      if (bindings === null) delete candidate[shortcut.id]; else candidate[shortcut.id] = bindings;
      validateCustomShortcuts(candidate);
      setSaving(true);
      const next = await window.heyAgent.settings.update({ shortcutEdit: { id: shortcut.id, bindings } });
      onSettings(next); setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save. Try again; your previous shortcut is unchanged."); }
    finally {
      setSaving(false);
      requestAnimationFrame(() => {
        if (document.activeElement !== document.body) return;
        const fallback = document.getElementById(`shortcut-${shortcut.id}`);
        (focused?.isConnected && !focused.matches(":disabled") ? focused : fallback)?.focus();
      });
    }
  };
  const errorId = `shortcut-${shortcut.id}-error`;
  return <div className="shortcut-editor-row">
    <label htmlFor={`shortcut-${shortcut.id}`}><strong>{shortcut.label}</strong><small>{shortcut.scope === "composer" ? "Active mail composer" : shortcut.scope}</small></label>
    <div><textarea id={`shortcut-${shortcut.id}`} rows={Math.max(1, Math.min(5, text.split("\n").length))} value={text} spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} disabled={saving} onChange={(event) => { setText(event.target.value); setError(undefined); setSaved(false); }} />
      {error && <p id={errorId} className="settings-inline-error" role="alert">{error}</p>}
      <div className="shortcut-editor-actions"><button type="button" disabled={saving} onClick={() => void save("save")}>{saving ? "Saving…" : "Save"}</button><button type="button" disabled={saving || settings.customShortcuts[shortcut.id] === undefined} onClick={() => void save("reset")}>Reset</button><button type="button" disabled={saving || shortcut.keys.length === 0} onClick={() => void save("disable")}>Disable</button><span role="status">{saved ? "Saved" : shortcut.keys.length ? formatBinding(shortcut.keys[0]!) : "Disabled"}</span></div>
    </div>
  </div>;
}
