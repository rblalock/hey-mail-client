import { describe, expect, it } from "vitest";
import { contactIdentityKey, contactInitials, enrichContactAvatar } from "./contact-avatar";

describe("contact avatars", () => {
  it("prefers HEY initials and otherwise derives a compact fallback", () => {
    expect(contactInitials({ name: "Alex Example", initials: "AX" })).toBe("AX");
    expect(contactInitials({ name: "Alex Example" })).toBe("AE");
    expect(contactInitials({ name: "", email: "mailbox@example.test" })).toBe("M");
  });

  it("enriches thread identities only by stable contact id or email", () => {
    const candidates = [{ id: "7", name: "Relay Contact", email: "relay@example.test", avatarUrl: "https://app.hey.com/avatar.svg", initials: "RC" }];
    expect(enrichContactAvatar({ id: "7", name: "Alex Example" }, candidates)).toMatchObject({ name: "Alex Example", avatarUrl: "https://app.hey.com/avatar.svg", initials: "RC" });
    expect(enrichContactAvatar({ name: "Alex Example", email: "RELAY@example.test" }, candidates)).toMatchObject({ avatarUrl: "https://app.hey.com/avatar.svg" });
    expect(enrichContactAvatar({ name: "Relay Contact" }, candidates)).toEqual({ name: "Relay Contact" });
  });

  it("uses stable identity keys for participant de-duplication", () => {
    expect(contactIdentityKey({ id: "7", name: "Alex Example" })).toBe("id:7");
    expect(contactIdentityKey({ name: "Alex Example", email: "ALEX@example.test" })).toBe("email:alex@example.test");
  });
});
