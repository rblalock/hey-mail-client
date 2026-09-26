import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeId, RuntimeProbe } from "../shared/contracts";
import { findExecutable, runFile } from "./process";

const RUNTIMES: Array<{ id: RuntimeId; label: string; args: string[] }> = [
  { id: "hey", label: "HEY CLI", args: ["--version"] },
  { id: "pi", label: "Pi", args: ["--version"] },
];

export function supportedHeyVersion(version: string): boolean {
  const match = version.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  return Boolean(match && (Number(match[1]) > 1 || Number(match[1]) === 1 && Number(match[2]) >= 7));
}

function installedHeySkill(env: NodeJS.ProcessEnv): string | undefined {
  const home = env.HOME || homedir();
  const candidates = [
    env.HEY_SKILL_PATH,
    join(home, ".agents", "skills", "hey", "SKILL.md"),
    join(home, ".codex", "skills", "hey", "SKILL.md"),
    join(home, ".pi", "agent", "skills", "hey", "SKILL.md"),
    join(home, ".config", "pi", "agent", "skills", "hey", "SKILL.md"),
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

async function probeHeyAuthentication(env: NodeJS.ProcessEnv): Promise<RuntimeProbe> {
  const executable = await findExecutable("hey", env);
  if (!executable) return { id: "hey-auth", label: "HEY account", status: "missing", detail: "HEY CLI is not available." };
  try {
    const [authResult, accountResult] = await Promise.all([
      runFile(executable, ["auth", "status", "--json"], { env, timeoutMs: 5_000 }),
      runFile(executable, ["account", "list", "--json"], { env, timeoutMs: 5_000 }),
    ]);
    const auth = JSON.parse(authResult.stdout) as { data?: { authenticated?: boolean } };
    const accounts = JSON.parse(accountResult.stdout) as { data?: Array<{ name?: string; active?: boolean }> };
    if (!auth.data?.authenticated) return { id: "hey-auth", label: "HEY account", executable, status: "error", detail: "HEY is not authenticated." };
    const active = accounts.data?.find((account) => account.active)?.name;
    return { id: "hey-auth", label: "HEY account", executable, status: "ready", version: active ? `Logged in · ${active}` : "Logged in" };
  } catch (error) {
    return { id: "hey-auth", label: "HEY account", executable, status: "error", detail: error instanceof Error ? error.message : "Unable to inspect HEY authentication." };
  }
}

export async function probeRuntimes(env: NodeJS.ProcessEnv = process.env, extensionPath?: string): Promise<RuntimeProbe[]> {
  const runtimes = await Promise.all(RUNTIMES.map(async ({ id, label, args }): Promise<RuntimeProbe> => {
    const executable = await findExecutable(id, env);
    if (!executable) {
      return {
        id,
        label,
        status: "missing",
        detail: `${label} was not found in the graphical session PATH.`,
      };
    }

    try {
      const { stdout, stderr } = await runFile(executable, args, { env, timeoutMs: 5_000 });
      const version = (stdout || stderr).trim().split("\n")[0]?.trim();
      if (id === "hey" && !supportedHeyVersion(version ?? "")) return { id, label, executable, version, status: "error", detail: "HEY CLI 1.7.0 or newer is required. Run hey upgrade, then restart HEY Agent." };
      return { id, label, executable, version, status: "ready" };
    } catch (error) {
      return {
        id,
        label,
        executable,
        status: "error",
        detail: error instanceof Error ? error.message : `Unable to run ${label}.`,
      };
    }
  }));
  const skill = installedHeySkill(env);
  return [
    ...runtimes,
    await probeHeyAuthentication(env),
    skill
      ? { id: "hey-skill", label: "HEY skill", executable: skill, version: "Available to Pi", status: "ready" }
      : { id: "hey-skill", label: "HEY skill", status: "missing", detail: "Pi's HEY skill was not found in a standard skill path." },
    extensionPath && existsSync(extensionPath)
      ? { id: "hey-agent-extension", label: "HEY Agent bridge", executable: extensionPath, version: "Boundary v1", status: "ready" }
      : { id: "hey-agent-extension", label: "HEY Agent bridge", status: "missing", detail: "The packaged Pi extension could not be found." },
  ];
}
