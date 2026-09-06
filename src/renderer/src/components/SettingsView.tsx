import { ChevronDown, ChevronRight, Volume2 as Volume2Data, VolumeX as VolumeXData } from "lucide";
import { AudioLines, Check, FolderOpen, Keyboard, Play, RefreshCw, RotateCcw, ServerCog, Sparkles, WandSparkles, Type as TypeIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AGENT_THINKING_LEVELS, SOUND_PACKS, type AgentModelCatalogItem, type AgentModelProfile, type AiSettings, type AppSettings, type InterfaceFont, type ShortcutProfile, type SoundPack, type SoundSettings, type SystemStatus, type ThemeSnapshot } from "../../../shared/contracts";
import { resolveShortcuts } from "../shortcuts";
import { appSound } from "../sound";
import MorphingIcon from "./MorphingIcon";
import type { HelperId } from "../../../shared/helpers";
import HelperSettings from "./HelperSettings";
import ShortcutEditor from "./ShortcutEditor";

type SettingsViewProps = {
  settings: AppSettings;
  theme?: ThemeSnapshot;
  onSettings: (settings: AppSettings) => void;
  onRunHelper: (id: HelperId) => void;
  onEditHelper: () => void;
  runnableHelpers: HelperId[];
  busyHelpers: Set<HelperId>;
};

const PROFILES: Array<{ id: ShortcutProfile; title: string; description: string }> = [
  { id: "hey", title: "HEY-like", description: "Native HEY keys first, with compatible Superhuman aliases." },
  { id: "superhuman", title: "Superhuman", description: "Superhuman keys and G navigation first, with HEY number aliases." },
  { id: "custom", title: "Custom", description: "Start from HEY-like keys and override individual commands." },
];

const INTERFACE_FONTS: Array<{ id: InterfaceFont; title: string; description: string }> = [
  { id: "instrument", title: "Instrument Sans", description: "The crisp, consistent HEY Agent typeface." },
  { id: "system", title: "System default", description: "Use your desktop's native interface font." },
  { id: "system-mono", title: "System mono", description: "Use Omarchy's selected monospace font." },
];

type SectionId = "typography" | "shortcuts" | "sound" | "models" | "helpers" | "services" | "details";

function SettingsSection({ id, title, icon, summary, open, onToggle, children }: {
  id: SectionId; title: string; icon: ReactNode; summary: string; open: boolean;
  onToggle: (id: SectionId) => void; children: ReactNode;
}) {
  return <section className="settings-section">
    <h2 className="settings-section-title">
      <button type="button" className="settings-section-toggle" id={`settings-${id}-toggle`} aria-expanded={open} aria-controls={`settings-${id}-content`} onClick={(event) => {
        const button = event.currentTarget;
        onToggle(id);
        requestAnimationFrame(() => button.scrollIntoView({ block: "nearest" }));
      }} onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const buttons = [...event.currentTarget.closest(".settings-scroll")!.querySelectorAll<HTMLButtonElement>(".settings-section-toggle")];
        const index = buttons.indexOf(event.currentTarget);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
        <span className="settings-section-icon" aria-hidden="true">{icon}</span>
        <span className="settings-section-label">{title}</span>
        <span className="settings-section-summary">{summary}</span>
        <MorphingIcon icon={open ? ChevronDown : ChevronRight} size={14} />
      </button>
    </h2>
    {/* Keep editors mounted so collapsing a section never loses unsaved work. */}
    <div id={`settings-${id}-content`} className="settings-section-content" role="region" aria-labelledby={`settings-${id}-toggle`} hidden={!open}>{children}</div>
  </section>;
}

const PACK_LABELS: Record<SoundPack, string> = {
  minimal: "Minimal", soft: "Soft", glass: "Glass", arcade: "Arcade", mechanical: "Mechanical", organic: "Organic",
  dreamy: "Dreamy", scifi: "Sci-fi", rubber: "Rubber", cinematic: "Cinematic", studio: "Studio", zen: "Zen",
};

const SOUND_TOGGLES: Array<{ key: keyof Pick<SoundSettings, "interfaceSounds" | "mailSounds" | "agentSounds" | "agentLoops" | "notificationSounds">; label: string; description: string }> = [
  { key: "interfaceSounds", label: "Interface actions", description: "Opening, closing, selection, and undo." },
  { key: "mailSounds", label: "Mail actions", description: "Send, move, trash, and delivery outcomes." },
  { key: "agentSounds", label: "Agent outcomes", description: "Messages sent, answers received, and errors." },
  { key: "agentLoops", label: "Agent activity", description: "A quiet continuous texture while the agent connects or works." },
  { key: "notificationSounds", label: "Background notifications", description: "Reserved for new mail and mentions. Off by default." },
];

function SoundSwitch({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" className="sound-switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}

export default function SettingsView({ settings, theme, onSettings, onRunHelper, onEditHelper, runnableHelpers, busyHelpers }: SettingsViewProps) {
  const [openSection, setOpenSection] = useState<SectionId | null>(null);
  const toggleSection = (id: SectionId) => {
    appSound.play(openSection === id ? "close" : "open", "interface");
    setOpenSection((current) => current === id ? null : id);
  };
  const sectionProps = (id: SectionId) => ({ id, open: openSection === id, onToggle: toggleSection });
  const [status, setStatus] = useState<SystemStatus>();
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<AgentModelCatalogItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelError, setModelError] = useState<string>();
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [appearanceError, setAppearanceError] = useState<string>();
  const shortcuts = useMemo(() => resolveShortcuts(settings).filter((item) => !item.id.startsWith("session-") || ["session-new", "session-close", "session-next", "session-previous"].includes(item.id)), [settings]);

  const refreshStatus = async () => {
    setLoading(true);
    try { setStatus(await window.heyAgent.system.getStatus()); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refreshStatus(); }, []);

  const refreshModels = async (refresh = false) => {
    setModelsLoading(true); setModelError(undefined);
    try { setModels(await window.heyAgent.writing.listModels(refresh)); }
    catch (reason) { setModelError(reason instanceof Error ? reason.message : "Pi could not list the configured models."); }
    finally { setModelsLoading(false); }
  };
  useEffect(() => { void refreshModels(false); }, []);

  const chooseProfile = async (shortcutProfile: ShortcutProfile) => {
    onSettings(await window.heyAgent.settings.update({ shortcutProfile }));
  };

  const chooseInterfaceFont = async (interfaceFont: InterfaceFont) => {
    onSettings(await window.heyAgent.settings.update({ interfaceFont }));
  };

  const chooseSenderAvatars = async (showSenderAvatars: boolean) => {
    setSavingAppearance(true); setAppearanceError(undefined);
    try { onSettings(await window.heyAgent.settings.update({ showSenderAvatars })); }
    catch { setAppearanceError("Could not save this preference. Try again."); }
    finally { setSavingAppearance(false); }
  };

  const saveSound = async (sound: Partial<SoundSettings>, preview?: "toggle-on" | "toggle-off" | "select" | "volume-change") => {
    if (preview === "toggle-off") await appSound.preview(preview);
    const next = await window.heyAgent.settings.update({ sound });
    appSound.configure(next.sound);
    onSettings(next);
    if (preview && preview !== "toggle-off") await appSound.preview(preview);
  };

  const saveAi = async (ai: Partial<AiSettings>) => onSettings(await window.heyAgent.settings.update({ ai }));

  const saveModel = async (key: "general" | "quick", value: string) => {
    const current = settings.ai[key];
    const model = value ? JSON.parse(value) as AgentModelProfile["model"] : undefined;
    await saveAi({ [key]: { ...(model ? { model } : {}), thinking: current.thinking } });
  };

  const saveThinking = async (key: "general" | "quick", thinking: AgentModelProfile["thinking"]) => {
    await saveAi({ [key]: { ...settings.ai[key], thinking } });
  };

  const profileOptions = (profile: AgentModelProfile) => {
    const grouped = [...new Set(models.map((model) => model.provider))].sort();
    const selectedValue = profile.model ? JSON.stringify(profile.model) : "";
    const available = !profile.model || models.some((model) => model.provider === profile.model!.provider && model.id === profile.model!.modelId);
    return <>
      <option value="">Pi default</option>
      {!available && <option value={selectedValue}>{profile.model!.provider} · {profile.model!.modelId} (unavailable)</option>}
      {grouped.map((provider) => <optgroup key={provider} label={provider}>{models.filter((model) => model.provider === provider).map((model) => <option key={`${provider}:${model.id}`} value={JSON.stringify({ provider, modelId: model.id })}>{model.name}</option>)}</optgroup>)}
    </>;
  };


  return <section className="panel settings-panel" aria-label="Settings">
    <header className="panel-header"><div className="title-cluster"><h1>Settings</h1></div></header>
    <div className="settings-scroll">
      <SettingsSection {...sectionProps("typography")} title="Appearance" icon={<TypeIcon size={16} />} summary={INTERFACE_FONTS.find((font) => font.id === settings.interfaceFont)!.title}>
        <p className="settings-section-description">Font for mail, navigation, and chat.</p>
        <div className="interface-font-options" role="radiogroup" aria-label="Interface typeface">
          {INTERFACE_FONTS.map((font) => <label key={font.id} className={`interface-font-option is-${font.id}`} data-selected={settings.interfaceFont === font.id}><input type="radio" name="interface-font" value={font.id} checked={settings.interfaceFont === font.id} onChange={() => void chooseInterfaceFont(font.id)} /><span className="interface-font-check">{settings.interfaceFont === font.id && <Check size={13} />}</span><span><strong>{font.title}</strong><small>{font.description}</small></span><em aria-hidden="true">Ag</em></label>)}
        </div>
        <div className="settings-section-toolbar mail-appearance-setting">
          <span><strong>Show sender avatars</strong><small>Small contact pictures beside names in email lists.</small></span>
          <SoundSwitch checked={settings.showSenderAvatars} label="Show sender avatars" disabled={savingAppearance} onChange={(checked) => void chooseSenderAvatars(checked)} />
        </div>
        {appearanceError && <p className="settings-inline-error" role="alert">{appearanceError}</p>}
      </SettingsSection>

      <SettingsSection {...sectionProps("shortcuts")} title="Keyboard shortcuts" icon={<Keyboard size={16} />} summary={PROFILES.find((profile) => profile.id === settings.shortcutProfile)!.title}>
        <div className="shortcut-profile-grid">{PROFILES.map((profile) => <button key={profile.id} type="button" className="shortcut-profile" data-selected={settings.shortcutProfile === profile.id} onClick={() => void chooseProfile(profile.id)}><span>{settings.shortcutProfile === profile.id && <Check size={13} />}</span><strong>{profile.title}</strong><p>{profile.description}</p></button>)}</div>
        {settings.shortcutProfile === "custom" && <div className="custom-shortcuts">
          <header><strong>Custom bindings</strong><span>One shortcut per line, up to five aliases. Use Ctrl+K or g i; punctuation such as g , is supported. Reset restores HEY-like keys. Disable removes the shortcut. Composer bindings only apply inside mail editors; desktop-reserved keys may be intercepted by your system.</span></header>
          {shortcuts.map((shortcut) => <ShortcutEditor key={shortcut.id} shortcut={shortcut} settings={settings} onSettings={onSettings} />)}
        </div>}
      </SettingsSection>

      <SettingsSection {...sectionProps("sound")} title="Sound" icon={<MorphingIcon icon={settings.sound.enabled ? Volume2Data : VolumeXData} size={16} />} summary={settings.sound.enabled ? `${PACK_LABELS[settings.sound.pack]} · ${Math.round(settings.sound.volume * 100)}%` : "Off"}>
        <div className="settings-section-toolbar"><span>Sound effects</span><SoundSwitch checked={settings.sound.enabled} label="Sound effects" onChange={(enabled) => void saveSound({ enabled }, enabled ? "toggle-on" : "toggle-off")} /></div>
        <div className="sound-primary" data-disabled={!settings.sound.enabled}>
          <label className="sound-pack"><span><strong>Sound style</strong><small>Zen is the calm default for reading and focus.</small></span><select value={settings.sound.pack} disabled={!settings.sound.enabled} onChange={(event) => void saveSound({ pack: event.currentTarget.value as SoundPack }, "select")}>{SOUND_PACKS.map((pack) => <option key={pack} value={pack}>{PACK_LABELS[pack]}</option>)}</select></label>
          <label className="sound-volume"><span><strong>Volume</strong><small>{Math.round(settings.sound.volume * 100)}%</small></span><input type="range" min="0" max="1" step="0.05" value={settings.sound.volume} disabled={!settings.sound.enabled} aria-label="Sound effects volume" onChange={(event) => void saveSound({ volume: Number(event.currentTarget.value) }, "volume-change")} /></label>
        </div>
        <div className="sound-category-list">{SOUND_TOGGLES.map((item) => <div key={item.key}><span><strong>{item.label}</strong><small>{item.description}</small></span><SoundSwitch checked={settings.sound[item.key]} label={item.label} disabled={!settings.sound.enabled || item.key === "agentLoops" && !settings.sound.agentSounds} onChange={(checked) => void saveSound({ [item.key]: checked }, checked ? "toggle-on" : "toggle-off")} /></div>)}</div>
        <div className="sound-preview"><span><AudioLines size={14} /><span><strong>Hear the mapping</strong><small>Preview the cues used for mail and agent work.</small></span></span><div><button type="button" disabled={!settings.sound.enabled} onClick={() => void appSound.preview("send")}><Play size={11} /> Send</button><button type="button" disabled={!settings.sound.enabled} onClick={() => void appSound.preview("processing", { loop: false })}><Play size={11} /> Thinking</button><button type="button" disabled={!settings.sound.enabled} onClick={() => void appSound.preview("receive")}><Play size={11} /> Answer</button><button type="button" disabled={!settings.sound.enabled} onClick={() => void appSound.preview("error")}><Play size={11} /> Error</button></div></div>
      </SettingsSection>

      <SettingsSection {...sectionProps("models")} title="AI models" icon={<Sparkles size={16} />} summary="Chat and quick writing">
        <div className="settings-section-toolbar"><span>Models from Pi</span><button type="button" className="icon-button" aria-label="Refresh Pi models" data-tooltip="Refresh models" onClick={() => void refreshModels(true)} disabled={modelsLoading}><RefreshCw size={14} className={modelsLoading ? "is-spinning" : ""} /></button></div>
        <div className="ai-model-profile-list">
          <div><span><strong>General agent</strong><small>New chat sessions</small></span><div className="ai-model-fields"><select aria-label="General agent model" value={settings.ai.general.model ? JSON.stringify(settings.ai.general.model) : ""} onChange={(event) => void saveModel("general", event.currentTarget.value)}>{profileOptions(settings.ai.general)}</select><select aria-label="General agent thinking" value={settings.ai.general.thinking} onChange={(event) => void saveThinking("general", event.currentTarget.value as AgentModelProfile["thinking"])}>{AGENT_THINKING_LEVELS.map((level) => <option key={level} value={level}>{level === "inherit" ? "Pi thinking default" : `${level} thinking`}</option>)}</select></div></div>
          <div><span><strong>Quick writing</strong><small>Composer suggestions</small></span><div className="ai-model-fields"><label className="ai-model-inherit"><input type="checkbox" checked={settings.ai.quickUsesGeneral} onChange={(event) => void saveAi({ quickUsesGeneral: event.currentTarget.checked })} /> Same as General</label>{!settings.ai.quickUsesGeneral && <><select aria-label="Quick writing model" value={settings.ai.quick.model ? JSON.stringify(settings.ai.quick.model) : ""} onChange={(event) => void saveModel("quick", event.currentTarget.value)}>{profileOptions(settings.ai.quick)}</select><select aria-label="Quick writing thinking" value={settings.ai.quick.thinking} onChange={(event) => void saveThinking("quick", event.currentTarget.value as AgentModelProfile["thinking"])}>{AGENT_THINKING_LEVELS.map((level) => <option key={level} value={level}>{level === "inherit" ? "Pi thinking default" : `${level} thinking`}</option>)}</select></>}</div></div>
        </div>
        {modelError && <p className="settings-inline-error">{modelError}</p>}
      </SettingsSection>

      <SettingsSection {...sectionProps("helpers")} title="Helpers" icon={<WandSparkles size={16} />} summary={`${settings.helpers.enabled.length} enabled`}>
        <HelperSettings settings={settings} onSettings={onSettings} onRun={onRunHelper} onEdit={onEditHelper} runnable={runnableHelpers} busyHelpers={busyHelpers} />
      </SettingsSection>

      <SettingsSection {...sectionProps("services")} title="Local services" icon={<ServerCog size={16} />} summary="HEY CLI and Pi">
        <div className="settings-section-toolbar"><span>Connection status</span><button type="button" className="icon-button" aria-label="Refresh local service status" data-tooltip="Refresh status" onClick={() => void refreshStatus()} disabled={loading}><RefreshCw size={14} className={loading ? "is-spinning" : ""} /></button></div>
        <div className="runtime-grid">{status?.runtimes.map((runtime) => <article key={runtime.id}><span className={`runtime-dot is-${runtime.status}`} /><div><strong>{runtime.label}</strong><p>{runtime.status === "ready" ? runtime.version ?? "Ready" : runtime.detail ?? runtime.status}</p></div></article>)}</div>
      </SettingsSection>

      <SettingsSection {...sectionProps("details")} title="App details" icon={<FolderOpen size={16} />} summary={theme?.name ?? "Theme and local paths"}>
        <dl className="settings-details">
          <div><dt>Theme</dt><dd>{theme?.name ?? "Loading…"}</dd></div>
          <div><dt>Agent workspace</dt><dd>{status?.paths.workspace ?? "Loading…"}</dd></div>
          <div><dt>Configuration</dt><dd>{status?.paths.config ?? "Loading…"}</dd></div>
          <div><dt>State</dt><dd>{status?.paths.state ?? "Loading…"}</dd></div>
        </dl>
        <button type="button" className="settings-reset" onClick={() => void window.heyAgent.settings.reset().then(onSettings)}><RotateCcw size={14} /> Reset settings</button>
      </SettingsSection>
    </div>
  </section>;
}
