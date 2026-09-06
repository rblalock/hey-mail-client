import { describe, expect, it } from "vitest";
import { ClockArrowUp, Inbox, MailClock, MailOpen, MailPlus, PanelLeft, PanelLeftClose, PanelLeftOpen, PanelRight, PanelRightClose, PanelRightOpen, ReceiptText, ScrollText, Send } from "lucide";
import { agentRailIcon, navigationRailIcon, sidebarItemIcon } from "./sidebar-icons";

describe("sidebar morph icon states", () => {
  it("keeps destination icons engaged after selection", () => {
    expect(sidebarItemIcon("imbox", false)).toBe(Inbox);
    expect(sidebarItemIcon("imbox", true)).toBe(MailOpen);
  });

  it("gives the three mail actions distinct resting and engaged silhouettes", () => {
    expect(sidebarItemIcon("compose", false)).toBe(MailPlus);
    expect(sidebarItemIcon("compose", true)).toBe(Send);
    expect(sidebarItemIcon("reply-later", false)).toBe(MailClock);
    expect(sidebarItemIcon("reply-later", true)).toBe(ClockArrowUp);
    expect(new Set([
      sidebarItemIcon("compose", false),
      sidebarItemIcon("imbox", false),
      sidebarItemIcon("reply-later", false),
    ]).size).toBe(3);
  });

  it("keeps Paper Trail receipt-shaped in both states", () => {
    expect(sidebarItemIcon("paper-trail", false)).toBe(ReceiptText);
    expect(sidebarItemIcon("paper-trail", true)).toBe(ScrollText);
  });

  it("previews the navigation rail action only while hovered or focused", () => {
    expect(navigationRailIcon(false, false)).toBe(PanelLeft);
    expect(navigationRailIcon(false, true)).toBe(PanelLeftClose);
    expect(navigationRailIcon(true, true)).toBe(PanelLeftOpen);
  });

  it("previews the agent rail action only while hovered or focused", () => {
    expect(agentRailIcon(true, false)).toBe(PanelRight);
    expect(agentRailIcon(true, true)).toBe(PanelRightClose);
    expect(agentRailIcon(false, true)).toBe(PanelRightOpen);
  });
});
