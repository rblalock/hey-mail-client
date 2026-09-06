import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentObjectLink } from "../../../shared/contracts";
import { safeAgentMarkdownUrl } from "../agent-links";
import SmartObjectLink from "./SmartObjectLink";

type AgentMarkdownProps = {
  text: string;
  streaming?: boolean;
  onOpenObject?: (object: AgentObjectLink) => void;
};

const MARKDOWN_PLUGINS = [remarkGfm];
const DISALLOWED_ELEMENTS = ["img"];
function AgentMarkdown({ text, streaming = false, onOpenObject }: AgentMarkdownProps) {
  const components = useMemo<Components>(() => ({
    a: ({ node: _node, href, children, ...props }) => {
      return <SmartObjectLink href={href} title={typeof children === "string" ? children : undefined} className={props.className} onOpenObject={onOpenObject}>{children}</SmartObjectLink>;
    },
    table: ({ node: _node, children, ...props }) => <div className="agent-markdown-table"><table {...props}>{children}</table></div>,
  }), [onOpenObject]);
  return <div className="agent-markdown" data-streaming={streaming || undefined}>
    <ReactMarkdown
      remarkPlugins={MARKDOWN_PLUGINS}
      skipHtml
      disallowedElements={DISALLOWED_ELEMENTS}
      components={components}
      urlTransform={safeAgentMarkdownUrl}
    >{text}</ReactMarkdown>
  </div>;
}

export default memo(AgentMarkdown);
