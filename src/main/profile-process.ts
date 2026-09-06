import { AsyncLocalStorage } from "node:async_hooks";
import * as processTools from "./process";
import { HeyAccountScope } from "../../resources/hey-account-scope.mjs";
import { beginHeyWrite, completeHeyWrite, isMailWrite } from "../../resources/hey-write-receipts.mjs";

export { findExecutable } from "./process";
export const profileRequest = new AsyncLocalStorage<{ scope: HeyAccountScope; env: NodeJS.ProcessEnv }>();

export async function runFile(executable: string, args: string[], options: Parameters<typeof processTools.runFile>[2] = {}) {
  const context = profileRequest.getStore();
  if (!context) return processTools.runFile(executable, args, options);
  const scopedOptions = { ...options, env: context.env };
  const command = await context.scope.prepare(args, (query) => processTools.runFile(executable, query, scopedOptions));
  const receipt = isMailWrite(args) ? beginHeyWrite(context.env.HEY_AGENT_WRITE_RECEIPTS, args) : undefined;
  const result = await processTools.runFile(executable, command, scopedOptions);
  context.scope.learn(args, result.stdout);
  if (receipt && JSON.parse(result.stdout).ok === false) throw new Error("HEY did not confirm this change. Check its outcome before retrying.");
  completeHeyWrite(receipt);
  return result;
}

export async function runFileWithInput(executable: string, args: string[], input: string, options: Parameters<typeof processTools.runFileWithInput>[3] = {}) {
  const context = profileRequest.getStore();
  if (!context) return processTools.runFileWithInput(executable, args, input, options);
  const scopedOptions = { ...options, env: context.env };
  const command = await context.scope.prepare(args, (query) => processTools.runFile(executable, query, scopedOptions));
  const receipt = isMailWrite(args) ? beginHeyWrite(context.env.HEY_AGENT_WRITE_RECEIPTS, args) : undefined;
  const result = await processTools.runFileWithInput(executable, command, input, scopedOptions);
  context.scope.learn(args, result.stdout);
  if (receipt && JSON.parse(result.stdout).ok === false) throw new Error("HEY did not confirm this change. Check its outcome before retrying.");
  completeHeyWrite(receipt);
  return result;
}
