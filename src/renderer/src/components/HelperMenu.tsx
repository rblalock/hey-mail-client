import { Sparkles, WandSparkles } from "lucide";
import { useEffect, useRef, useState } from "react";
import type { HelperDefinition, HelperId } from "../../../shared/helpers";
import { appSound } from "../sound";
import MorphingIcon from "./MorphingIcon";

export default function HelperMenu({ helpers, onRun, disabled = false }: { helpers: HelperDefinition[]; onRun: (id: HelperId) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  if (!helpers.length) return null;
  return <div ref={root} className="helper-menu" data-helper-controls onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }} onKeyDownCapture={(event) => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); appSound.play("close", "interface"); }
    if (["ArrowDown", "ArrowUp", "j", "k", "Home", "End"].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); event.stopPropagation();
      const items = [...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" || event.key === "k" ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="icon-button" aria-label="Calendar Helpers" aria-haspopup="menu" aria-expanded={open} disabled={disabled} data-tooltip="Helpers" onPointerEnter={() => { setHover(true); appSound.play("hover", "interface", { cooldownMs: 100 }); }} onPointerLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)} onClick={() => { setOpen((value) => !value); appSound.play(open ? "close" : "open", "interface"); }}><MorphingIcon icon={open || hover ? Sparkles : WandSparkles} size={15} /></button>
    {open && <div className="helper-menu-items" role="menu" aria-label="Calendar Helpers">{helpers.map((helper) => <button type="button" role="menuitem" key={helper.id} onClick={() => { close(); onRun(helper.id); }}>{helper.title}</button>)}<small>Active HEY calendars · Ctrl+K</small></div>}
  </div>;
}
