import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HELPERS, customHelpersError, helperAcceptsContextCount, helperById, helperCatalog, helperCommandId, helperCommandLabel, helperIdFromCommand, helperStarter, MAX_HELPER_INSTRUCTIONS, type CustomHelper } from "./helpers";

describe("Helpers", () => {
  const personal: CustomHelper = { id: "custom-project", title: "Project notes", instructions: "Summarize decisions from the supplied context.", context: "any", modelProfile: "general" };

  it("maps personal Helpers to eligible contexts without inventing skill paths", () => {
    const any = helperById(personal.id, [personal])!;
    expect(any.skillDirectory).toBeUndefined();
    expect(helperAcceptsContextCount(any, 0)).toBe(true);
    expect(helperAcceptsContextCount(any, 13)).toBe(false);
    expect(helperIdFromCommand(helperCommandId(personal.id))).toBe(personal.id);
    expect(helperById(personal.id)).toBeUndefined();
    const mail = helperById(personal.id, [{ ...personal, context: "mail", modelProfile: "quick" }])!;
    expect(mail.contextKinds).toEqual(["mail-thread"]);
    expect(mail.modelProfile).toBe("quick");
    expect(helperAcceptsContextCount(mail, 0)).toBe(false);
    const calendar = helperById(personal.id, [{ ...personal, context: "calendar" }])!;
    expect(calendar.contextKinds).toEqual(["calendar-event", "calendar-date"]);
    expect(helperAcceptsContextCount(calendar, 2)).toBe(false);
    expect(helperCatalog([personal])).toHaveLength(7);
  });

  it("validates authored definitions without overwriting built-ins or accepting paths", () => {
    expect(customHelpersError([personal])).toBeUndefined();
    for (const changed of [
      { id: "../../escape" }, { title: "  " }, { title: "Daily Brief" }, { title: "x\ny" },
      { title: "x".repeat(61) }, { instructions: "\0" }, { instructions: "  " },
      { instructions: "x".repeat(MAX_HELPER_INSTRUCTIONS + 1) }, { context: "files" }, { modelProfile: "shell" },
    ]) expect(customHelpersError([{ ...personal, ...changed }])).toBeTruthy();
    expect(customHelpersError([personal, { ...personal, id: "custom-two", title: " PROJECT NOTES " }])).toContain("already exists");
    expect(customHelpersError(Array.from({ length: 51 }, (_, index) => ({ ...personal, id: `custom-${index}`, title: `Helper ${index}` })))).toContain("50");
  });

  it("keeps daily and Calendar research bounded and follow-through explicit", async () => {
    for (const id of ["daily-brief", "calendar-triage"] as const) {
      const helper = helperById(id);
      const skill = await readFile(join(process.cwd(), "resources/helpers", id, "SKILL.md"), "utf8");
      expect(helper.contextKinds).toEqual(["calendar-date"]);
      expect(helper.modelProfile).toBe("general");
      expect(skill).toContain("Read only");
      expect(skill).toContain("expanded");
      expect(skill).toContain("untrusted reference");
      expect(skill).toContain("hey-agent://calendar/events/");
      expect(skill).toContain("hey-agent://mail/threads/");
      expect(skill).toContain("at most two targeted searches");
    }
    const triage = await readFile(join(process.cwd(), "resources/helpers/calendar-triage/SKILL.md"), "utf8");
    for (const boundary of ["back-to-back, not overlap", "Maybe", "DST", "mirrors", "External calendars stay read-only", "IDs name the series", "authoritative reread", "Reconcile ambiguous writes"]) expect(triage).toContain(boundary);
    const brief = await readFile(join(process.cwd(), "resources/helpers/daily-brief/SKILL.md"), "utf8");
    for (const boundary of ["25 Imbox", "15 Reply Later", "eight full threads", "Failed reads are not empty results", "newer answer", "never substitute a posting ID"]) expect(brief).toContain(boundary);
  });
  it("keeps each Helper manifest connected to a packaged Pi skill", async () => {
    for (const helper of HELPERS) {
      const skill = await readFile(join(process.cwd(), "resources", "helpers", helper.skillDirectory!, "SKILL.md"), "utf8");
      expect(skill).toContain(`name: ${helper.id}`);
      expect(skill).toContain("description:");
    }
  });

  it("keeps Meeting Prep bounded, read-only, and native-link aware", async () => {
    const helper = helperById("meeting-prep");
    const skill = await readFile(join(process.cwd(), "resources", "helpers", helper.skillDirectory!, "SKILL.md"), "utf8");

    expect(helper.contextKinds).toEqual(["calendar-event"]);
    expect(skill).toContain("Read only.");
    expect(skill).toContain("at most three searches");
    expect(skill).toContain("at most eight full threads");
    expect(skill).toContain("hey-agent://calendar/events/");
    expect(skill).toContain("hey-agent://mail/threads/");
  });

  it("keeps the mail Helpers bounded and explicit about their authority", async () => {
    for (const id of ["follow-up-finder", "thread-recap", "reply-coach"] as const) {
      const helper = helperById(id);
      const skill = await readFile(join(process.cwd(), "resources", "helpers", helper.skillDirectory!, "SKILL.md"), "utf8");
      expect(helper.contextKinds).toEqual(["mail-thread"]);
      expect(skill.toLowerCase()).toMatch(/(?:never|do not)[^.\n]*send/);
      if (id === "reply-coach") expect(skill).toContain("Return only the complete replacement email body");
      else expect(skill).toContain("hey-agent://mail/threads/");
    }
    expect(helperById("follow-up-finder").maximumContexts).toBe(12);
    expect(helperById("thread-recap").maximumContexts).toBe(12);
    expect(helperById("reply-coach").maximumContexts).toBe(1);
    expect(helperById("reply-coach").modelProfile).toBe("quick");
  });

  it("derives contextual commands and starters from the manifest", () => {
    const helper = helperById("follow-up-finder");
    expect(helperAcceptsContextCount(helper, 1)).toBe(true);
    expect(helperAcceptsContextCount(helper, 12)).toBe(true);
    expect(helperAcceptsContextCount(helper, 13)).toBe(false);
    expect(helperCommandId(helper.id)).toBe("helper-follow-up-finder");
    expect(helperIdFromCommand("helper-follow-up-finder")).toBe("follow-up-finder");
    expect(helperCommandLabel(helper, 2)).toBe("Find follow-ups in selected conversations");
    expect(helperStarter(helper, 2)).toBe("Read the attached conversations and surface only the follow-ups that are still open.");
    expect(helperStarter(helperById("reply-coach"), 1)).toContain("write the complete reply");
  });

  it("keeps Reply Coach paste-ready instead of asking the app user what to write", async () => {
    const helper = helperById("reply-coach");
    const skill = await readFile(join(process.cwd(), "resources", "helpers", helper.skillDirectory!, "SKILL.md"), "utf8");

    expect(skill).toContain("Never output a meta-question to the app user");
    expect(skill).toContain("question to the recipient inside the email body");
    expect(skill).toContain("Do not ask the app user what part of it to address");
  });
});
