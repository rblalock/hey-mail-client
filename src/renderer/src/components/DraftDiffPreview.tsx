import { MultiFileDiff } from "@pierre/diffs/react";
import { useEffect, useMemo, useState } from "react";

export default function DraftDiffPreview({ original, proposed }: { original: string; proposed: string }) {
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
  const newFile = useMemo(() => ({ name: "Suggested revision", contents: proposed, lang: "text" as const }), [proposed]);
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
      <span>Your draft <small>Removed wording</small></span><span>Suggested revision <small>Added wording</small></span>
    </div>
    <MultiFileDiff className="draft-review-diff" oldFile={oldFile} newFile={newFile} options={options} />
  </div>;
}
