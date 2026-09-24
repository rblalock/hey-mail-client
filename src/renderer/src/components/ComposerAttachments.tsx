import { Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type Dispatch, type SetStateAction } from "react";
import { validateComposerFiles, type ComposerFile } from "../../../shared/composer-attachments";

export function useComposerAttachments(paths: string[], setPaths: Dispatch<SetStateAction<string[]>>, onError: (message: string) => void, disabled: boolean, unsupported?: string) {
  const busy = useRef(false);
  const mounted = useRef(true);
  // Profile-backed setters change identity when the conversation/draft changes.
  const destination = useRef(setPaths);
  destination.current = setPaths;
  const [importing, setImporting] = useState(false);
  const [files, setFiles] = useState<ComposerFile[]>([]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    void window.heyAgent.mail.describeAttachments(paths).then((value) => { if (!cancelled) setFiles(value); }).catch(() => { if (!cancelled) setFiles([]); });
    return () => { cancelled = true; };
  }, [paths]);
  const discard = (selected: string[]) => { void window.heyAgent.mail.removeComposerAttachments(selected).catch(() => {}); };
  const ingest = async (load: () => Promise<string[]>) => {
    if (disabled) return;
    if (busy.current) { onError("Wait for the current attachments to finish, then paste or drop again."); return; }
    if (unsupported) { onError(unsupported); return; }
    busy.current = true;
    setImporting(true);
    try {
      const selected = await load();
      if (!mounted.current || destination.current !== setPaths || paths.length + selected.length > 25) {
        discard(selected);
        if (mounted.current && destination.current === setPaths) onError("Attach up to 25 files per message.");
      } else if (selected.length) setPaths((current) => [...current, ...selected]);
    } catch (error) { if (mounted.current && destination.current === setPaths) onError(error instanceof Error ? error.message : "Could not attach these files."); }
    finally { busy.current = false; if (mounted.current) setImporting(false); }
  };
  const importFiles = (selected: File[]) => ingest(async () => {
    validateComposerFiles(selected, paths.length);
    const files = [];
    for (const file of selected) files.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return window.heyAgent.mail.importAttachments(files);
  });
  const onPaste = (event: ClipboardEvent) => {
    const selected = Array.from(event.clipboardData.files);
    if (selected.length) { event.preventDefault(); void importFiles(selected); }
    // Linux file managers put local file URIs on the clipboard, not browser File objects.
    else if (event.clipboardData.types.includes("x-special/gnome-copied-files") || event.clipboardData.types.includes("text/uri-list") && event.clipboardData.getData("text/uri-list").trim().startsWith("file://")) {
      event.preventDefault(); void ingest(() => window.heyAgent.mail.pasteAttachments());
    }
  };
  const onDragOver = (event: DragEvent) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; } };
  const onDrop = (event: DragEvent) => { if (event.dataTransfer.files.length) { event.preventDefault(); void importFiles(Array.from(event.dataTransfer.files)); } };
  return {
    importing, busy, onPaste, onDrop, onDragOver,
    choose: () => ingest(() => window.heyAgent.mail.selectAttachments()),
    clear: () => { discard(paths); setPaths([]); },
    files: paths.map((path) => files.find((file) => file.path === path) ?? { path, name: path.split("/").at(-1)! }),
    remove: (path: string) => { if (!disabled && !busy.current) { setPaths((current) => current.filter((item) => item !== path)); discard([path]); } },
  };
}

export default function ComposerAttachments({ value, disabled }: { value: ReturnType<typeof useComposerAttachments>; disabled: boolean }) {
  if (!value.files.length && !value.importing) return null;
  return <div className="composer-file-list" aria-busy={value.importing}>
    <div className="composer-file-cards">{value.files.map((file) => <div className="composer-file" key={file.path}>
      {file.previewUrl ? <img src={file.previewUrl} alt="" /> : <Paperclip size={20} aria-hidden="true" />}
      <span title={file.name}>{file.name}{file.byteSize !== undefined && <small>{Math.max(1, Math.ceil(file.byteSize / 1024)).toLocaleString()} KB</small>}</span>
      <button type="button" className="icon-button" aria-label={`Remove ${file.name}`} disabled={disabled || value.importing} onClick={() => value.remove(file.path)}><X size={14} /></button>
    </div>)}</div>
    <small role="status">{value.importing ? "Adding attachments…" : "Attachments are added after the message, not between paragraphs."}</small>
  </div>;
}
