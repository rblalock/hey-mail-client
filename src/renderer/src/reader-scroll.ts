export type ReaderScrollIntent = { kind: "by" | "to"; top: number };

export function readerScrollIntent(key: string, shiftKey: boolean, clientHeight: number, scrollHeight: number): ReaderScrollIntent | undefined {
  const page = Math.max(120, clientHeight * 0.85);
  if (key === "ArrowDown") return { kind: "by", top: 52 };
  if (key === "ArrowUp") return { kind: "by", top: -52 };
  if (key === "PageDown" || key === " ") return { kind: "by", top: shiftKey ? -page : page };
  if (key === "PageUp") return { kind: "by", top: -page };
  if (key === "Home") return { kind: "to", top: 0 };
  if (key === "End") return { kind: "to", top: scrollHeight };
  return undefined;
}
