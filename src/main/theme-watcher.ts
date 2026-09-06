import type { ThemeSnapshot } from "../shared/contracts";
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { currentTheme } from "./theme";

export class ThemeWatcher {
  private timer?: NodeJS.Timeout;
  private debounce?: NodeJS.Timeout;
  private watcher?: FSWatcher;
  private previous = "";
  private checking = false;

  constructor(
    private readonly onChange: (theme: ThemeSnapshot) => void,
    private readonly intervalMs = 15_000,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async start(): Promise<void> {
    const theme = await currentTheme(this.env);
    this.previous = JSON.stringify(theme);
    const home = this.env.HOME ?? "";
    const stateRoot = this.env.XDG_STATE_HOME?.startsWith("/")
      ? this.env.XDG_STATE_HOME
      : join(home, ".local", "state");
    try {
      this.watcher = watch(join(stateRoot, "omarchy", "current"), { recursive: true }, () => this.queueCheck());
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = undefined;
      });
    } catch {
      // The polling fallback also catches atomically replaced themes and font changes.
    }
    this.timer = setInterval(() => void this.check(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.watcher?.close();
    this.timer = undefined;
    this.debounce = undefined;
    this.watcher = undefined;
  }

  private queueCheck(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.check();
    }, 80);
  }

  private async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const theme = await currentTheme(this.env);
      const serialized = JSON.stringify(theme);
      if (serialized !== this.previous) {
        this.previous = serialized;
        this.onChange(theme);
      }
    } finally {
      this.checking = false;
    }
  }
}
