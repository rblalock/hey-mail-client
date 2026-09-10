import { describe, expect, it } from "vitest";
import { applyExplicitSenderName, mailContactFrom, resolveMailSender } from "./mail-identity";

describe("canonical HEY mail identity", () => {
  it("uses HEY's explicit alternative actor ahead of relay and summary inference", () => {
    const sender = resolveMailSender({
      creator: { name: "Notification Relay", email_address: "relay@example.com", contactable_type: "Service" },
      alternative_sender_name: "Taylor Example",
    }, { summary: "Different Example left a comment" });

    expect(sender).toEqual({ name: "Taylor Example", email: "relay@example.com", kind: "Service" });
  });

  it("preserves the actual User author instead of substituting a recipient", () => {
    const sender = resolveMailSender({
      creator: { name: "Account Owner", email_address: "owner@example.com", contactable_type: "User" },
    }, { fallback: { name: "External Sender", email: "external@example.com", kind: "Person" } });

    expect(sender).toEqual({ name: "Account Owner", email: "owner@example.com", kind: "User" });
  });

  it("retains the external fallback when HEY explicitly names a different actor", () => {
    expect(resolveMailSender({ creator: { name: "Account Owner", contactable_type: "User" }, alternative_sender_name: "Build Bot" }, {
      fallback: { name: "Relay", email: "relay@example.test" },
    })).toEqual({ name: "Build Bot", email: "relay@example.test" });
  });

  it("falls back to known notification and invitation grammars only when HEY has no explicit actor", () => {
    expect(resolveMailSender({ contact: { name: "Relay", email_address: "relay@example.com" } }, {
      summary: "build-agent[bot] left a comment on the pull request",
    }).name).toBe("build-agent[bot]");
    expect(resolveMailSender({}, {
      fallback: { name: "Referenced Contact", email: "relay@example.com" },
      subject: "You have an invitation",
      summary: "Taylor Example, Product lead is waiting for your response",
    }).name).toBe("Taylor Example");
  });

  it("applies rich HTML sender metadata without losing the normalized address", () => {
    const sender = applyExplicitSenderName(mailContactFrom({ name: "Relay", email_address: "relay@example.com" }), "Taylor Example");
    expect(sender).toEqual({ name: "Taylor Example", email: "relay@example.com" });
  });

  it("always returns a display-safe identity", () => {
    expect(resolveMailSender({})).toEqual({ name: "Unknown sender" });
  });

  it("preserves HEY avatar metadata and rejects third-party image URLs", () => {
    expect(mailContactFrom({
      id: 7,
      name: "Alex Example",
      email_address: "alex@example.test",
      avatar_url: "https://app.hey.com/rails/active_storage/avatar.svg",
      avatar_background_color: "#345678",
      initials: "AE",
    })).toEqual({
      id: "7",
      name: "Alex Example",
      email: "alex@example.test",
      avatarUrl: "https://app.hey.com/rails/active_storage/avatar.svg",
      avatarBackgroundColor: "#345678",
      initials: "AE",
    });

    expect(mailContactFrom({ name: "Tracker", avatar_url: "https://tracking.example/pixel.gif" })).toEqual({ name: "Tracker" });
  });
});
