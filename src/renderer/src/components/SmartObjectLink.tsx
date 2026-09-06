import type { ReactNode } from "react";
import type { AgentObjectLink, MailContact } from "../../../shared/contracts";
import { resolveAgentContactByEmail } from "../agent-object-preview";
import { emailAddressFromMailto, nativeAgentObjectFromHref } from "../agent-links";
import AgentObjectPreview from "./AgentObjectPreview";

type SmartObjectLinkProps = {
  href?: string;
  title?: string;
  className?: string;
  children: ReactNode;
  onOpenObject?: (object: AgentObjectLink) => void;
};

function classes(...values: Array<string | undefined>): string | undefined {
  const value = values.filter(Boolean).join(" ");
  return value || undefined;
}

export default function SmartObjectLink({ href, title, className, children, onOpenObject }: SmartObjectLinkProps) {
  const object = href ? nativeAgentObjectFromHref(href, title) : undefined;
  if (object) return <AgentObjectPreview object={object} onOpen={onOpenObject} className={classes(className, "agent-smart-object-link")}>{children}</AgentObjectPreview>;
  const email = href ? emailAddressFromMailto(href) : undefined;
  if (email) return <AgentObjectPreview
    resolveObject={() => resolveAgentContactByEmail(email, title ?? email, window.heyAgent)}
    fallbackHref={href}
    onOpen={onOpenObject}
    className={classes(className, "agent-smart-object-link")}
  >{children}</AgentObjectPreview>;
  return <a className={className} href={href} onClick={(event) => {
    event.preventDefault();
    if (href) void window.heyAgent.system.openExternalUrl(href);
  }}>{children}</a>;
}

export function ContactObjectLink({ contact, children, className, onOpenObject }: {
  contact: MailContact;
  children: ReactNode;
  className?: string;
  onOpenObject?: (object: AgentObjectLink) => void;
}) {
  if (contact.id) {
    const object: AgentObjectLink = {
      kind: "contact",
      id: contact.id,
      title: contact.name,
      subtitle: contact.email,
      deepLink: `hey-agent://mail/contacts/${encodeURIComponent(contact.id)}`,
    };
    return <AgentObjectPreview object={object} onOpen={onOpenObject} className={classes(className, "agent-smart-object-link")}>{children}</AgentObjectPreview>;
  }
  if (contact.email) return <SmartObjectLink href={`mailto:${contact.email}`} title={contact.name} className={className} onOpenObject={onOpenObject}>{children}</SmartObjectLink>;
  return <span className={className}>{children}</span>;
}
