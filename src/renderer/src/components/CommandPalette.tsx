import { Command, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ShortcutDefinition, ShortcutId } from "../shortcuts";
import { isTopmostDialogScrim } from "../dialog-stack";
import { helperIdFromCommand } from "../../../shared/helpers";

type CommandPaletteProps = {
  commands: ShortcutDefinition[];
  onRun: (id: ShortcutId) => void;
  onClose: () => void;
};

export function nextCommandIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
}

export function filterCommands(commands: ShortcutDefinition[], query: string): ShortcutDefinition[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return commands;
  return commands.map((command, index) => {
    const label = command.label.toLowerCase();
    const words = label.split(/\s+/);
    const rank = label.startsWith(normalized) ? 0
      : words.some((word) => word.startsWith(normalized)) ? 1
      : label.includes(normalized) ? 2
      : command.display.toLowerCase().includes(normalized) ? 3
      : helperIdFromCommand(command.id) && "helpers".includes(normalized) ? 3
      : 4;
    return { command, index, rank };
  }).filter(({ rank }) => rank < 4).sort((left, right) => left.rank - right.rank || left.index - right.index).map(({ command }) => command);
}

export default function CommandPalette({ commands, onRun, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => filterCommands(commands, query), [commands, query]);
  const activeIndex = visible.length > 0 ? Math.min(active, visible.length - 1) : 0;

  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  useEffect(() => {
    const keepFocus = (event: FocusEvent) => {
      if (!isTopmostDialogScrim(scrim.current) || scrim.current?.contains(event.target as Node)) return;
      event.stopImmediatePropagation();
      input.current?.focus();
    };
    window.addEventListener("focusin", keepFocus, true);
    return () => window.removeEventListener("focusin", keepFocus, true);
  }, []);
  useEffect(() => {
    const option = results.current?.querySelector<HTMLElement>(`[data-command-index="${activeIndex}"]`);
    option?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const move = (delta: number) => {
    if (visible.length === 0) return;
    input.current?.focus();
    setActive((index) => nextCommandIndex(index, delta, visible.length));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostDialogScrim(scrim.current)) return;
      const targetIsInput = event.target === input.current;
      const plainKey = !event.ctrlKey && !event.metaKey && !event.altKey;
      if (!targetIsInput && plainKey && event.key.length === 1 && event.key !== " ") {
        event.preventDefault(); event.stopImmediatePropagation(); input.current?.focus(); setActive(0); setQuery((value) => value + event.key); return;
      }
      if (!targetIsInput && plainKey && event.key === "Backspace") {
        event.preventDefault(); event.stopImmediatePropagation(); input.current?.focus(); setActive(0); setQuery((value) => value.slice(0, -1)); return;
      }
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); return; }
      if (event.key === "ArrowDown" || event.key === "Tab" && !event.shiftKey) { event.preventDefault(); event.stopImmediatePropagation(); move(1); return; }
      if (event.key === "ArrowUp" || event.key === "Tab" && event.shiftKey) { event.preventDefault(); event.stopImmediatePropagation(); move(-1); return; }
      if (event.key === "Home") { event.preventDefault(); event.stopImmediatePropagation(); input.current?.focus(); setActive(0); return; }
      if (event.key === "End" && visible.length) { event.preventDefault(); event.stopImmediatePropagation(); input.current?.focus(); setActive(visible.length - 1); return; }
      if (event.key === "PageDown" && visible.length) { event.preventDefault(); event.stopImmediatePropagation(); input.current?.focus(); setActive((value) => Math.min(value + 8, visible.length - 1)); return; }
      if (event.key === "PageUp" && visible.length) { event.preventDefault(); event.stopImmediatePropagation(); input.current?.focus(); setActive((value) => Math.max(value - 8, 0)); return; }
      const internalButton = event.target instanceof Element ? event.target.closest("button") : null;
      if (event.key === "Enter" && visible[activeIndex] && (!internalButton || internalButton.hasAttribute("data-command-index") || !scrim.current?.contains(internalButton))) {
        event.preventDefault(); event.stopImmediatePropagation(); onRun(visible[activeIndex]!.id);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeIndex, onClose, onRun, visible]);

  return (
    <div ref={scrim} className="dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="HEY Agent commands" onMouseDown={(event) => {
        if ((event.target as Element).closest("input, button")) return;
        requestAnimationFrame(() => input.current?.focus());
      }}>
        <header className="command-search">
          <Command size={16} />
          <input id="command-palette-input" ref={input} autoFocus value={query} onChange={(event) => { setActive(0); setQuery(event.target.value); }} placeholder="Type a command" aria-label="Search commands" aria-controls="command-results" aria-activedescendant={visible[activeIndex] ? `command-${visible[activeIndex]!.id}` : undefined} />
          <button type="button" className="icon-button" aria-label="Close commands" onClick={onClose}><X size={15} /></button>
        </header>
        <div ref={results} className="command-results" id="command-results" role="listbox" aria-label="Available commands">
          {visible.map((command, index) => (
            <button id={`command-${command.id}`} data-command-index={index} key={command.id} type="button" role="option" tabIndex={-1} aria-selected={index === activeIndex} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => onRun(command.id)}>
              <span className="command-label">{command.label}</span>
              <span className="command-metadata">
                {helperIdFromCommand(command.id) && <span className="command-kind">Helper</span>}
                {command.display && <kbd>{command.display}</kbd>}
              </span>
            </button>
          ))}
          {visible.length === 0 && <p>No matching commands</p>}
        </div>
        <footer className="command-hints"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></footer>
      </section>
    </div>
  );
}
