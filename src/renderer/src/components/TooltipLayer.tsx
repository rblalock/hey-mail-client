import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ShortcutContext } from "../shortcut-context";

type Side = "top" | "right" | "bottom" | "left";
type Tooltip = { element: HTMLElement; label: string; shortcut?: string; side: Side };
const ID = "hey-action-tooltip";
const GAP = 8;

export function tooltipPosition(rect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">, width: number, height: number, viewportWidth: number, viewportHeight: number, preferred: Side) {
  let side = preferred;
  if (side === "bottom" && rect.bottom + GAP + height > viewportHeight) side = "top";
  else if (side === "top" && rect.top - GAP - height < 0) side = "bottom";
  else if (side === "right" && rect.right + GAP + width > viewportWidth) side = "left";
  else if (side === "left" && rect.left - GAP - width < 0) side = "right";
  const x = side === "left" ? rect.left - GAP - width : side === "right" ? rect.right + GAP : rect.left + (rect.width - width) / 2;
  const y = side === "top" ? rect.top - GAP - height : side === "bottom" ? rect.bottom + GAP : rect.top + (rect.height - height) / 2;
  return { left: Math.max(GAP, Math.min(x, viewportWidth - width - GAP)), top: Math.max(GAP, Math.min(y, viewportHeight - height - GAP)) };
}

export default function TooltipLayer() {
  const shortcuts = useContext(ShortcutContext);
  const [tooltip, setTooltip] = useState<Tooltip>();
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const tipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!tooltip || !tipRef.current) return;
    const { width, height } = tipRef.current.getBoundingClientRect();
    setPosition(tooltipPosition(tooltip.element.getBoundingClientRect(), width, height, innerWidth, innerHeight, tooltip.side));
  }, [tooltip]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: HTMLElement | undefined;
    let visible = false;
    const observer = new MutationObserver(() => clear());
    const cancelTimer = () => { if (timer) clearTimeout(timer); timer = undefined; };
    const clear = () => {
      cancelTimer();
      observer.disconnect();
      if (active) {
        const ids = (active.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id && id !== ID);
        if (ids.length) active.setAttribute("aria-describedby", ids.join(" ")); else active.removeAttribute("aria-describedby");
      }
      active = undefined; visible = false; setTooltip(undefined);
    };
    const target = (eventTarget: EventTarget | null) => eventTarget instanceof Element ? eventTarget.closest<HTMLElement>("[data-tooltip]") : null;
    const schedule = (element: HTMLElement, focus = false) => {
      if (active === element && visible) { cancelTimer(); return; }
      if (active === element && timer) return;
      clear(); active = element;
      timer = setTimeout(() => {
        if (!element.isConnected) { clear(); return; }
        timer = undefined; visible = true;
        observer.observe(element, { attributes: true, attributeFilter: ["disabled", "aria-disabled", "data-tooltip", "data-shortcut", "data-shortcut-id"] });
        const disabled = element.matches(":disabled, [aria-disabled=true]");
        const shortcut = element.dataset.shortcutId ? shortcuts.find((item) => item.id === element.dataset.shortcutId)?.display : element.dataset.shortcut;
        const ids = new Set((element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)); ids.add(ID);
        element.setAttribute("aria-describedby", [...ids].join(" "));
        setTooltip({ element, label: `${element.dataset.tooltip ?? element.getAttribute("aria-label") ?? ""}${disabled ? " — unavailable right now" : ""}`, shortcut: disabled ? undefined : shortcut, side: (element.dataset.tooltipSide as Side) ?? "bottom" });
      }, focus ? 80 : 550);
    };
    const over = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(`#${ID}`)) { cancelTimer(); return; }
      const element = target(event.target); if (element) schedule(element);
    };
    const out = (event: PointerEvent) => {
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (next && (active?.contains(next) || tipRef.current?.contains(next))) return;
      if (active?.contains(document.activeElement)) return;
      cancelTimer(); timer = setTimeout(clear, 180);
    };
    const focus = (event: FocusEvent) => { const element = target(event.target); if (element) schedule(element, true); else clear(); };
    const blur = () => clear();
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && visible) { event.preventDefault(); event.stopImmediatePropagation(); clear(); }
      else if (event.key !== "Tab" && event.key !== "Shift") clear();
    };
    document.addEventListener("pointerover", over); document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus); document.addEventListener("focusout", blur);
    window.addEventListener("keydown", key, true); window.addEventListener("scroll", clear, true); window.addEventListener("resize", clear);
    return () => {
      clear(); document.removeEventListener("pointerover", over); document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus); document.removeEventListener("focusout", blur);
      window.removeEventListener("keydown", key, true); window.removeEventListener("scroll", clear, true); window.removeEventListener("resize", clear);
    };
  }, [shortcuts]);
  return tooltip ? <div id={ID} ref={tipRef} className="app-tooltip" role="tooltip" style={position}><span>{tooltip.label}</span>{tooltip.shortcut && <kbd>{tooltip.shortcut}</kbd>}</div> : null;
}
