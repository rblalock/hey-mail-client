import { EditProvider, MultiFileDiff } from "@pierre/diffs/react";
import { Editor, type EditorFactory, type EditorOptions } from "@pierre/diffs/edit";
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { draftTextEdit } from "../draft-edit";

export type DraftDiffHandle = { undo: () => boolean; redo: () => boolean; setText: (text: string) => void };
const createEditor: EditorFactory<undefined, undefined> = (type, options, key) => new Editor(type, options, key);

export default function DraftDiffPreview({ original, proposed, onChange, ref }: { original: string; proposed: string; onChange: (text: string) => void; ref?: Ref<DraftDiffHandle> }) {
  const editor = useRef<Editor<"file-diff"> | null>(null);
  const latestProposed = useRef(proposed);
  useLayoutEffect(() => { latestProposed.current = proposed; }, [proposed]);
  useImperativeHandle(ref, () => ({
    undo: () => { if (!editor.current) return false; editor.current.undo(); return true; },
    redo: () => { if (!editor.current) return false; editor.current.redo(); return true; },
    setText: (text) => { if (editor.current) editor.current.applyEdits(draftTextEdit(editor.current.getText(), text)); },
  }), []);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 800px)").matches);
  const [theme, setTheme] = useState<"light" | "dark">(() => document.documentElement.dataset.theme === "light" ? "light" : "dark");
  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const resize = () => setCompact(query.matches);
    query.addEventListener("change", resize);
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { query.removeEventListener("change", resize); observer.disconnect(); };
  }, []);
  const oldFile = useMemo(() => ({ name: "Your draft", contents: original, lang: "text" as const }), [original]);
  // Pierre owns the live new file. Never feed its change events back as props.
  const [newFile] = useState(() => ({ name: "Suggested revision", contents: proposed, lang: "text" as const }));
  const editorOptions = useMemo<EditorOptions<"file-diff", undefined, undefined>>(() => ({
    matchBrackets: false,
    onAttach: (instance) => {
      editor.current = instance;
      // Catch edits made in Draft while this lazy module was loading.
      instance.applyEdits(draftTextEdit(instance.getText(), latestProposed.current));
    },
    onComplete: () => { editor.current = null; },
  }), []);
  const options = useMemo(() => ({
    diffStyle: compact ? "unified" as const : "split" as const,
    themeType: theme, theme: { light: "pierre-light" as const, dark: "pierre-dark" as const },
    disableLineNumbers: true, disableFileHeader: true, diffIndicators: "none" as const,
    disableBackground: true, overflow: "wrap" as const, expandUnchanged: true,
    lineDiffType: "word-alt" as const, maxLineDiffLength: 20000,
    // Stable documented styling entry point; source stays plain text, never HTML.
    unsafeCSS: `[data-diff] { --diffs-bg: var(--surface); --diffs-fg: var(--ink); }
      [data-line-type="change-deletion"] [data-diff-span],
      [data-line][data-line-type="change-deletion"]:not(:has([data-diff-span])) { text-decoration: line-through; }
      [data-line-type="change-addition"] [data-diff-span],
      [data-line][data-line-type="change-addition"]:not(:has([data-diff-span])) { text-decoration: underline; text-underline-offset: 3px; }
      [data-no-newline], [data-gutter-buffer="metadata"] { display: none; }
      [data-line] { padding-block: 3px; }`,
  }), [compact, theme]);
  return <div className="draft-review-comparison">
    <div className="draft-review-column-labels" data-compact={compact}>
      <span>Your draft <small>Read-only original</small></span><span>Suggested revision <small>Click to edit</small></span>
    </div>
    <EditProvider createEditor={createEditor}>
      <MultiFileDiff className="draft-review-diff" oldFile={oldFile} newFile={newFile} options={options} edit editorOptions={editorOptions} onEditChange={(event) => onChange(event.file.contents)} onEditComplete={() => "reject"} />
    </EditProvider>
  </div>;
}
