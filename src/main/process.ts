import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Graphical launchers do not run the user's interactive shell initialization.
export function desktopRuntimePath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME;
  return [...new Set([
    ...(env.PATH ?? "/usr/local/bin:/usr/bin:/bin").split(delimiter).filter(Boolean),
    ...(home ? [join(home, ".local/bin"), join(home, ".local/share/mise/shims"), join(home, ".cargo/bin")] : []),
    "/usr/local/bin", "/usr/bin", "/bin",
  ])].join(delimiter);
}

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export async function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = env.HOME ?? "",
): Promise<string | undefined> {
  const override = env[`HEY_AGENT_${name.toUpperCase()}_PATH`];
  const pathDirectories = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const candidates = [
    override,
    ...pathDirectories.map((directory) => join(directory, name)),
    home ? join(home, ".local", "bin", name) : undefined,
    home ? join(home, ".local", "share", "mise", "shims", name) : undefined,
    home ? join(home, ".cargo", "bin", name) : undefined,
    join("/usr/local/bin", name),
    join("/usr/bin", name),
  ];

  for (const candidate of [...new Set(candidates)]) {
    if (!candidate?.startsWith("/")) continue;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the deterministic candidate list.
    }
  }

  return undefined;
}

export async function runFile(
  executable: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number; maxBuffer?: number } = {},
): Promise<CommandResult> {
  const result = await execFileAsync(executable, args, {
    encoding: "utf8",
    env: options.env ?? process.env,
    timeout: options.timeoutMs ?? 15_000,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    windowsHide: true,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function runFileWithInput(
  executable: string,
  args: string[],
  input: string,
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number; maxBuffer?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const maxBuffer = options.maxBuffer ?? 8 * 1024 * 1024;
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      settled = true;
      reject(new Error(`HEY command timed out after ${options.timeoutMs ?? 15_000}ms.`));
    }, options.timeoutMs ?? 15_000);

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBuffer && !settled) {
        child.kill("SIGTERM");
        settled = true;
        clearTimeout(timer);
        reject(new Error("HEY command returned too much data."));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString("utf8");
      const errorOutput = Buffer.concat(stderr).toString("utf8");
      if (code === 0) resolve({ stdout: output, stderr: errorOutput });
      else reject(new Error(errorOutput.trim() || `HEY command exited with ${signal ?? code}.`));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input, "utf8");
  });
}
