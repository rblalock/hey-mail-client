import { ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentObjectLink, ThreadEntry } from "../../../shared/contracts";
import EmailObjectPreviewBridge from "./EmailObjectPreviewBridge";
import SmartObjectLink from "./SmartObjectLink";
import { matchesBindingStep } from "../../../shared/shortcut-binding";

type EmailBodyProps = {
  entry: ThreadEntry;
  onReaderKeyDown?: (event: KeyboardEvent) => void;
  onOpenObject?: (object: AgentObjectLink) => void;
};

const COLLAPSED_EMAIL_HEIGHT = 16_000;
const MAX_EMAIL_HEIGHT = 240_000;

export function emailFrameHeight(contentHeight: number, expanded: boolean): number {
  return Math.min(Math.max(contentHeight + 2, 48), expanded ? MAX_EMAIL_HEIGHT : COLLAPSED_EMAIL_HEIGHT);
}

export function buildEmailDocument(content: string, allowRemote: boolean, presentation: "card" | "document"): string {
  const imagePolicy = allowRemote ? "data: https: http:" : "data: https://app.hey.com https://gopher.hey.com https://camo.githubusercontent.com";
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${imagePolicy}; font-src ${imagePolicy}; base-uri 'none'; form-action 'none'; object-src 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; max-width: 100%; overflow-x: hidden; overflow-y: hidden; background: #fff; color: #202124; }
  body { padding: ${presentation === "card" ? "2px" : "1px"}; overflow-wrap: break-word; font: 14px/1.55 Arial, Helvetica, sans-serif; }
  a { color: #0969da; text-decoration-thickness: .08em; text-underline-offset: .14em; }
  a[href^="mailto:"], a[href^="https://app.hey.com/topics/"] { text-decoration-style: dotted; cursor: pointer; }
  img { max-width: 100%; }
  .email-inline-attachment { max-width: 100%; margin: 1em 0; }
  .email-inline-attachment figcaption { margin-top: .45em; color: #667085; font-size: 12px; }
  table { max-width: 100%; }
  pre { max-width: 100%; overflow-x: auto; white-space: pre-wrap; }
  blockquote { margin-inline: 0; padding-inline-start: 1em; border-inline-start: 2px solid #d0d5dd; }
</style></head><body>${content}</body></html>`;
}

export default function EmailBody({ entry, onReaderKeyDown, onOpenObject }: EmailBodyProps) {
  const [showRemoteContent, setShowRemoteContent] = useState(false);
  const [expandedLongEmail, setExpandedLongEmail] = useState(false);
  const [isLongEmail, setIsLongEmail] = useState(false);
  const [heightLimited, setHeightLimited] = useState(false);
  const [frameLoadRevision, setFrameLoadRevision] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const richContent = showRemoteContent && entry.remoteHtml ? entry.remoteHtml : entry.html;
  const presentation = entry.htmlPresentation ?? "document";
  const srcDoc = richContent ? buildEmailDocument(richContent, showRemoteContent, presentation) : undefined;

  useEffect(() => {
    setExpandedLongEmail(false);
    setIsLongEmail(false);
    setHeightLimited(false);
    if (frameRef.current) frameRef.current.style.height = "48px";
  }, [entry.id, srcDoc]);

  useEffect(() => {
    const frame = frameRef.current;
    const document = frame?.contentDocument;
    if (!frame || !document || !srcDoc) return;
    let animationFrame: number | undefined;
    const measure = () => {
      animationFrame = undefined;
      const bodyHeight = Math.ceil(document.body.getBoundingClientRect().height);
      const contentHeight = Math.max(document.body.scrollHeight, bodyHeight, 48);
      frame.style.height = `${emailFrameHeight(contentHeight, expandedLongEmail)}px`;
      setIsLongEmail((current) => current === (contentHeight > COLLAPSED_EMAIL_HEIGHT) ? current : contentHeight > COLLAPSED_EMAIL_HEIGHT);
      setHeightLimited((current) => current === (contentHeight > MAX_EMAIL_HEIGHT) ? current : contentHeight > MAX_EMAIL_HEIGHT);
    };
    const scheduleMeasure = () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(measure);
    };
    const forwardWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.deltaY === 0) return;
      const reader = frame.closest<HTMLElement>(".thread-scroll");
      if (!reader || reader.scrollHeight <= reader.clientHeight) return;
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? reader.clientHeight : 1;
      event.preventDefault();
      reader.scrollBy({ top: event.deltaY * multiplier });
    };
    const forwardKeyDown = (event: KeyboardEvent) => {
      // Frame events do not bubble into the app. Forward only plain Escape;
      // the normal dialog/preview/reader handlers still decide what closes.
      if (!event.defaultPrevented && matchesBindingStep(event, "escape")) {
        const forwarded = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
        if (!frame.dispatchEvent(forwarded)) event.preventDefault();
      }
      if (!event.defaultPrevented) onReaderKeyDown?.(event);
    };
    document.addEventListener("keydown", forwardKeyDown);
    document.addEventListener("wheel", forwardWheel, { passive: false });
    document.addEventListener("load", scheduleMeasure, true);
    document.addEventListener("error", scheduleMeasure, true);
    document.addEventListener("toggle", scheduleMeasure, true);
    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(document.body);
    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    void document.fonts?.ready.then(scheduleMeasure);
    scheduleMeasure();
    return () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", forwardKeyDown);
      document.removeEventListener("wheel", forwardWheel);
      document.removeEventListener("load", scheduleMeasure, true);
      document.removeEventListener("error", scheduleMeasure, true);
      document.removeEventListener("toggle", scheduleMeasure, true);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, [expandedLongEmail, frameLoadRevision, onReaderKeyDown, srcDoc]);

  if (srcDoc) {
    return <div className={`email-body email-body-rich email-body-rich-${presentation}`}>
      {entry.hasRemoteContent && entry.remoteHtml && <button type="button" className="email-remote-control" aria-pressed={showRemoteContent} onClick={() => setShowRemoteContent((value) => !value)}><ImageOff size={13} /> {showRemoteContent ? "Hide external images" : "External images blocked · Show images"}</button>}
      <iframe
        ref={frameRef}
        className="email-document-frame"
        title={`Email from ${entry.sender.name}`}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        scrolling="no"
        srcDoc={srcDoc}
        onLoad={() => setFrameLoadRevision((value) => value + 1)}
      />
      <EmailObjectPreviewBridge frameRef={frameRef} revision={frameLoadRevision} onOpenObject={onOpenObject} />
      {isLongEmail ? <button type="button" className="email-expand-control" aria-expanded={expandedLongEmail} onClick={() => setExpandedLongEmail((value) => !value)}>{expandedLongEmail ? "Collapse long email" : "Show entire email"}</button> : null}
      {expandedLongEmail && heightLimited ? <p className="email-height-notice">This email is unusually tall. HEY Agent shows the first portion here to keep the reader responsive.</p> : null}
    </div>;
  }

  return <div className="email-body email-markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, ...props }) => <SmartObjectLink href={href} title={typeof children === "string" ? children : undefined} className={props.className} onOpenObject={onOpenObject}>{children}</SmartObjectLink>,
      }}
    >{entry.body || "No readable message content was returned by HEY."}</ReactMarkdown>
  </div>;
}
