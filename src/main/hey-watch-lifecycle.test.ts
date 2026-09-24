import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { HeyWatcher } from "./hey-watch";
import { spawn } from "node:child_process";

vi.mock("./process", () => ({ findExecutable: vi.fn(async () => "/synthetic/hey") }));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it.each([2, 3])("does not repeatedly restart a watcher after exit %s", async (code) => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const changed = vi.fn();
  const watcher = new HeyWatcher(changed);
  await watcher.start();
  child.emit("close", code);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledWith({ change: "disconnected" });
  watcher.stop();
});

it("still reconnects after a transient failure and cancels pending retry on stop", async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const watcher = new HeyWatcher(vi.fn());
  await watcher.start(); child.emit("close", 1);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(spawn).toHaveBeenCalledTimes(2);
  child.emit("close", 1); watcher.stop();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(spawn).toHaveBeenCalledTimes(2);
});
