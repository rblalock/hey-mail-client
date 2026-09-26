import { describe, expect, it } from "vitest";
import { isHeyAuthenticationFailure } from "./hey-errors";

describe("HEY authentication errors", () => {
  it.each(["Not authenticated", "Authentication required", "Unauthorized", "invalid_grant", "Run: hey auth login", "Not signed in"])("recognizes an explicit authentication failure: %s", (message) => {
    expect(isHeyAuthenticationFailure(new Error(message))).toBe(true);
  });
  it.each(["keyring: credentials unavailable", "failed to load auth token: secret service locked", "authentication refresh temporarily rate limited", "token refresh failed: network timeout", "Forbidden"])("does not turn a transient or permission error into signed-out state: %s", (message) => {
    expect(isHeyAuthenticationFailure(new Error(message))).toBe(false);
  });
  it("prefers CLI exit codes to generic process messages", () => {
    expect(isHeyAuthenticationFailure(Object.assign(new Error("command failed"), { code: 3 }))).toBe(true);
    expect(isHeyAuthenticationFailure(Object.assign(new Error("unauthorized service proxy"), { code: 1 }))).toBe(false);
  });
  it("prefers the structured envelope over text and recognizes stderr output", () => {
    expect(isHeyAuthenticationFailure(Object.assign(new Error("command failed"), { stderr: JSON.stringify({ ok: false, code: "auth", error: "Refresh refused" }) }))).toBe(true);
    expect(isHeyAuthenticationFailure(Object.assign(new Error("Run hey auth login"), { stderr: JSON.stringify({ ok: false, code: "internal", error: "Keyring temporarily unavailable" }) }))).toBe(false);
    expect(isHeyAuthenticationFailure(JSON.stringify({ ok: false, code: "auth", error: "Refresh refused" }))).toBe(true);
    expect(isHeyAuthenticationFailure(null)).toBe(false);
  });
});
