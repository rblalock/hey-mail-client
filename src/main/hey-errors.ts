// HEY 1.7 distinguishes a refused login from temporarily unreadable credentials.
// Prefer its error envelope and exit code to words such as "auth" or "token",
// which also occur in keyring, network and rate-limit errors.
export function isHeyAuthenticationFailure(error: unknown): boolean {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  for (const output of [value.stderr, value.stdout, message]) {
    if (typeof output !== "string") continue;
    try {
      const payload: unknown = JSON.parse(output.trim());
      if (payload && typeof payload === "object" && "ok" in payload && payload.ok === false && "code" in payload && typeof payload.code === "string") {
        return payload.code === "auth";
      }
    } catch { /* A human-readable or process error has no JSON envelope. */ }
  }
  if (typeof value.code === "number") return value.code === 3;
  return /\b(?:not authenticated|authentication required|unauthori[sz]ed|invalid_grant|run:?\s*hey auth login|not (?:logged|signed) in)\b/i.test(message);
}
