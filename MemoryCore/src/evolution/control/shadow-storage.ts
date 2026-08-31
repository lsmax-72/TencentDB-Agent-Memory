import type { IStorageBackend, StorageObject, ListObjectsOptions, ListResult } from "../../core/storage/types.js";
import { EvolutionError } from "./types.js";
import { contentHash } from "./store.js";

/** Immutable input snapshot + private writes for existing L2/L3 storage-aware runners. */
export class ShadowStorageBackend implements IStorageBackend {
  readonly type = "local" as const;
  private readonly initial: Map<string, Buffer>;
  private readonly files: Map<string, Buffer>;
  private frozen = false;
  constructor(snapshot: ReadonlyMap<string, Buffer>, private readonly writable: (key: string) => boolean) {
    this.initial = new Map([...snapshot].map(([key, value]) => [this.key(key), Buffer.from(value)]));
    this.files = new Map([...this.initial].map(([key, value]) => [key, Buffer.from(value)]));
  }
  private key(key: string): string {
    if (!key || key.startsWith("/") || key.includes("\\") || key.includes("\0") || key.split("/").some(part => part === ".." || part === ".")) throw new EvolutionError(400, "SHADOW_PATH_REJECTED");
    return key;
  }
  private writeKey(key: string): string {
    const valid = this.key(key);
    if (this.frozen || !this.writable(valid)) throw new EvolutionError(403, "SHADOW_WRITE_DENIED");
    return valid;
  }
  async getObject(key: string): Promise<StorageObject | null> {
    const value = this.files.get(this.key(key));
    return value ? { key, content: Buffer.from(value), size: value.length } : null;
  }
  async putObject(key: string, content: string | Buffer): Promise<void> {
    const valid = this.writeKey(key);
    if (Buffer.byteLength(content) > 512_000) throw new EvolutionError(413, "SHADOW_CONTENT_TOO_LARGE");
    this.files.set(valid, Buffer.from(content));
  }
  async appendObject(key: string, content: string | Buffer): Promise<void> {
    const valid = this.writeKey(key);
    await this.putObject(valid, Buffer.concat([this.files.get(valid) ?? Buffer.alloc(0), Buffer.from(content)]));
  }
  async exists(key: string): Promise<boolean> { return this.files.has(this.key(key)); }
  async deleteObject(_key: string): Promise<void> { throw new EvolutionError(403, "SHADOW_DELETE_DENIED"); }
  async deleteByPrefix(_key: string): Promise<number> { throw new EvolutionError(403, "SHADOW_DELETE_DENIED"); }
  async listObjects(prefix: string, options?: ListObjectsOptions): Promise<ListResult> {
    if (prefix) this.key(prefix);
    const keys = [...this.files.keys()].filter(key => key.startsWith(prefix) && (!options?.marker || key > options.marker)).sort();
    const selected = keys.slice(0, options?.maxKeys ?? 100);
    return { entries: selected.map(key => ({ key, size: this.files.get(key)!.length, lastModified: new Date(0), isDirectory: false })), nextMarker: keys.length > selected.length ? selected.at(-1) : undefined };
  }
  freeze() {
    this.frozen = true;
    return [...this.files].filter(([key, value]) => !this.initial.get(key)?.equals(value)).map(([key, value]) => ({ key, before: this.initial.get(key)?.toString("utf8") ?? "", after: value.toString("utf8"), base_hash: contentHash(this.initial.get(key)?.toString("utf8") ?? "") }));
  }
}
