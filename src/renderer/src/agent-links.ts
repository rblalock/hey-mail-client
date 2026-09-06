import type { AgentObjectKind, AgentObjectLink } from "../../shared/contracts";

type NativeRoute = { host: string; path: RegExp; kind: AgentObjectKind; prefix: string };

const NATIVE_ROUTES: NativeRoute[] = [
  { host: "mail", path: /^\/threads\/([^/]+)\/?$/, kind: "mail-thread", prefix: "mail/threads" },
  { host: "mail", path: /^\/drafts\/([^/]+)\/?$/, kind: "draft", prefix: "mail/drafts" },
  { host: "mail", path: /^\/contacts\/([^/]+)\/?$/, kind: "contact", prefix: "mail/contacts" },
  { host: "mail", path: /^\/labels\/([^/]+)\/?$/, kind: "label", prefix: "mail/labels" },
  { host: "mail", path: /^\/collections\/([^/]+)\/?$/, kind: "collection", prefix: "mail/collections" },
  { host: "mail", path: /^\/boxes\/([^/]+)\/?$/, kind: "mailbox", prefix: "mail/boxes" },
  { host: "mail", path: /^\/bundles\/([^/]+)\/?$/, kind: "mail-bundle", prefix: "mail/bundles" },
  { host: "mail", path: /^\/set-aside\/groups\/([^/]+)\/?$/, kind: "set-aside-group", prefix: "mail/set-aside/groups" },
  { host: "calendar", path: /^\/dates\/(\d{4}-\d{2}-\d{2})\/?$/, kind: "calendar-date", prefix: "calendar/dates" },
  { host: "calendar", path: /^\/events\/([^/]+)\/?$/, kind: "calendar-event", prefix: "calendar/events" },
  { host: "calendar", path: /^\/todos\/([^/]+)\/?$/, kind: "calendar-todo", prefix: "calendar/todos" },
  { host: "calendar", path: /^\/habits\/([^/]+)\/?$/, kind: "calendar-habit", prefix: "calendar/habits" },
  { host: "calendar", path: /^\/journal\/([^/]+)\/?$/, kind: "calendar-journal", prefix: "calendar/journal" },
  { host: "calendar", path: /^\/time\/([^/]+)\/?$/, kind: "calendar-time-track", prefix: "calendar/time" },
];

const NATIVE_ROUTE_ALIASES: NativeRoute[] = [
  { host: "threads", path: /^\/([^/]+)\/?$/, kind: "mail-thread", prefix: "mail/threads" },
  { host: "contacts", path: /^\/([^/]+)\/?$/, kind: "contact", prefix: "mail/contacts" },
];

function linkTitle(value: string | undefined, fallback: string): string {
  const title = value?.trim();
  return title && title.length <= 500 ? title : fallback;
}

export function nativeAgentObjectFromHref(href: string, title?: string): AgentObjectLink | undefined {
  try {
    const url = new URL(href);
    if (url.protocol === "https:" && url.hostname === "app.hey.com") {
      const topic = url.pathname.match(/^\/topics\/(\d+)\/?$/);
      if (!topic?.[1]) return undefined;
      const id = topic[1];
      return { kind: "mail-thread", id, title: linkTitle(title, "Email conversation"), deepLink: `hey-agent://mail/threads/${id}` };
    }
    if (url.protocol !== "hey-agent:") return undefined;
    for (const route of [...NATIVE_ROUTES, ...NATIVE_ROUTE_ALIASES]) {
      if (url.hostname !== route.host) continue;
      const match = url.pathname.match(route.path);
      if (!match?.[1]) continue;
      const id = decodeURIComponent(match[1]);
      return { kind: route.kind, id, title: linkTitle(title, route.kind.replaceAll("-", " ")), deepLink: `hey-agent://${route.prefix}/${encodeURIComponent(id)}${url.search}` };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function safeAgentMarkdownUrl(href: string): string {
  if (nativeAgentObjectFromHref(href)) return href;
  try {
    const url = new URL(href);
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) ? href : "";
  } catch {
    return "";
  }
}

export function emailAddressFromMailto(href: string): string | undefined {
  try {
    const url = new URL(href);
    if (url.protocol !== "mailto:") return undefined;
    const address = decodeURIComponent(url.pathname).trim();
    return address && !address.includes(",") ? address : undefined;
  } catch {
    return undefined;
  }
}
