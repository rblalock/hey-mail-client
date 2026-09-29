import { describe, expect, it, vi } from "vitest";
import { MailPrefetchQueue } from "./mail-prefetch-queue";

function harness() {
  const requests = new Map<string, { resolve: () => void; reject: () => void }>();
  const load = vi.fn((topicId: string) => new Promise<void>((resolve, reject) => {
    requests.set(topicId, { resolve, reject: () => reject(new Error("Unavailable")) });
  }));
  const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
  return { queue: new MailPrefetchQueue(load), load, requests, flush };
}

describe("bounded mail prefetch queue", () => {
  it("starts the target before at most two neighbors, with one background read in flight", async () => {
    const { queue, load, requests, flush } = harness();
    queue.enqueue("21", ["22", "23", "24"]);
    await flush();
    expect(load.mock.calls).toEqual([["21"]]);
    requests.get("21")!.resolve();
    await flush();
    expect(load.mock.calls).toEqual([["21"], ["22"]]);
    requests.get("22")!.resolve();
    await flush();
    expect(load.mock.calls).toEqual([["21"], ["22"], ["23"]]);
    requests.get("23")!.resolve();
    await flush();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("retains the latest highlighted target while busy and replaces stale queued targets", async () => {
    const { queue, load, requests, flush } = harness();
    queue.enqueue("21", ["22", "23"]);
    await flush();
    queue.enqueue("24", ["25", "26"]);
    queue.enqueue("27", ["28", "29"]);
    expect(load).toHaveBeenCalledOnce();
    requests.get("21")!.resolve();
    await flush();
    expect(load.mock.calls).toEqual([["21"], ["27"]]);
    queue.clearPending();
    requests.get("27")!.resolve();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("deduplicates running and queued IDs", async () => {
    const { queue, load, requests, flush } = harness();
    queue.enqueue("21", ["21", "22"]);
    await flush();
    queue.enqueue("21", ["22", "22"]);
    requests.get("21")!.resolve();
    await flush();
    expect(load.mock.calls).toEqual([["21"], ["22"]]);
    requests.get("22")!.resolve();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("lets foreground work clear pending reads without cancelling a running request", async () => {
    const { queue, load, requests, flush } = harness();
    queue.enqueue("21", ["22", "23"]);
    await flush();
    queue.clearPending();
    requests.get("21")!.resolve();
    await flush();
    expect(load.mock.calls).toEqual([["21"]]);
    queue.enqueue("24");
    await flush();
    expect(load.mock.calls).toEqual([["21"], ["24"]]);
    requests.get("24")!.resolve();
    await flush();
  });

  it("continues with the newest target after a failed read without leaking the rejection", async () => {
    const { queue, load, requests, flush } = harness();
    queue.enqueue("21");
    await flush();
    queue.enqueue("22");
    requests.get("21")!.reject();
    await flush();
    expect(load.mock.calls).toEqual([["21"], ["22"]]);
    requests.get("22")!.resolve();
    await flush();
  });
});
