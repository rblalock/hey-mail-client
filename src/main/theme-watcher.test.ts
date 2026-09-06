import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeWatcher } from "./theme-watcher";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ThemeWatcher", () => {
  it("emits when the active Omarchy theme changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "hey-agent-theme-"));
    temporary.push(root);
    const current = join(root, "omarchy", "current");
    await mkdir(join(current, "theme"), { recursive: true });
    await writeFile(join(current, "theme.name"), "first\n");
    await writeFile(join(current, "theme", "hey.toml"), 'mode = "dark"\naccent = "#ff0000"\n');

    let watcher: ThemeWatcher | undefined;
    const changed = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Theme change was not observed.")), 2_000);
      watcher = new ThemeWatcher((theme) => {
        clearTimeout(timeout);
        resolve(theme.name);
      }, 10, { ...process.env, XDG_STATE_HOME: root });
    });
    await watcher!.start();
    await writeFile(join(current, "theme.name"), "second\n");
    await expect(changed).resolves.toBe("second");
    watcher!.stop();
  });
});

