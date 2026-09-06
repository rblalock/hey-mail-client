import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeBindings } from "../shared/shortcut-binding";
import { validateCustomShortcuts } from "../shared/shortcuts";
import { AGENT_THINKING_LEVELS, DEFAULT_AI_SETTINGS, DEFAULT_SOUND_SETTINGS, SOUND_PACKS, isInterfaceFont, type AgentModelProfile, type AiSettings, type AppSettings, type AppSettingsUpdate, type HelperSettings, type ShortcutProfile, type SoundSettings } from "../shared/contracts";
import { DEFAULT_ENABLED_HELPERS, HELPER_CATALOG_VERSION, customHelpersError, isHelperId, type CustomHelper } from "../shared/helpers";

const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  interfaceFont: "instrument",
  showSenderAvatars: false,
  shortcutProfile: "hey",
  customShortcuts: {},
  sound: DEFAULT_SOUND_SETTINGS,
  ai: DEFAULT_AI_SETTINGS,
  helpers: { catalogVersion: HELPER_CATALOG_VERSION, enabled: DEFAULT_ENABLED_HELPERS },
};

function isProfile(value: unknown): value is ShortcutProfile {
  return value === "hey" || value === "superhuman" || value === "custom";
}

function normalizeShortcuts(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, bindings]) => {
    if (!/^[a-z][a-z0-9-]{0,49}$/.test(id) || !Array.isArray(bindings)) return [];
    const safe = bindings
      .filter((binding): binding is string => typeof binding === "string")
      .map((binding) => binding.trim().toLowerCase())
      .filter((binding) => binding.length > 0 && binding.length <= 80 && !/[\r\n\0]/.test(binding))
      .slice(0, 5);
    try { return [[id, normalizeBindings(bindings.length === 0 ? [] : safe)]]; } catch { return []; }
  }));
}

function normalizeSound(value: unknown): SoundSettings {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<SoundSettings> : {};
  const volume = typeof item.volume === "number" && Number.isFinite(item.volume)
    ? Math.min(1, Math.max(0, item.volume))
    : DEFAULT_SOUND_SETTINGS.volume;
  return {
    enabled: typeof item.enabled === "boolean" ? item.enabled : DEFAULT_SOUND_SETTINGS.enabled,
    pack: typeof item.pack === "string" && SOUND_PACKS.includes(item.pack as SoundSettings["pack"]) ? item.pack as SoundSettings["pack"] : DEFAULT_SOUND_SETTINGS.pack,
    volume,
    interfaceSounds: typeof item.interfaceSounds === "boolean" ? item.interfaceSounds : DEFAULT_SOUND_SETTINGS.interfaceSounds,
    mailSounds: typeof item.mailSounds === "boolean" ? item.mailSounds : DEFAULT_SOUND_SETTINGS.mailSounds,
    agentSounds: typeof item.agentSounds === "boolean" ? item.agentSounds : DEFAULT_SOUND_SETTINGS.agentSounds,
    agentLoops: typeof item.agentLoops === "boolean" ? item.agentLoops : DEFAULT_SOUND_SETTINGS.agentLoops,
    notificationSounds: typeof item.notificationSounds === "boolean" ? item.notificationSounds : DEFAULT_SOUND_SETTINGS.notificationSounds,
  };
}

function normalizeModelProfile(value: unknown): AgentModelProfile {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<AgentModelProfile> : {};
  const candidate = item.model && typeof item.model === "object" ? item.model : undefined;
  const model = candidate && typeof candidate.provider === "string" && candidate.provider.length > 0 && candidate.provider.length <= 120 && !/[\r\n\0]/.test(candidate.provider)
    && typeof candidate.modelId === "string" && candidate.modelId.length > 0 && candidate.modelId.length <= 240 && !/[\r\n\0]/.test(candidate.modelId)
    ? { provider: candidate.provider, modelId: candidate.modelId }
    : undefined;
  const thinking = typeof item.thinking === "string" && AGENT_THINKING_LEVELS.includes(item.thinking as AgentModelProfile["thinking"])
    ? item.thinking as AgentModelProfile["thinking"]
    : "inherit";
  return { ...(model ? { model } : {}), thinking };
}

function normalizeAi(value: unknown): AiSettings {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<AiSettings> : {};
  return {
    general: normalizeModelProfile(item.general),
    quickUsesGeneral: typeof item.quickUsesGeneral === "boolean" ? item.quickUsesGeneral : DEFAULT_AI_SETTINGS.quickUsesGeneral,
    quick: normalizeModelProfile(item.quick),
  };
}

function normalizeHelpers(value: unknown): HelperSettings {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<HelperSettings> : {};
  const saved = Array.isArray(item.enabled) ? [...new Set(item.enabled.filter(isHelperId))] : [...DEFAULT_ENABLED_HELPERS];
  const custom: CustomHelper[] = item.custom && !customHelpersError(item.custom) ? item.custom.map((helper) => ({ id: helper.id, title: helper.title.trim(), instructions: helper.instructions.trim(), context: helper.context, modelProfile: helper.modelProfile })) : [];
  const validIds = new Set([...DEFAULT_ENABLED_HELPERS, ...custom.map((helper) => helper.id)]);
  const catalogVersion = typeof item.catalogVersion === "number" ? item.catalogVersion : 0;
  const additions = catalogVersion < 1 ? DEFAULT_ENABLED_HELPERS.filter((id) => id !== "meeting-prep") : catalogVersion < 2 ? ["daily-brief", "calendar-triage"] as const : [];
  const preferences = Object.fromEntries(["daily-brief", "calendar-triage"].flatMap((id) => {
    const text = item.preferences?.[id as "daily-brief" | "calendar-triage"];
    return typeof text === "string" && text.length <= 2_000 && !text.includes("\0") ? [[id, text.trim()]] : [];
  }));
  return {
    catalogVersion: HELPER_CATALOG_VERSION,
    enabled: [...new Set([...saved, ...additions])].filter((id) => validIds.has(id)),
    custom,
    preferences,
  };
}

function normalize(value: unknown): AppSettings {
  const item = value && typeof value === "object" ? value as Partial<AppSettings> : {};
  return {
    version: 1,
    interfaceFont: isInterfaceFont(item.interfaceFont) ? item.interfaceFont : DEFAULT_SETTINGS.interfaceFont,
    showSenderAvatars: item.showSenderAvatars === true,
    shortcutProfile: isProfile(item.shortcutProfile) ? item.shortcutProfile : DEFAULT_SETTINGS.shortcutProfile,
    customShortcuts: normalizeShortcuts(item.customShortcuts),
    sound: normalizeSound(item.sound),
    ai: normalizeAi(item.ai),
    helpers: normalizeHelpers(item.helpers),
  };
}

export class SettingsStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async get(): Promise<AppSettings> {
    await this.queue;
    return this.read();
  }

  async update(update: AppSettingsUpdate): Promise<AppSettings> {
    const operation = this.queue.then(async () => {
      if (update.helpers?.custom !== undefined) {
        const error = customHelpersError(update.helpers.custom);
        if (error) throw new Error(error);
      }
      const current = await this.read();
      let customShortcuts = current.customShortcuts;
      if (update.customShortcuts !== undefined) customShortcuts = validateCustomShortcuts(update.customShortcuts);
      if (update.shortcutEdit !== undefined) {
        const { id, bindings } = update.shortcutEdit;
        // Validate IDs even for reset, then merge inside the serialized write queue.
        validateCustomShortcuts({ [id]: [] });
        customShortcuts = { ...customShortcuts };
        if (bindings === null) delete customShortcuts[id];
        else customShortcuts[id] = normalizeBindings(bindings);
        customShortcuts = validateCustomShortcuts(customShortcuts);
      }
      const next = normalize({
        ...current,
        ...(update.interfaceFont === undefined ? {} : { interfaceFont: update.interfaceFont }),
        ...(update.showSenderAvatars === undefined ? {} : { showSenderAvatars: update.showSenderAvatars }),
        ...(update.shortcutProfile === undefined ? {} : { shortcutProfile: update.shortcutProfile }),
        customShortcuts,
        ...(update.sound === undefined ? {} : { sound: { ...current.sound, ...update.sound } }),
        ...(update.ai === undefined ? {} : { ai: { ...current.ai, ...update.ai } }),
        ...(update.helpers === undefined ? {} : { helpers: { ...current.helpers, ...update.helpers } }),
      });
      await this.write(next);
      return next;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async reset(): Promise<AppSettings> {
    const operation = this.queue.then(async () => {
      const next = structuredClone(DEFAULT_SETTINGS);
      // Authored instructions are user content, not disposable UI preferences.
      next.helpers = (await this.read()).helpers;
      await this.write(next);
      return next;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async read(): Promise<AppSettings> {
    try { return normalize(JSON.parse(await readFile(this.file, "utf8"))); }
    catch { return structuredClone(DEFAULT_SETTINGS); }
  }

  private async write(settings: AppSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
