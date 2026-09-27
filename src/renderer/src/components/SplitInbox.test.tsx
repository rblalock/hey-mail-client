import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MailSplit, MailSplitPreview } from "../../../shared/mail-splits";
import SplitInboxManager, { splitEditorValidation, splitRuleTokens } from "./SplitInboxManager";
import SplitInboxTabs from "./SplitInboxTabs";

const team: MailSplit = { id: "team", name: "Team", enabled: true, people: ["jamie@example.com"], domains: ["company.com"], labelId: "123", labelName: "Work" };
const paused: MailSplit = { ...team, id: "paused", name: "Paused", enabled: false };
const preview: MailSplitPreview = { count: 0, scannedCount: 25, samples: [], scope: "The first 25 Imbox conversations." };
const noOp = () => {};
const managerProps = {
  splits: [team, paused], labels: [{ id: "123", title: "Work" }],
  onPreview: vi.fn(async () => preview), onSave: vi.fn(async () => {}), onRemove: vi.fn(async () => {}), onClose: noOp,
};

describe("split inbox tabs", () => {
  it("shows All, enabled splits and Remaining with a single tab stop", () => {
    const $ = load(renderToStaticMarkup(<SplitInboxTabs splits={[team, paused]} selectedId="team" counts={{ all: 4, team: 3, remaining: 1 }} onSelect={noOp} onManage={noOp} onCreate={noOp} />));
    expect($("[role=tab] .split-inbox-name").map((_, node) => $(node).text()).get()).toEqual(["All", "Team", "Remaining"]);
    expect($("[role=tab][tabindex='0']")).toHaveLength(1);
    expect($("[role=tab][aria-selected='true']").attr("data-split-id")).toBe("team");
    expect($("[aria-label='3 outstanding conversations']").text()).toBe("3");
    expect($("button[aria-label='Create split']")).toHaveLength(1);
    expect($("button[aria-label='Manage splits']")).toHaveLength(1);
  });

  it("falls back to All if the selected split is no longer available", () => {
    const $ = load(renderToStaticMarkup(<SplitInboxTabs splits={[team]} selectedId="removed" counts={{ all: 0 }} onSelect={noOp} onManage={noOp} onCreate={noOp} />));
    expect($("[role=tab][aria-selected='true']").attr("data-split-id")).toBe("all");
    expect($(".split-inbox-count")).toHaveLength(0);
  });

  it("preserves long names in titles", () => {
    const name = "A split name that is deliberately longer than the tab can display";
    const $ = load(renderToStaticMarkup(<SplitInboxTabs splits={[{ ...team, name }]} selectedId="team" counts={{}} onSelect={noOp} onManage={noOp} onCreate={noOp} />));
    expect($("[data-split-id='team']").attr("title")).toBe(name);
  });
});

describe("split inbox manager", () => {
  it("opens to the list and keeps enabled and disabled splits editable", () => {
    const $ = load(renderToStaticMarkup(<SplitInboxManager {...managerProps} errors={{ team: "The HEY label is unavailable. Choose another label." }} />));
    expect($("dialog[aria-modal='true']")).toHaveLength(1);
    expect($(".split-manager-heading h2").text()).toBe("Split inboxes");
    expect($(".split-state").map((_, node) => $(node).text()).get()).toEqual(["On", "Off"]);
    expect($("[aria-label='Edit Team']")).toHaveLength(1);
    expect($("[aria-label='Remove Team']")).toHaveLength(1);
    expect($(".split-feedback").text()).toContain("Choose another label");
    expect($(".split-manager-footer").text()).toContain("this account on this computer");
  });

  it("starts a new editor from the selected person's email without writing data", () => {
    const $ = load(renderToStaticMarkup(<SplitInboxManager {...managerProps} initialDraft={{ name: "Jamie", people: ["jamie@example.com"] }} />));
    expect($(".split-manager-heading h2").text()).toBe("Create split");
    expect($(".split-editor-name").val()).toBe("Jamie");
    expect($("textarea").first().text()).toBe("jamie@example.com");
    expect($("button[type=submit]").attr("disabled")).toBeDefined();
    expect($("button.split-preview-button").text()).toBe("Preview matches");
    expect($(".split-label-fields select option").map((_, node) => $(node).text()).get()).toEqual(["Create a new label", "Work"]);
    expect($(".split-sync-note").text()).toContain("Turning off a split keeps its HEY label");
    expect(managerProps.onPreview).not.toHaveBeenCalled();
    expect(managerProps.onSave).not.toHaveBeenCalled();
  });

  it("allows saving a disabled split without a preview", () => {
    const $ = load(renderToStaticMarkup(<SplitInboxManager {...managerProps} initialDraft={paused} />));
    expect($(".split-manager-heading h2").text()).toBe("Edit split");
    expect($("button[type=submit]").attr("disabled")).toBeUndefined();
    expect($(".split-label-fields select").val()).toBe("123");
    expect($(".split-enabled input").attr("checked")).toBeUndefined();
  });

  it("opens the creation form when no splits exist", () => {
    const $ = load(renderToStaticMarkup(<SplitInboxManager {...managerProps} splits={[]} />));
    expect($(".split-manager-heading h2").text()).toBe("Create split");
    expect($(".split-rule-fields").text()).toContain("including your replies");
  });
});

describe("split editor validation", () => {
  const valid = { name: "Work", enabled: true, people: "jamie@example.com", domains: "company.com", labelName: "Work" };
  it("parses comma, newline and semicolon lists without silently dropping invalid addresses", () => {
    expect(splitRuleTokens(" Jamie@Example.com,\n jamie@example.com;broken; person@company.com ")).toEqual(["jamie@example.com", "broken", "person@company.com"]);
    expect(splitEditorValidation({ ...valid, people: "jamie@example.com, broken" }).people).toBeDefined();
  });
  it("accepts people only, domains only, and combined rules", () => {
    expect(splitEditorValidation(valid)).toEqual({});
    expect(splitEditorValidation({ ...valid, people: "", domains: "@COMPANY.COM" })).toEqual({});
    expect(splitEditorValidation({ ...valid, domains: "" })).toEqual({});
    expect(splitEditorValidation({ ...valid, people: "", domains: "" }).rules).toBeDefined();
  });
  it("uses the shared validator for malformed domains, email syntax, limits and labels", () => {
    expect(splitEditorValidation({ ...valid, domains: "https://company.com" }).domains).toBeDefined();
    expect(splitEditorValidation({ ...valid, domains: "*.company.com" }).domains).toBeDefined();
    expect(splitEditorValidation({ ...valid, people: "bad..name@example.com" }).people).toBeDefined();
    expect(splitEditorValidation({ ...valid, people: Array.from({ length: 51 }, (_, index) => `person${index}@example.com`).join(",") }).people).toBeDefined();
    expect(splitEditorValidation({ ...valid, labelId: "not-a-hey-id" }).labelId).toBeDefined();
    expect(splitEditorValidation({ ...valid, name: " ", labelName: " " })).toMatchObject({ name: expect.any(String), labelName: expect.any(String) });
  });
});
