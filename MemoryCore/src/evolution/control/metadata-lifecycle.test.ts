import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetadataStorePool } from "../../metadata/store/factory.js";
import { SqliteMetadataStore } from "../../metadata/store/sqlite-adapter.js";

const tests: Array<{ root: string; pool: MetadataStorePool }> = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), "evolution-pool-"));
  const pool = new MetadataStorePool({ backend: "sqlite", sqliteBaseDir: root, storeCacheMaxInstances: 1 });
  tests.push({ root, pool }); return { root, pool };
}
afterEach(async () => { for (const { root, pool } of tests.splice(0)) { await pool.closeAll(); rmSync(root, { recursive: true, force: true }); } });

describe("evolution worker metadata lifecycle", () => {
  it("pins a dispatcher connection across LRU pressure and rejects purge while in use", async () => {
    const { pool } = setup();
    const lease = await pool.pinStore("a");
    const store = (lease.store as SqliteMetadataStore).getEvolutionStore();
    const transient = await pool.getStore("transient");
    expect(await transient.getUserById("not-found")).toBeNull();
    const other = await pool.pinStore("b");
    expect(store.profiles("team")).toEqual([]);
    await expect(pool.purgeInstance("a")).rejects.toThrow("METADATA_INSTANCE_IN_USE");
    other.release(); other.release();
    expect(await pool.getStore("a")).toBe(lease.store);
    lease.release(); lease.release();
  });
  it("deduplicates concurrent opens and refuses reopening after shutdown", async () => {
    const { pool } = setup();
    const leases = await Promise.all([pool.pinStore("a"), pool.pinStore("a")]);
    expect(leases[0].store).toBe(leases[1].store);
    leases.forEach(lease => lease.release());
    await pool.closeAll();
    await expect(pool.getStore("a")).rejects.toThrow("METADATA_POOL_CLOSING");
  });
  it("discovers only existing local DB directories for startup recovery", async () => {
    const { pool, root } = setup();
    expect(await pool.localInstanceIds()).toEqual([]);
    const lease = await pool.pinStore("hub-local");
    mkdirSync(join(root, "unrelated")); mkdirSync(join(root, "tdai_metadata_empty"));
    expect(await pool.localInstanceIds()).toEqual(["hub-local"]);
    symlinkSync(root, join(root, "tdai_metadata_link"));
    await expect(pool.localInstanceIds()).rejects.toThrow("METADATA_DISCOVERY_LINK_REJECTED");
    lease.release();
  });
});
