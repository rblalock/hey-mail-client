import { AGENT_THINKING_LEVELS, SOUND_PACKS, isInterfaceFont, type AppSettingsUpdate } from "../shared/contracts";
import { customHelpersError, isHelperId } from "../shared/helpers";
import type { SettingsStore } from "./settings-store";

// Shared by the IPC handler and regression tests, before anything reaches disk.
export function updateSettingsFromIpc(store: SettingsStore, value: unknown) {
  if (!isSettingsUpdate(value)) throw new Error("Invalid HEY Agent settings.");
  return store.update(value);
}

function isSettingsUpdate(value: unknown): value is AppSettingsUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const update = value as Partial<AppSettingsUpdate>;
  if (update.shortcutEdit !== undefined && (!update.shortcutEdit || typeof update.shortcutEdit.id !== "string" || update.shortcutEdit.bindings !== null && !Array.isArray(update.shortcutEdit.bindings))) return false;
  if (update.showSenderAvatars !== undefined && typeof update.showSenderAvatars !== "boolean") return false;
  if (update.interfaceFont !== undefined && !isInterfaceFont(update.interfaceFont)) return false;
  if (update.shortcutProfile !== undefined && !["hey", "superhuman", "custom"].includes(update.shortcutProfile)) return false;
  if (update.customShortcuts !== undefined && (!update.customShortcuts || typeof update.customShortcuts !== "object" || Array.isArray(update.customShortcuts))) return false;
  if (update.sound !== undefined) {
    if (!update.sound || typeof update.sound !== "object" || Array.isArray(update.sound)) return false;
    const sound = update.sound as NonNullable<AppSettingsUpdate["sound"]>;
    if (sound.pack !== undefined && !SOUND_PACKS.includes(sound.pack)) return false;
    if (sound.volume !== undefined && (typeof sound.volume !== "number" || !Number.isFinite(sound.volume) || sound.volume < 0 || sound.volume > 1)) return false;
    for (const key of ["enabled", "interfaceSounds", "mailSounds", "agentSounds", "agentLoops", "notificationSounds"] as const) {
      if (sound[key] !== undefined && typeof sound[key] !== "boolean") return false;
    }
  }
  if (update.ai !== undefined) {
    if (!update.ai || typeof update.ai !== "object" || Array.isArray(update.ai)) return false;
    if (update.ai.quickUsesGeneral !== undefined && typeof update.ai.quickUsesGeneral !== "boolean") return false;
    for (const key of ["general", "quick"] as const) {
      const profile = update.ai[key];
      if (profile === undefined) continue;
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
      if (!AGENT_THINKING_LEVELS.includes(profile.thinking)) return false;
      if (profile.model !== undefined && (!profile.model || typeof profile.model !== "object"
        || typeof profile.model.provider !== "string" || !profile.model.provider || profile.model.provider.length > 120
        || typeof profile.model.modelId !== "string" || !profile.model.modelId || profile.model.modelId.length > 240
        || /[\r\n\0]/.test(profile.model.provider) || /[\r\n\0]/.test(profile.model.modelId))) return false;
    }
  }
  if (update.helpers !== undefined) {
    if (!update.helpers || typeof update.helpers !== "object" || Array.isArray(update.helpers)) return false;
    if (update.helpers.enabled !== undefined && (!Array.isArray(update.helpers.enabled) || !update.helpers.enabled.every(isHelperId))) return false;
    if (update.helpers.custom !== undefined && customHelpersError(update.helpers.custom)) return false;
    if (update.helpers.preferences !== undefined) {
      if (!update.helpers.preferences || typeof update.helpers.preferences !== "object" || Array.isArray(update.helpers.preferences)) return false;
      if (Object.entries(update.helpers.preferences).some(([key, text]) => !["daily-brief", "calendar-triage"].includes(key) || typeof text !== "string" || text.length > 2_000 || text.includes("\0"))) return false;
    }
  }
  return true;
}
