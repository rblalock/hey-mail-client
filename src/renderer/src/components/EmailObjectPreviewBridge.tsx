import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import type { AgentObjectLink } from "../../../shared/contracts";
import { loadAgentObjectPreview, resolveAgentContactByEmail, type AgentObjectPreview as PreviewData } from "../agent-object-preview";
import { emailAddressFromMailto, nativeAgentObjectFromHref } from "../agent-links";
import { AgentObjectPreviewCard, positionAgentObjectPreview, type AgentObjectPreviewPosition, type AgentObjectPreviewRect } from "./AgentObjectPreview";

type Candidate = {
  href: string;
  title: string;
  object?: AgentObjectLink;
  email?: string;
};

function candidateFor(anchor: HTMLAnchorElement): Candidate | undefined {
  const href = anchor.getAttribute("href") ?? "";
  const title = anchor.textContent?.trim() || href;
  const object = nativeAgentObjectFromHref(href, title);
  if (object) return { href, title, object };
  const email = emailAddressFromMailto(href);
  return email ? { href, title, email } : undefined;
}

export function iframeAnchorRect(frame: AgentObjectPreviewRect, anchor: AgentObjectPreviewRect): AgentObjectPreviewRect {
  return {
    left: frame.left + anchor.left,
    top: frame.top + anchor.top,
    right: frame.left + anchor.right,
    bottom: frame.top + anchor.bottom,
    width: anchor.width,
  };
}

async function resolveCandidate(candidate: Candidate): Promise<AgentObjectLink | undefined> {
  if (candidate.object) return candidate.object;
  if (!candidate.email) return undefined;
  return resolveAgentContactByEmail(candidate.email, candidate.title, window.heyAgent);
}

export default function EmailObjectPreviewBridge({ frameRef, revision, onOpenObject }: {
  frameRef: RefObject<HTMLIFrameElement | null>;
  revision: number;
  onOpenObject?: (object: AgentObjectLink) => void;
}) {
  const id = useId();
  const onOpenRef = useRef(onOpenObject);
  onOpenRef.current = onOpenObject;
  const sequence = useRef(0);
  const overlayOpen = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [overlay, setOverlayState] = useState<{ position: AgentObjectPreviewPosition; data?: PreviewData }>();
  const setOverlay = useCallback((value: { position: AgentObjectPreviewPosition; data?: PreviewData } | undefined) => {
    overlayOpen.current = Boolean(value);
    setOverlayState(value);
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    const document = frame?.contentDocument;
    if (!frame || !document) return;
    setOverlay(undefined);

    const clearTimers = () => { clearTimeout(openTimer.current); clearTimeout(closeTimer.current); };
    const anchorFrom = (target: EventTarget | null) => {
      const element = target as Element | null;
      return typeof element?.closest === "function" ? element.closest<HTMLAnchorElement>("a[href]") : null;
    };
    const positionFor = (anchor: HTMLAnchorElement) => positionAgentObjectPreview(
      iframeAnchorRect(frame.getBoundingClientRect(), anchor.getBoundingClientRect()),
      window.innerWidth,
      window.innerHeight,
    );
    const close = () => {
      sequence.current += 1;
      clearTimers();
      setOverlay(undefined);
    };
    const show = (anchor: HTMLAnchorElement, immediate = false) => {
      const candidate = candidateFor(anchor);
      if (!candidate) return;
      const current = sequence.current + 1;
      sequence.current = current;
      clearTimers();
      openTimer.current = setTimeout(() => {
        if (sequence.current !== current) return;
        setOverlay({ position: positionFor(anchor) });
        void resolveCandidate(candidate).then((object) => {
          if (!object || sequence.current !== current) { if (!object) setOverlay(undefined); return; }
          return loadAgentObjectPreview(object).then((data) => {
            if (sequence.current === current) setOverlay({ position: positionFor(anchor), data });
          });
        });
      }, immediate ? 0 : 220);
    };
    const hide = () => {
      clearTimeout(openTimer.current);
      closeTimer.current = setTimeout(close, 90);
    };
    const mouseOver = (event: MouseEvent) => {
      const anchor = anchorFrom(event.target);
      if (anchor && !anchor.contains(event.relatedTarget as Node | null)) show(anchor);
    };
    const mouseOut = (event: MouseEvent) => {
      const anchor = anchorFrom(event.target);
      if (anchor && !anchor.contains(event.relatedTarget as Node | null)) hide();
    };
    const focusIn = (event: FocusEvent) => { const anchor = anchorFrom(event.target); if (anchor) show(anchor, true); };
    const focusOut = (event: FocusEvent) => { if (anchorFrom(event.target)) hide(); };
    const click = (event: MouseEvent) => {
      const anchor = anchorFrom(event.target);
      if (!anchor) return;
      const candidate = candidateFor(anchor);
      if (!candidate) return;
      event.preventDefault();
      event.stopPropagation();
      const current = sequence.current + 1;
      sequence.current = current;
      clearTimers();
      setOverlay({ position: positionFor(anchor) });
      void resolveCandidate(candidate).then((object) => {
        if (sequence.current !== current) return;
        setOverlay(undefined);
        if (object) onOpenRef.current?.(object);
        else void window.heyAgent.system.openExternalUrl(candidate.href);
      });
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !overlayOpen.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };

    document.addEventListener("mouseover", mouseOver);
    document.addEventListener("mouseout", mouseOut);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    document.addEventListener("click", click);
    document.addEventListener("keydown", keyDown, true);
    window.addEventListener("keydown", keyDown, true);
    return () => {
      clearTimers();
      sequence.current += 1;
      document.removeEventListener("mouseover", mouseOver);
      document.removeEventListener("mouseout", mouseOut);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      document.removeEventListener("click", click);
      document.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keydown", keyDown, true);
    };
  }, [frameRef, revision, setOverlay]);

  return overlay ? createPortal(<AgentObjectPreviewCard id={id} position={overlay.position} data={overlay.data} />, document.body) : null;
}
