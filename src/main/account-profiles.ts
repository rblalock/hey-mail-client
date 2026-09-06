import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AccountProfilesState, AppPaths, MailAccountProfile } from "../shared/contracts";
import { findExecutable, runFile } from "./process";

export async function discoverAccounts(env: NodeJS.ProcessEnv = process.env): Promise<MailAccountProfile[]> {
  const executable = await findExecutable("hey", env);
  if (!executable) throw new Error("HEY CLI is unavailable. Check Local services in Settings.");
  const options = { env: { ...env, HEY_NONINTERACTIVE: "1" }, timeoutMs: 10_000 };
  const auth = JSON.parse((await runFile(executable, ["auth", "status", "--json"], options)).stdout);
  if (!auth.ok || !auth.data?.authenticated) throw new Error("Sign in using hey auth login, then try again.");
  const server = new URL(auth.data.base_url).origin;
  const response = JSON.parse((await runFile(executable, ["account", "list", "--json"], options)).stdout);
  if (!response.ok || !Array.isArray(response.data)) throw new Error("HEY could not list linked accounts.");
  const accounts = response.data.flatMap((item: Record<string, unknown>) => {
    const accountId = String(item.id);
    if (!/^\d+$/.test(accountId) || item.status !== "active" || typeof item.email !== "string") return [];
    const key = createHash("sha256").update(`${server}\n${accountId}`).digest("hex").slice(0, 32);
    return [{ key, server, accountId, name: typeof item.name === "string" ? item.name : item.email, email: item.email }];
  });
  if (!accounts.length) throw new Error("No active linked mail accounts are available.");
  return accounts;
}

type Manifest = { version: 1; selected?: string; legacyOwner?: string };

export class AccountProfiles {
  state: AccountProfilesState = { token: randomUUID(), accounts: [] };
  private manifest: Manifest = { version: 1 };
  constructor(private readonly paths: AppPaths, private readonly discover = discoverAccounts) {}

  async initialize(): Promise<void> {
    try {
      try { this.manifest = JSON.parse(await readFile(join(this.paths.state, "profiles.json"), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("The account profile index could not be read. Existing data has been left untouched."); }
      if (this.manifest.version !== 1) throw new Error("Unsupported account profile index.");
      const accounts = await this.discover();
      this.state = { token: randomUUID(), accounts };
      const selected = this.manifest.selected ?? (accounts.length === 1 ? accounts[0]!.key : undefined);
      if (selected && accounts.some((account) => account.key === selected)) await this.select(selected, accounts);
      else this.state = { ...this.state, needsSelection: true, ...(selected ? { error: "Your previous account is unavailable. Select a linked account to continue." } : {}) };
    } catch (error) {
      this.state = { token: randomUUID(), accounts: [], error: error instanceof Error ? error.message : "HEY accounts are unavailable." };
    }
  }

  async select(key: string, verifiedAccounts?: MailAccountProfile[]): Promise<void> {
    const accounts = verifiedAccounts ?? await this.discover();
    const active = accounts.find((account) => account.key === key);
    if (!active) throw new Error("That account is no longer available. Refresh your linked accounts.");
    const manifest = { ...this.manifest, selected: key, legacyOwner: this.manifest.legacyOwner ?? key };
    // Reserve migration ownership first. A crash can retry the copy only for this account.
    await mkdir(this.paths.state, { recursive: true, mode: 0o700 });
    const manifestPath = join(this.paths.state, "profiles.json");
    await writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest), { mode: 0o600 });
    await rename(`${manifestPath}.tmp`, manifestPath);
    this.manifest = manifest;
    const directories = this.directories(key);
    await Promise.all([directories.state, directories.workspace].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
    if (manifest.legacyOwner === key) {
      try { await copyFile(join(this.paths.state, "chats.json"), join(directories.state, "chats.json"), constants.COPYFILE_EXCL); }
      catch (error) { if (!["ENOENT", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    }
    this.state = { token: randomUUID(), accounts, active };
  }

  directories(key: string) {
    if (!/^[a-f0-9]{32}$/.test(key)) throw new Error("Invalid profile key.");
    return { state: join(this.paths.state, "profiles", key), workspace: join(this.paths.workspace, "profiles", key) };
  }

  assertToken(token: unknown): MailAccountProfile {
    if (token !== this.state.token || !this.state.active) throw new Error("This account view has expired. Reopen the account before continuing.");
    return this.state.active;
  }
}
