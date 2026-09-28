import { load } from "cheerio";
import { isValidElement, type ChangeEvent, type ComponentProps, type FormEvent, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImboxPosting } from "../../../shared/contracts";
import type { MailSplit } from "../../../shared/mail-splits";
import AddToSplitDialog from "./AddToSplitDialog";

// Exercise event handlers and rerenders without opening a browser or installing
// a DOM emulator. Static-render tests below still use React's real hooks.
const hooks = vi.hoisted(() => ({ current: undefined as { values: unknown[]; cursor: number } | undefined }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  const valueAt = (initial: () => unknown) => {
    const state = hooks.current!;
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial();
    return [state, index] as const;
  };
  return { ...react,
    useState: (initial: unknown) => {
      if (!hooks.current) return react.useState(initial);
      const [state, index] = valueAt(() => typeof initial === "function" ? initial() : initial);
      return [state.values[index], (next: unknown) => { state.values[index] = typeof next === "function" ? next(state.values[index]) : next; }];
    },
    useRef: (initial: unknown) => {
      if (!hooks.current) return react.useRef(initial);
      const [state, index] = valueAt(() => ({ current: initial }));
      return state.values[index];
    },
    useId: () => hooks.current ? "add-split" : react.useId(),
    useEffect: (...args: Parameters<typeof react.useEffect>) => { if (!hooks.current) return react.useEffect(...args); },
  };
});

const row: ImboxPosting = { id: "1", topicId: "101", subject: "Project plans", summary: "", seen: false, createdAt: "2026-09-27T12:00:00Z", sender: { name: "Jamie", email: "jamie@example.com" }, contacts: [], visibleEntryCount: 1 };
const manual: MailSplit = { id: "manual", name: "Project", enabled: true, people: [], domains: [], labelName: "Project" };
const paused: MailSplit = { ...manual, id: "paused", name: "Later project", enabled: false, labelId: "200" };
const props = () => ({ postings: [row], splits: [manual, paused], onAdd: vi.fn(async () => {}), onClose: vi.fn(), onCreate: vi.fn() });

function mounted(initial = props()) {
  const state = { values: [] as unknown[], cursor: 0 };
  let currentProps: ComponentProps<typeof AddToSplitDialog> = initial;
  return { props: initial, render(next?: Partial<ComponentProps<typeof AddToSplitDialog>>) {
    currentProps = { ...currentProps, ...next };
    state.cursor = 0;
    hooks.current = state;
    try { return AddToSplitDialog(currentProps); }
    finally { hooks.current = undefined; }
  } };
}

function control<T>(tree: ReactNode, type: string, attributes: Record<string, unknown> = {}): ReactElement<T> {
  const search = (node: ReactNode): ReactElement | undefined => {
    if (Array.isArray(node)) { for (const child of node) { const found = search(child); if (found) return found; } }
    if (!isValidElement<Record<string, unknown>>(node)) return;
    if (node.type === type && Object.entries(attributes).every(([key, value]) => node.props[key] === value)) return node;
    return search(node.props.children as ReactNode);
  };
  const found = search(tree);
  if (!found) throw new Error(`Missing ${type}: ${JSON.stringify(attributes)}`);
  return found as ReactElement<T>;
}
const markup = (tree: ReactNode) => load(renderToStaticMarkup(tree));
const submit = (tree: ReactNode) => control<{ onSubmit: (event: FormEvent) => void }>(tree, "form").props.onSubmit({ preventDefault: vi.fn() } as unknown as FormEvent);
const selectMode = (tree: ReactNode, value: string) => control<{ onChange: () => void }>(tree, "input", { value }).props.onChange();
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => { hooks.current = undefined; });

describe("Add to split dialog", () => {
  it("defaults to conversation-only and exposes an accessible split picker and radio group", () => {
    const callbacks = props();
    const $ = markup(<AddToSplitDialog {...callbacks} />);
    expect($("dialog").attr("aria-modal")).toBe("true");
    expect($(`[id='${$("dialog").attr("aria-labelledby")}']`).text()).toBe("Add to split");
    expect($("label[for]").attr("for")).toBe($("select").attr("id"));
    expect($("select").val()).toBe("manual");
    expect($("input:checked").val()).toBe("conversation");
    expect($("legend").text()).toBe("What should belong here?");
    expect($("input[type=radio]").map((_, node) => $(node).attr("name")).get()).toEqual(Array(3).fill($("input").first().attr("name")));
    expect($("button[type=submit]").text()).toBe("Add conversation");
    expect($("button[type=submit]").attr("disabled")).toBeUndefined();
    expect(callbacks.onAdd).not.toHaveBeenCalled();
    expect(callbacks.onCreate).not.toHaveBeenCalled();
  });

  it("disables unavailable future-mail modes with associated recovery text", () => {
    const $ = markup(<AddToSplitDialog {...props()} postings={[{ ...row, sender: { name: "Unknown" } }]} />);
    expect($("input[value=conversation]").attr("disabled")).toBeUndefined();
    for (const mode of ["person", "domain"]) {
      const input = $(`input[value=${mode}]`);
      expect(input.attr("disabled")).toBeDefined();
      expect($(`[id='${input.attr("aria-describedby")}']`).text()).toContain("Add only these conversations instead");
    }
    const malformed = markup(<AddToSplitDialog {...props()} postings={[{ ...row, sender: { name: "Unknown", email: "bad..name@example.com" } }]} />);
    expect(malformed("input[value=person]").attr("disabled")).toBeDefined();
    expect(malformed(".split-add-options").text()).toContain("complete email addresses");
  });

  it("supports a manual-only split, a paused split, and the empty create path", () => {
    const mount = mounted();
    const tree = mount.render();
    submit(tree);
    expect(mount.props.onAdd).toHaveBeenCalledWith({ splitId: "manual", postingIds: ["1"] });
    const empty = markup(<AddToSplitDialog {...props()} splits={[]} />);
    expect(empty("select")).toHaveLength(0);
    expect(empty("button[type=submit]").attr("disabled")).toBeDefined();
    expect(empty(".split-manager-body").text()).toContain("Create a split first");
    const off = markup(<AddToSplitDialog {...props()} splits={[paused]} />);
    expect(off("option").text()).toBe("Later project (off)");
    expect(off(".split-sync-note").text()).toContain("automatic rules stay paused");
    const emptyMount = mounted({ ...props(), splits: [] });
    control<{ onClick: () => void }>(emptyMount.render(), "button", { className: "secondary-button split-add-create" }).props.onClick();
    expect(emptyMount.props.onCreate).toHaveBeenCalledOnce();
  });

  it("adds normalized bulk people or domains only when the user selects that mode", async () => {
    for (const mode of ["person", "domain"] as const) {
      const mount = mounted({ ...props(), postings: [row, { ...row, id: "2", sender: { name: "Jamie", email: "JAMIE@EXAMPLE.COM" } }] });
      selectMode(mount.render(), mode);
      const tree = mount.render();
      expect(markup(tree)("button[type=submit]").text()).toBe("Add and include future mail");
      submit(tree);
      expect(mount.props.onAdd).toHaveBeenCalledWith({ splitId: "manual", postingIds: ["1", "2"], ...(mode === "person" ? { people: ["jamie@example.com"] } : { domains: ["example.com"] }) });
      await settle();
      expect(mount.props.onClose).toHaveBeenCalledOnce();
    }
  });

  it("locks duplicate submission and dismissal while adding, then closes after success", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    const mount = mounted({ ...props(), onAdd: vi.fn(() => pending) });
    const tree = mount.render();
    submit(tree); submit(tree);
    expect(mount.props.onAdd).toHaveBeenCalledOnce();
    const busy = mount.render();
    const $ = markup(busy);
    expect($("fieldset.split-editor-fields").attr("disabled")).toBeDefined();
    expect($("button:not([disabled])")).toHaveLength(0);
    expect($("button[type=submit]").text()).toBe("Adding…");
    control<{ onClick: () => void }>(busy, "button", { "aria-label": "Close add to split" }).props.onClick();
    expect(mount.props.onClose).not.toHaveBeenCalled();
    resolve(); await settle();
    expect(mount.props.onClose).toHaveBeenCalledOnce();
  });

  it("retains choices after failure and permits retry without inventing future rules", async () => {
    const onAdd = vi.fn().mockRejectedValueOnce(new Error("HEY is unavailable. Try again.")).mockResolvedValue(undefined);
    const mount = mounted({ ...props(), onAdd });
    control<{ onChange: (event: ChangeEvent<HTMLSelectElement>) => void }>(mount.render(), "select").props.onChange({ target: { value: "paused" } } as ChangeEvent<HTMLSelectElement>);
    submit(mount.render()); await settle();
    const failed = mount.render();
    const $ = markup(failed);
    expect($("[role=alert]").text()).toBe("HEY is unavailable. Try again.");
    expect($("select").val()).toBe("paused");
    expect($("input:checked").val()).toBe("conversation");
    expect($("button[type=submit]").attr("disabled")).toBeUndefined();
    expect(mount.props.onClose).not.toHaveBeenCalled();
    submit(failed); await settle();
    expect(onAdd).toHaveBeenLastCalledWith({ splitId: "paused", postingIds: ["1"] });
    expect(mount.props.onClose).toHaveBeenCalledOnce();
  });

  it("rejects a stale split, invalid bulk selection, and a mode that becomes unavailable", async () => {
    const stale = mounted();
    stale.render();
    submit(stale.render({ splits: [paused] }));
    expect(stale.props.onAdd).not.toHaveBeenCalled();
    expect(markup(stale.render())("[role=alert]").text()).toBe("Choose a split first.");
    const invalid = mounted({ ...props(), postings: [row, { ...row, id: "2", kind: "bundle" }] });
    submit(invalid.render()); await settle();
    expect(invalid.props.onAdd).not.toHaveBeenCalled();
    expect(markup(invalid.render())("[role=alert]").text()).toContain("individual mail conversations");
    const missing = mounted();
    selectMode(missing.render(), "person");
    submit(missing.render({ postings: [{ ...row, sender: { name: "Unknown" } }] })); await settle();
    expect(missing.props.onAdd).not.toHaveBeenCalled();
    expect(markup(missing.render())("[role=alert]").text()).toContain("Add only these conversations instead");
    selectMode(missing.render(), "conversation");
    expect(markup(missing.render())("[role=alert]")).toHaveLength(0);
  });

  it("keeps composition Escape local without closing and gives blank subjects a fallback", () => {
    const mount = mounted({ ...props(), postings: [{ ...row, subject: "" }] });
    const tree = mount.render();
    expect(markup(tree)(".split-manager-body > p").first().text()).toBe("(No subject)");
    for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = { key: "Escape", nativeEvent, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent<HTMLDialogElement>;
      control<{ onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => void }>(tree, "dialog").props.onKeyDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
    }
    expect(mount.props.onClose).not.toHaveBeenCalled();
  });
});
