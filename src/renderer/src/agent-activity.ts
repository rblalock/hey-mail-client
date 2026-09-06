import type { AgentObjectLink, AgentToolActivity } from "../../shared/contracts";

export function agentRunResultObjects(tools: AgentToolActivity[]): AgentObjectLink[] {
  const unique = new Map<string, AgentObjectLink>();
  for (const tool of tools) for (const object of tool.artifact?.objects ?? []) unique.set(object.deepLink, object);
  return [...unique.values()];
}
