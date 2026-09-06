import { describe, expect, it, vi } from "vitest";
import type { PlayingSFX, UISFXPlayer } from "uisfx";
import type { SoundSettings } from "../../shared/contracts";
import { SoundController } from "./sound";

const settings: SoundSettings = {
  enabled: true,
  pack: "zen",
  volume: 0.3,
  interfaceSounds: true,
  mailSounds: true,
  agentSounds: true,
  agentLoops: true,
  notificationSounds: false,
};

function harness() {
  const handles: PlayingSFX[] = [];
  const player = {
    unlock: vi.fn(async () => true),
    play: vi.fn(() => {
      const handle = { stop: vi.fn(), ended: new Promise<void>(() => undefined) };
      handles.push(handle);
      return handle;
    }),
    preload: vi.fn(async () => undefined),
    setPack: vi.fn(), getPack: vi.fn(() => "zen" as const),
    setVolume: vi.fn(), getVolume: vi.fn(() => 0.3),
    setEnabled: vi.fn(), isEnabled: vi.fn(() => true),
    stopAll: vi.fn(), destroy: vi.fn(async () => undefined),
  } satisfies UISFXPlayer;
  const sound = new SoundController(() => player);
  sound.configure(settings);
  return { sound, player, handles };
}

describe("SoundController", () => {
  it("suppresses asynchronous cues until a trusted interaction unlocks audio", async () => {
    const { sound, player } = harness();
    expect(sound.play("send", "mail")).toBeNull();
    await sound.unlock();
    sound.play("send", "mail");
    expect(player.play).toHaveBeenCalledWith("send", undefined);
  });

  it("honors channel preferences without making notification sounds by default", async () => {
    const { sound, player } = harness();
    await sound.unlock();
    sound.play("notification", "notification");
    sound.play("select", "interface");
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledWith("select", undefined);
  });

  it("retains and stops continuous agent sounds", async () => {
    const { sound, player, handles } = harness();
    await sound.unlock();
    expect(sound.startLoop("agent:session-1", "processing", "agent-loop")).toBeTruthy();
    sound.startLoop("agent:session-1", "processing", "agent-loop");
    expect(player.play).toHaveBeenCalledTimes(1);
    sound.stopLoop("agent:session-1");
    expect(handles[0]!.stop).toHaveBeenCalledOnce();
  });

  it("crossfades a keyed agent loop when the run begins streaming", async () => {
    const { sound, player, handles } = harness();
    await sound.unlock();
    sound.startLoop("agent:session-1", "processing", "agent-loop");
    sound.startLoop("agent:session-1", "streaming", "agent-loop");
    expect(handles[0]!.stop).toHaveBeenCalledOnce();
    expect(player.play).toHaveBeenNthCalledWith(1, "processing", { loop: true, retrigger: "ignore" });
    expect(player.play).toHaveBeenNthCalledWith(2, "streaming", { loop: true, retrigger: "ignore" });
  });

  it("stops active loops as soon as sound or agent loops are disabled", async () => {
    const { sound, handles } = harness();
    await sound.unlock();
    sound.startLoop("agent:session-1", "processing", "agent-loop");
    sound.configure({ ...settings, agentLoops: false });
    expect(handles[0]!.stop).toHaveBeenCalledOnce();
  });
});
