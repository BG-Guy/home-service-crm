import { describe, expect, it } from "vitest";
import { createConfirmStore } from "@/ui/components/confirm-store";

describe("confirm store (useConfirm, QA T2-01)", () => {
  it("publishes the request synchronously, before the caller awaits", () => {
    const store = createConfirmStore<{ title: string }>();
    let notified = 0;
    store.subscribe(() => notified++);
    void store.open({ title: "Issue invoice?" });
    // useSyncExternalStore re-renders from this notification, outside any
    // pending transition; it must not wait for a microtask.
    expect(notified).toBe(1);
    expect(store.get()?.title).toBe("Issue invoice?");
  });

  it("resolves with the user's answer and clears", async () => {
    const store = createConfirmStore<{ title: string }>();
    const yes = store.open({ title: "A" });
    store.finish(true);
    await expect(yes).resolves.toBe(true);
    expect(store.get()).toBeNull();

    const no = store.open({ title: "B" });
    store.finish(false);
    await expect(no).resolves.toBe(false);
  });

  it("keeps a stable snapshot between changes", () => {
    const store = createConfirmStore<{ title: string }>();
    void store.open({ title: "A" });
    expect(store.get()).toBe(store.get());
  });

  it("a newer confirm cancels the open one", async () => {
    const store = createConfirmStore<{ title: string }>();
    const first = store.open({ title: "first" });
    const second = store.open({ title: "second" });
    await expect(first).resolves.toBe(false);
    expect(store.get()?.title).toBe("second");
    store.finish(true);
    await expect(second).resolves.toBe(true);
  });

  it("finish with nothing open is a no-op; unsubscribe stops notifications", () => {
    const store = createConfirmStore<{ title: string }>();
    let notified = 0;
    const off = store.subscribe(() => notified++);
    store.finish(true);
    expect(notified).toBe(0);
    off();
    void store.open({ title: "A" });
    expect(notified).toBe(0);
  });
});
