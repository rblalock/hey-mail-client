import { load } from "cheerio";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SplitRuleInput, { acceptSplitRuleInput } from "./SplitRuleInput";

vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(), useRef: () => ({ current: null }) }));

const base = { id: "people", kind: "people" as const, entries: ["jamie@example.com"], draft: "", onChange: vi.fn() };

function nativeInput(props = base) {
  const root = SplitRuleInput(props);
  const control = root.props.children[1] as ReactElement<{ children: ReactElement[] }>;
  return control.props.children[1] as ReactElement<{
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    onBlur: () => void;
  }>;
}

describe("split rule entries", () => {
  it("adds comma, newline, and semicolon lists and removes normalized duplicates", () => {
    expect(acceptSplitRuleInput("people", ["jamie@example.com"], "Jamie@Example.com, next@example.com\r\nTHIRD@Example.com; next@example.com")).toEqual({
      entries: ["jamie@example.com", "next@example.com", "third@example.com"], draft: "",
    });
    expect(acceptSplitRuleInput("domains", [], "@COMPANY.COM, company.com, mail.company.com")).toEqual({ entries: ["company.com", "mail.company.com"], draft: "" });
  });

  it("accepts valid pasted entries while retaining each invalid entry for correction", () => {
    expect(acceptSplitRuleInput("people", [], "good@example.com, Broken, second@example.com, bad..name@example.com")).toEqual({
      entries: ["good@example.com", "second@example.com"], draft: "Broken, bad..name@example.com", error: expect.stringContaining("complete email addresses"),
    });
    expect(acceptSplitRuleInput("domains", [], "company.com, *.company.com, https://example.com")).toEqual({
      entries: ["company.com"], draft: "*.company.com, https://example.com", error: expect.stringContaining("without a URL or wildcard"),
    });
  });

  it("keeps an unfinished last entry editable until Enter, paste, or blur commits it", () => {
    expect(acceptSplitRuleInput("people", [], "first@example.com, second@", false)).toEqual({ entries: ["first@example.com"], draft: " second@" });
    expect(acceptSplitRuleInput("people", [], "first@example.com", false)).toEqual({ entries: [], draft: "first@example.com" });
    expect(acceptSplitRuleInput("people", [], "first@example.com,")).toEqual({ entries: ["first@example.com"], draft: "" });
  });

  it("retains entries beyond the limit without counting duplicates against the limit", () => {
    const entries = Array.from({ length: 50 }, (_, index) => `person${index}@example.com`);
    expect(acceptSplitRuleInput("people", entries, "PERSON0@EXAMPLE.COM, extra@example.com")).toEqual({ entries, draft: "extra@example.com", error: "Use at most 50 email addresses per split." });
    const domains = Array.from({ length: 50 }, (_, index) => `team${index}.example.com`);
    expect(acceptSplitRuleInput("domains", domains, "@TEAM0.EXAMPLE.COM, extra.example.com")).toEqual({ entries: domains, draft: "extra.example.com", error: "Use at most 50 domains per split." });
  });
});

describe("split rule input", () => {
  it("associates the field label, help, and error and exposes native removal buttons", () => {
    const $ = load(renderToStaticMarkup(<SplitRuleInput {...base} kind="domains" id="domains" entries={["company.com"]} draft="*.example.com" error="Remove the wildcard." describedBy="rules-help" />));
    expect($("label").attr("for")).toBe("domains");
    expect($("input").attr("aria-describedby")).toBe("rules-help domains-help domains-error");
    expect($("input").attr("aria-invalid")).toBe("true");
    expect($("input").val()).toBe("*.example.com");
    expect($("[role=alert]").text()).toBe("Remove the wildcard.");
    expect($("button[aria-label='Remove company.com']").attr("type")).toBe("button");
    expect($("#domains-help").text()).toContain("wildcards are not supported");
  });

  it("commits Enter without submitting the form and leaves native Ctrl+A and IME keys untouched", () => {
    const onChange = vi.fn();
    const input = nativeInput({ ...base, draft: "next@example.com", onChange });
    const event = { key: "Enter", preventDefault: vi.fn(), nativeEvent: {} } as unknown as KeyboardEvent<HTMLInputElement>;
    input.props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({ entries: ["jamie@example.com", "next@example.com"], draft: "" });
    onChange.mockClear();
    for (const options of [{ key: "a", ctrlKey: true }, { key: "a", metaKey: true }, { key: "Enter", nativeEvent: { isComposing: true } }, { key: "Enter", nativeEvent: { keyCode: 229 } }]) {
      const nativeEvent = { preventDefault: vi.fn(), nativeEvent: {}, ...options } as unknown as KeyboardEvent<HTMLInputElement>;
      input.props.onKeyDown(nativeEvent);
      expect(nativeEvent.preventDefault).not.toHaveBeenCalled();
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("pastes over the selected text, accepts complete entries, and keeps malformed ones", () => {
    const onChange = vi.fn();
    const input = nativeInput({ ...base, draft: "replace this", onChange });
    const event = { preventDefault: vi.fn(), clipboardData: { getData: () => "Next@Example.com\ninvalid" }, currentTarget: { selectionStart: 0, selectionEnd: 12 } } as unknown as ClipboardEvent<HTMLInputElement>;
    input.props.onPaste(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({ entries: ["jamie@example.com", "next@example.com"], draft: "invalid", error: expect.any(String) });
  });

  it("commits comma input and blur but preserves ordinary typing", () => {
    const onChange = vi.fn();
    const input = nativeInput({ ...base, draft: "next@example.com", onChange });
    input.props.onChange({ target: { value: "next@example.com," }, nativeEvent: {} } as unknown as ChangeEvent<HTMLInputElement>);
    expect(onChange).toHaveBeenLastCalledWith({ entries: ["jamie@example.com", "next@example.com"], draft: "" });
    input.props.onChange({ target: { value: "next@" }, nativeEvent: {} } as unknown as ChangeEvent<HTMLInputElement>);
    expect(onChange).toHaveBeenLastCalledWith({ entries: ["jamie@example.com"], draft: "next@" });
    input.props.onBlur();
    expect(onChange).toHaveBeenLastCalledWith({ entries: ["jamie@example.com", "next@example.com"], draft: "" });
  });
});
