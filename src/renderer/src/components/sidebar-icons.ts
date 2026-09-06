import {
  Calendar,
  CalendarDays,
  Circle,
  CircleArrowUp,
  Clock,
  ClockArrowUp,
  Clock3,
  Contact,
  ContactRound,
  File,
  FilePenLine,
  FileText,
  Inbox,
  MailClock,
  MailOpen,
  MailPlus,
  Newspaper,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  ReceiptText,
  ScrollText,
  Settings,
  Settings2,
  Send,
  ThumbsUp,
  UserRoundSearch,
} from "lucide";
import type { IconInput } from "morphicons/react";

export type SidebarIconKey =
  | "compose"
  | "drafts"
  | "imbox"
  | "feed"
  | "paper-trail"
  | "reply-later"
  | "set-aside"
  | "bubble-up"
  | "screener"
  | "calendar"
  | "library"
  | "settings";

const SIDEBAR_ICON_PAIRS = {
  compose: [MailPlus, Send],
  drafts: [File, FilePenLine],
  imbox: [Inbox, MailOpen],
  feed: [FileText, Newspaper],
  "paper-trail": [ReceiptText, ScrollText],
  "reply-later": [MailClock, ClockArrowUp],
  "set-aside": [Clock, Clock3],
  "bubble-up": [Circle, CircleArrowUp],
  screener: [UserRoundSearch, ThumbsUp],
  calendar: [Calendar, CalendarDays],
  library: [Contact, ContactRound],
  settings: [Settings, Settings2],
} satisfies Record<SidebarIconKey, readonly [IconInput, IconInput]>;

export function sidebarItemIcon(key: SidebarIconKey, engaged: boolean): IconInput {
  return SIDEBAR_ICON_PAIRS[key][engaged ? 1 : 0];
}

export function navigationRailIcon(collapsed: boolean, preview: boolean): IconInput {
  if (!preview) return PanelLeft;
  return collapsed ? PanelLeftOpen : PanelLeftClose;
}

export function agentRailIcon(open: boolean, preview: boolean): IconInput {
  if (!preview) return PanelRight;
  return open ? PanelRightClose : PanelRightOpen;
}
