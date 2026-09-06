import { CalendarDays, Contact, ExternalLink, FileText, Mail, type LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { AgentObjectLink } from "../../../shared/contracts";
import { createLazyAgentObjectResolver, loadAgentObjectPreview, resolveLazyAgentObjectAction, type AgentObjectPreview as PreviewData } from "../agent-object-preview";

type AgentObjectPreviewProps = {
  object?: AgentObjectLink;
  resolveObject?: () => Promise<AgentObjectLink | undefined>;
  fallbackHref?: string;
  onOpen?: (object: AgentObjectLink) => void;
  children: ReactNode;
  variant?: "link" | "button";
  className?: string;
};

export type AgentObjectPreviewPosition = { left: number; top: number; side: "above" | "below" };
export type AgentObjectPreviewRect = { left: number; top: number; right: number; bottom: number; width: number };

export function dismissObjectPreviewOnEscape(event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopImmediatePropagation">, close: () => void): boolean {
  if (event.key !== "Escape") return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  close();
  return true;
}

function iconFor(kind: AgentObjectLink["kind"]): LucideIcon {
  if (kind.startsWith("calendar-")) return CalendarDays;
  if (kind === "mail-thread" || kind === "mail-bundle" || kind === "mailbox") return Mail;
  if (kind === "contact") return Contact;
  return FileText;
}

function destination(kind: AgentObjectLink["kind"]): string {
  if (kind.startsWith("calendar-")) return "Calendar";
  if (kind === "contact" || kind === "collection" || kind === "label") return "Library";
  if (kind === "draft") return "Drafts";
  return "Mail";
}

export function positionAgentObjectPreview(rect: AgentObjectPreviewRect, viewportWidth: number, viewportHeight: number): AgentObjectPreviewPosition {
  const width = Math.min(340, viewportWidth - 24);
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), viewportWidth - width - 12);
  const below = viewportHeight - rect.bottom >= 230 || rect.top < 230;
  return { left, top: below ? rect.bottom + 8 : rect.top - 8, side: below ? "below" : "above" };
}

export function AgentObjectPreviewCard({ data, position, id }: { data?: PreviewData; position: AgentObjectPreviewPosition; id: string }) {
  const Icon = data ? iconFor(data.kind) : FileText;
  return <aside id={id} className="agent-object-preview" data-side={position.side} data-state={data?.state} role="tooltip" style={{ left: position.left, top: position.top }}>
    {!data ? <div className="agent-object-preview-loading"><span /><span /><span /></div> : <>
      <header><span><Icon size={14} /></span><small>{data.label}</small></header>
      <strong>{data.title}</strong>
      {data.meta && <p className="agent-object-preview-meta">{data.meta}</p>}
      {data.detail && <p>{data.detail}</p>}
      {data.items && data.items.length > 0 && <ul>{data.items.map((item) => <li key={item}>{item}</li>)}</ul>}
      <footer>{data.state === "unavailable" ? "Open to try again" : `Open in ${destination(data.kind)}`}<ExternalLink size={11} /></footer>
    </>}
  </aside>;
}

function positionFor(anchor: HTMLElement): AgentObjectPreviewPosition {
  return positionAgentObjectPreview(anchor.getBoundingClientRect(), window.innerWidth, window.innerHeight);
}

export default function AgentObjectPreview({ object, resolveObject, fallbackHref, onOpen, children, variant = "link", className }: AgentObjectPreviewProps) {
  const id = useId();
  const anchorRef = useRef<HTMLElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mounted = useRef(true);
  const lazyResolver = useRef(createLazyAgentObjectResolver());
  const sourceKey = object?.deepLink ?? fallbackHref ?? "";
  const sourceKeyRef = useRef("");
  if (sourceKeyRef.current !== sourceKey) {
    sourceKeyRef.current = sourceKey;
    lazyResolver.current.setKey(sourceKey);
  }
  const [openFor, setOpenFor] = useState<string>();
  const [position, setPosition] = useState<AgentObjectPreviewPosition>();
  const [preview, setPreview] = useState<{ key: string; data: PreviewData }>();
  const open = openFor === sourceKey;
  const data = preview?.key === sourceKey ? preview.data : undefined;
  const resolution = lazyResolver.current.peek(sourceKey);
  const resolvedObject = object ?? (resolution?.state === "hit" ? resolution.object : undefined);

  const targetObject = () => {
    if (object) return Promise.resolve(object);
    if (!resolveObject) return Promise.resolve(undefined);
    return lazyResolver.current.resolve(sourceKey, resolveObject);
  };

  const show = (immediate = false) => {
    const key = sourceKey;
    clearTimeout(closeTimer.current);
    clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      if (!mounted.current || !anchorRef.current || sourceKeyRef.current !== key) return;
      setPosition(positionFor(anchorRef.current));
      setOpenFor(key);
      void targetObject().then((target) => {
        if (!mounted.current || sourceKeyRef.current !== key) return;
        if (!target) { setOpenFor(undefined); return; }
        return loadAgentObjectPreview(target).then((next) => {
          if (mounted.current && sourceKeyRef.current === key) setPreview({ key, data: next });
        });
      });
    }, immediate ? 0 : 220);
  };
  const hide = () => {
    const key = sourceKey;
    clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => {
      if (mounted.current && sourceKeyRef.current === key) setOpenFor(undefined);
    }, 90);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    };
  }, []);
  useEffect(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }, [sourceKey]);
  useEffect(() => {
    if (!open) return;
    const reposition = () => anchorRef.current && setPosition(positionFor(anchorRef.current));
    const escape = (event: KeyboardEvent) => { dismissObjectPreviewOnEscape(event, () => setOpenFor(undefined)); };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); window.removeEventListener("keydown", escape, true); };
  }, [open]);

  const shared = {
    ref: (node: HTMLElement | null) => { anchorRef.current = node; },
    className,
    "aria-describedby": open ? id : undefined,
    onPointerEnter: () => show(),
    onPointerLeave: hide,
    onFocus: () => show(true),
    onBlur: hide,
    onClick: (event: ReactMouseEvent) => {
      event.preventDefault();
      const target = object ?? resolvedObject;
      if (target) { setOpenFor(undefined); onOpen?.(target); return; }
      const key = sourceKey;
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
      if (anchorRef.current) setPosition(positionFor(anchorRef.current));
      setOpenFor(key);
      void resolveLazyAgentObjectAction(
        targetObject,
        () => mounted.current && sourceKeyRef.current === key,
        (value) => { setOpenFor(undefined); onOpen?.(value); },
        () => {
          setOpenFor(undefined);
          if (fallbackHref) void window.heyAgent.system.openExternalUrl(fallbackHref);
        },
      );
    },
  };
  return <>
    {variant === "button"
      ? <button type="button" {...shared}>{children}</button>
      : <a href={object?.deepLink ?? resolvedObject?.deepLink ?? fallbackHref} {...shared}>{children}</a>}
    {open && position && createPortal(<AgentObjectPreviewCard data={data} position={position} id={id} />, document.body)}
  </>;
}
