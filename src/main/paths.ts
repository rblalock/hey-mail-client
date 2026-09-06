import { homedir } from "node:os";
import { join } from "node:path";
import type { AppPaths } from "../shared/contracts";

const APP_DIRECTORY = "hey-agent-app";

function absoluteRoot(value: string | undefined, fallback: string): string {
  return value?.startsWith("/") ? value : fallback;
}

export function resolveAppPaths(
  env: NodeJS.ProcessEnv = process.env,
  home: string = env.HOME ?? homedir(),
): AppPaths {
  const configRoot = absoluteRoot(env.XDG_CONFIG_HOME, join(home, ".config"));
  const dataRoot = absoluteRoot(env.XDG_DATA_HOME, join(home, ".local", "share"));
  const stateRoot = absoluteRoot(env.XDG_STATE_HOME, join(home, ".local", "state"));

  return {
    config: join(configRoot, APP_DIRECTORY),
    data: join(dataRoot, APP_DIRECTORY),
    state: join(stateRoot, APP_DIRECTORY),
    workspace: join(dataRoot, APP_DIRECTORY, "workspace"),
  };
}
