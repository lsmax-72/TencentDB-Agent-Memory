import { describe, expect, it } from "vitest";
import { withLocalMutationBoundary, withLegacyMutation } from "../../core/local-mutation-boundary.js";
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
describe("local activation and native writes share a full mutation lease", () => {
  it("waits for an in-flight write, then blocks later legacy writes after activation", async () => {
    let enabled = false; const entered = deferred(), resume = deferred(), events: string[] = [];
    const guard = async () => { if (enabled) throw new Error("governed"); };
    const old = withLegacyMutation(guard, async () => { await guard(); entered.release(); await resume.promise; events.push("old write completed"); });
    await entered.promise;
    const activate = withLocalMutationBoundary(() => { enabled = true; events.push("activated"); });
    await Promise.resolve(); expect(enabled).toBe(false);
    resume.release(); await Promise.all([old, activate]);
    await expect(withLegacyMutation(guard, async () => { await guard(); events.push("forbidden"); })).rejects.toThrow("governed");
    expect(events).toEqual(["old write completed", "activated"]);
  });
  it("nested writers and detached native cleanup drain before releasing the parent", async () => {
    const nested = deferred(), cleanup = deferred(), events: string[] = [];
    const parent = withLocalMutationBoundary(async () => {
      await withLocalMutationBoundary(async () => { events.push("nested write"); });
      void withLocalMutationBoundary(async () => { nested.release(); await cleanup.promise; events.push("cleanup completed"); });
    });
    await nested.promise;
    const next = withLocalMutationBoundary(() => events.push("activated"));
    await Promise.resolve(); expect(events).toEqual(["nested write"]);
    cleanup.release(); await Promise.all([parent, next]);
    expect(events).toEqual(["nested write", "cleanup completed", "activated"]);
  });
  it("failure releases the lease and a detached callback after release reacquires it", async () => {
    await expect(withLocalMutationBoundary(async () => { throw new Error("write failed"); })).rejects.toThrow("write failed");
    const later = deferred(), entered = deferred(), unblock = deferred(), events: string[] = [];
    let detached!: Promise<void>;
    await withLocalMutationBoundary(async () => { detached = later.promise.then(() => withLocalMutationBoundary(() => { events.push("late callback"); })); });
    const current = withLocalMutationBoundary(async () => { entered.release(); await unblock.promise; events.push("current finished"); });
    await entered.promise; later.release(); await Promise.resolve(); await Promise.resolve(); expect(events).toEqual([]);
    unblock.release(); await Promise.all([current, detached]); expect(events).toEqual(["current finished", "late callback"]);
  });
});
