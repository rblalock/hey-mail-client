import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ThemeSnapshot } from "../shared/contracts";
import { findExecutable, runFile } from "./process";

function quotedValues(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of source.split("\n")) {
    const match = /^([a-zA-Z0-9_-]+)\s*=\s*"([^"\n]*)"\s*$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) values[match[1]] = match[2];
  }
  return values;
}

async function optionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function currentFont(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const fcMatch = await findExecutable("fc-match", env);
  if (!fcMatch) return undefined;
  try {
    const { stdout } = await runFile(fcMatch, ["monospace", "-f", "%{family}\n"], { env, timeoutMs: 3_000 });
    return stdout.trim().split("\n")[0]?.split(",")[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function currentTheme(env: NodeJS.ProcessEnv = process.env): Promise<ThemeSnapshot> {
  const home = env.HOME ?? "";
  const stateRoot = env.XDG_STATE_HOME?.startsWith("/")
    ? env.XDG_STATE_HOME
    : join(home, ".local", "state");
  const current = join(stateRoot, "omarchy", "current");
  const [nameSource, heySource, paletteSource, fontFamily] = await Promise.all([
    optionalText(join(current, "theme.name")),
    optionalText(join(current, "theme", "hey.toml")),
    optionalText(join(current, "theme", "colors.toml")),
    currentFont(env),
  ]);
  const values = {
    ...quotedValues(paletteSource ?? ""),
    ...quotedValues(heySource ?? ""),
  };

  return {
    name: nameSource?.trim() || "System",
    mode: values.mode === "light" ? "light" : "dark",
    ...(fontFamily ? { fontFamily } : {}),
    colors: values,
  };
}
