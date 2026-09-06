import { EllipsisVertical } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { appSound } from "../sound";
import MorphingIcon from "./MorphingIcon";
import { sidebarItemIcon } from "./sidebar-icons";

export default function ProfileMenu({ onSettings, active, shortcut }: { onSettings: () => void; active: boolean; shortcut?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; bottom: number }>();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      setPosition({ left: Math.max(12, Math.min(rect.right - 200, window.innerWidth - 212)), bottom: window.innerHeight - rect.top + 6 });
    };
    place();
    item.current?.focus();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return <div className="profile-menu" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }} onKeyDown={(event) => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); item.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="icon-button" aria-label="Profile options" aria-haspopup="menu" aria-expanded={open} data-active={active} data-tooltip="Profile options" data-tooltip-side="right" onClick={() => { appSound.play(open ? "close" : "open", "interface"); setOpen(!open); }}><EllipsisVertical size={17} /></button>
    {open && <div className="profile-menu-items" style={position} role="menu" aria-label="Profile options">
      <button ref={item} type="button" role="menuitem" onClick={() => { close(); onSettings(); }}><MorphingIcon icon={sidebarItemIcon("settings", true)} size={17} /><span>Settings</span>{shortcut && <kbd>{shortcut}</kbd>}</button>
    </div>}
  </div>;
}
