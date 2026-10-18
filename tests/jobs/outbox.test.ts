// Client outbox (BUILD_PLAN §6.11; B2 tests): offline actions persist and replay
// once, a replay with the same clientId returns the stored result (server-side
// receipts are simulated here), failures back off, final { ok:false } is dropped.
// Node has no IndexedDB, so the outbox uses its in-memory store.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerOfflineActions } from "@/client/offline-registry";
import { backoffMs, flush, getOutboxState, queueAction } from "@/client/outbox";

// A fake server action with action()-style idempotency on clientId.
const receipts = new Map<string, { ok: true; data: { n: number } }>();
let runs = 0;
let failNext = 0;
registerOfflineActions({
  "test.setStatus": async (input: { clientId: string }) => {
    if (failNext > 0) {
      failNext--;
      throw new Error("network down");
    }
    const stored = receipts.get(input.clientId);
    if (stored) return stored;
    runs++;
    const res = { ok: true as const, data: { n: runs } };
    receipts.set(input.clientId, res);
    return res;
  },
  "test.reject": async () => ({ ok: false as const, error: "Not allowed" }),
});

const online = (v: boolean) => vi.stubGlobal("navigator", { onLine: v });
const input = (clientId: string) => ({
  clientId,
  clientTs: new Date().toISOString(),
  jobId: "j1",
});

beforeEach(() => {
  runs = 0;
  failNext = 0;
  receipts.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client outbox", () => {
  it("runs immediately when online", async () => {
    online(true);
    const r = await queueAction("test.setStatus", input(crypto.randomUUID()));
    expect(r.queued).toBe(false);
    expect(r.result).toEqual({ ok: true, data: { n: 1 } });
  });

  it("queues offline, replays once when back online", async () => {
    online(false);
    const id = crypto.randomUUID();
    const r = await queueAction("test.setStatus", input(id));
    expect(r).toEqual({ queued: true });
    // Same clientId queued twice (double tap) is stored once.
    await queueAction("test.setStatus", input(id));
    expect(getOutboxState().pending).toBe(1);
    expect(runs).toBe(0);
    online(true);
    await flush();
    expect(runs).toBe(1);
    expect(getOutboxState().pending).toBe(0);
  });

  it("a replay with the same clientId returns the stored result", async () => {
    online(true);
    const id = crypto.randomUUID();
    const first = await queueAction("test.setStatus", input(id));
    const again = await queueAction("test.setStatus", input(id));
    expect(again.result).toEqual(first.result);
    expect(runs).toBe(1);
  });

  it("keeps FIFO order and backs off on network failure", async () => {
    online(false);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await queueAction("test.setStatus", input(a));
    await queueAction("test.setStatus", input(b));
    online(true);
    failNext = 1;
    await flush();
    // First failed → nothing after it ran (strict order), both still pending.
    expect(runs).toBe(0);
    expect(getOutboxState().pending).toBe(2);
    expect(getOutboxState().lastError).toBe("network down");
  });

  it("drops final { ok:false } results and reports the error", async () => {
    online(true);
    const r = await queueAction("test.reject", input(crypto.randomUUID()));
    expect(r.queued).toBe(false);
    expect(r.result).toEqual({ ok: false, error: "Not allowed" });
  });

  it("backoff grows and caps at 10 minutes", () => {
    expect(backoffMs(1)).toBeGreaterThanOrEqual(1600);
    expect(backoffMs(1)).toBeLessThanOrEqual(2400);
    expect(backoffMs(30)).toBeLessThanOrEqual(720_000);
    expect(backoffMs(30)).toBeGreaterThanOrEqual(480_000);
  });
});
