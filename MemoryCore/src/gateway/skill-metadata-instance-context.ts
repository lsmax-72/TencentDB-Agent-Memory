import { AsyncLocalStorage } from "node:async_hooks";

const requestInstance = new AsyncLocalStorage<string>();

/** Keeps standalone SkillCore metadata hooks on the request's tenant instance. */
export function withSkillMetadataInstance<T>(instanceId: string, run: () => Promise<T>): Promise<T> {
  return requestInstance.run(instanceId, run);
}

export function currentSkillMetadataInstance(fallback: string): string {
  return requestInstance.getStore() ?? fallback;
}
