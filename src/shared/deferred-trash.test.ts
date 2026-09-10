import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { DeferredTrash, TRASH_UNDO_MS } from "./deferred-trash";

describe("delayed trash", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("does not write until five seconds and executes exactly once", async () => {
    const queue = new DeferredTrash();
    const write = vi.fn(async () => ({ message: "Moved" }));
    const result = queue.enqueue("one", "account-a", write);
    await vi.advanceTimersByTimeAsync(TRASH_UNDO_MS - 1);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ message: "Moved" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.size).toBe(0);
  });
  it("cancels without ever contacting HEY, including just before expiry", async () => {
    const queue = new DeferredTrash();
    const write = vi.fn(async () => ({ message: "Moved" }));
    const result = queue.enqueue("one", "a", write);
    await vi.advanceTimersByTimeAsync(4999);
    expect(queue.cancel("one", "a")).toBe(true);
    expect(queue.cancel("one", "a")).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    await expect(result).resolves.toEqual({ cancelled: true });
    expect(write).not.toHaveBeenCalled();
  });
  it("keeps rapid actions independent and account scoped", async () => {
    const queue = new DeferredTrash();
    const firstWrite = vi.fn(async () => ({ message: "first" }));
    const secondWrite = vi.fn(async () => ({ message: "second" }));
    const first = queue.enqueue("one", "a", firstWrite);
    await vi.advanceTimersByTimeAsync(1000);
    const second = queue.enqueue("two", "a", secondWrite);
    expect(queue.cancel("two", "b")).toBe(false);
    expect(queue.pause("one", "b", true)).toBeNull();
    expect(queue.cancel("two", "a")).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(first).resolves.toEqual({ message: "first" });
    await expect(second).resolves.toEqual({ cancelled: true });
    expect(firstWrite).toHaveBeenCalledTimes(1);
    expect(secondWrite).not.toHaveBeenCalled();
  });
  it("pauses and resumes the remaining time without resetting it", async () => {
    const queue = new DeferredTrash();
    const write = vi.fn(async () => ({ message: "Moved" }));
    const result = queue.enqueue("one", "a", write);
    await vi.advanceTimersByTimeAsync(2000);
    expect(queue.pause("one", "a", true)).toBe(3000);
    await vi.advanceTimersByTimeAsync(10000);
    expect(write).not.toHaveBeenCalled();
    expect(queue.pause("one", "a", false)).toBe(3000);
    await vi.advanceTimersByTimeAsync(2999);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
  });
  it("cannot claim cancellation once the write has begun", async () => {
    const queue = new DeferredTrash();
    let finish!: () => void;
    const result = queue.enqueue("one", "a", async () => { await new Promise<void>((resolve) => { finish = resolve; }); return { message: "Moved" }; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(queue.size).toBe(1);
    expect(queue.cancel("one", "a")).toBe(false);
    expect(queue.pause("one", "a", true)).toBeNull();
    finish(); await result;
    expect(queue.size).toBe(0);
  });
  it("finishes paused work on close, preserves context, and rejects new work", async () => {
    const context = new AsyncLocalStorage<string>();
    const queue = new DeferredTrash();
    // The main process explicitly captures and re-enters the profile context.
    const owner = "account-a";
    const write = vi.fn(async () => ({ message: context.getStore()! }));
    const result = queue.enqueue("one", owner, () => context.run(owner, write));
    await vi.advanceTimersByTimeAsync(2000);
    queue.pause("one", owner, true);
    const closing = queue.finishBeforeClose();
    expect(() => queue.enqueue("two", "b", write)).toThrow("closing");
    expect(queue.pause("one", owner, true)).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(closing).resolves.toBe(true);
    await expect(result).resolves.toEqual({ message: "account-a" });
  });
  it("reports write errors, does not retry, and prevents automatic close on failure", async () => {
    const queue = new DeferredTrash();
    const write = vi.fn(async () => { throw new Error("offline"); });
    const result = queue.enqueue("one", "a", write);
    const rejected = expect(result).rejects.toThrow("offline");
    const closing = queue.finishBeforeClose();
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    await expect(closing).resolves.toBe(false);
    expect(queue.size).toBe(0);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("rejects duplicate operation IDs", async () => {
    const queue = new DeferredTrash();
    const write = async () => ({ message: "Moved" });
    const result = queue.enqueue("one", "a", write);
    expect(() => queue.enqueue("one", "a", write)).toThrow();
    queue.cancel("one", "a"); await result;
  });
  it("resumes abandoned hover pauses when the renderer reloads or crashes", async () => {
    const queue = new DeferredTrash();
    const write = vi.fn(async () => ({ message: "Moved" }));
    const result = queue.enqueue("one", "a", write);
    queue.pause("one", "a", true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(write).not.toHaveBeenCalled();
    queue.resumeAll();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toEqual({ message: "Moved" });
    expect(write).toHaveBeenCalledOnce();
  });
});
