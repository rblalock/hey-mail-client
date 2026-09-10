import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { afterEach, expect, it, vi } from "vitest";
import CalendarEventComposer from "./CalendarEventComposer";

vi.mock("react-dom", async () => ({ ...await vi.importActual("react-dom"), createPortal: (children: unknown) => children }));
afterEach(() => vi.unstubAllGlobals());
it("prefills the existing editor with the invitation's personal copy, not its guests", () => {
  vi.stubGlobal("document", { body: {} });
  const html = renderToStaticMarkup(<CalendarEventComposer calendars={[{ id: "1", name: "Personal", kind: "calendar", writable: true }]} startsOn="2026-09-10" initial={{ title: "Team dinner", calendarId: "", allDay: false, startsOn: "2026-09-10", endsOn: "2026-09-10", startTime: "18:30", endTime: "21:00", timeZone: "America/New_York", location: "Room A" }} onClose={() => {}} onSaved={() => {}} />);
  const $ = load(html);
  expect($("[role=dialog]").attr("aria-label")).toBe("Add personal copy");
  expect($("input[type=time]").map((_i, e) => $(e).attr("value")).get()).toEqual(["18:30", "21:00"]);
  expect(html).toContain('value="Team dinner"');
  expect(html).toContain('value="Room A"');
  expect(html).toContain("Respond to the original invitation in HEY");
});
