import { createUISFX, type CueName, type PlayOptions, type PlayingSFX, type UISFXPlayer } from "uisfx";
import type { SoundSettings } from "../../shared/contracts";
import { DEFAULT_SETTINGS } from "./shortcuts";

export type SoundChannel = "interface" | "mail" | "agent" | "agent-loop" | "notification";
type PlayerFactory = (settings: SoundSettings) => UISFXPlayer;
type ActiveLoop = { cue: CueName; playing: PlayingSFX };

function channelEnabled(settings: SoundSettings, channel: SoundChannel): boolean {
  if (!settings.enabled) return false;
  if (channel === "interface") return settings.interfaceSounds;
  if (channel === "mail") return settings.mailSounds;
  if (channel === "agent") return settings.agentSounds;
  if (channel === "agent-loop") return settings.agentSounds && settings.agentLoops;
  return settings.notificationSounds;
}

export class SoundController {
  private settings = DEFAULT_SETTINGS.sound;
  private player?: UISFXPlayer;
  private unlocked = false;
  private unlocking?: Promise<boolean>;
  private loops = new Map<string, ActiveLoop>();

  constructor(private readonly createPlayer: PlayerFactory = (settings) => createUISFX({ pack: settings.pack, volume: settings.volume, enabled: settings.enabled })) {}

  configure(settings: SoundSettings): void {
    this.settings = settings;
    if (!this.player) return;
    this.player.setPack(settings.pack);
    this.player.setVolume(settings.volume);
    this.player.setEnabled(settings.enabled);
    if (!settings.enabled) this.stopAll();
    if (!settings.agentSounds || !settings.agentLoops) this.stopChannelLoops("agent:");
  }

  async unlock(): Promise<boolean> {
    if (!this.settings.enabled) return false;
    if (this.unlocked) return true;
    if (this.unlocking) return this.unlocking;
    const player = this.getPlayer();
    this.unlocking = player.unlock().then((unlocked) => {
      this.unlocked = unlocked;
      return unlocked;
    }).catch(() => false).finally(() => { this.unlocking = undefined; });
    return this.unlocking;
  }

  play(cue: CueName, channel: SoundChannel, options?: PlayOptions): PlayingSFX | null {
    if (!this.unlocked || !channelEnabled(this.settings, channel)) return null;
    return this.getPlayer().play(cue, options);
  }

  async preview(cue: CueName, options?: PlayOptions): Promise<PlayingSFX | null> {
    if (!this.settings.enabled || !await this.unlock()) return null;
    return this.getPlayer().play(cue, options);
  }

  startLoop(key: string, cue: CueName, channel: SoundChannel): PlayingSFX | null {
    const active = this.loops.get(key);
    if (active?.cue === cue) return active.playing;
    if (active) this.stopLoop(key);
    const playing = this.play(cue, channel, { loop: true, retrigger: "ignore" });
    if (!playing) return null;
    this.loops.set(key, { cue, playing });
    void playing.ended.finally(() => {
      if (this.loops.get(key)?.playing === playing) this.loops.delete(key);
    });
    return playing;
  }

  stopLoop(key: string): void {
    const active = this.loops.get(key);
    if (!active) return;
    this.loops.delete(key);
    active.playing.stop();
  }

  stopAll(): void {
    for (const active of this.loops.values()) active.playing.stop();
    this.loops.clear();
    this.player?.stopAll();
  }

  private stopChannelLoops(prefix: string): void {
    for (const key of [...this.loops.keys()]) if (key.startsWith(prefix)) this.stopLoop(key);
  }

  private getPlayer(): UISFXPlayer {
    this.player ??= this.createPlayer(this.settings);
    return this.player;
  }
}

export const appSound = new SoundController();

export function installSoundUnlock(): () => void {
  const unlock = () => { void appSound.unlock(); };
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
  return () => {
    window.removeEventListener("pointerdown", unlock, { capture: true });
    window.removeEventListener("keydown", unlock, { capture: true });
  };
}
