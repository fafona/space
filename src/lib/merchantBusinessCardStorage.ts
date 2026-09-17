type PublicStorageRead = { exists: boolean; payload: unknown };

// Coalesce only overlapping public reads. Do not cache a missing manifest or
// revocation: a subsequent request must see newly published/revoked cards.
export function createBusinessCardStorageReader({
  fetchImpl = (...args: Parameters<typeof fetch>) => fetch(...args),
  timeoutMs = 3500,
  capacity = 256,
}: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  capacity?: number;
} = {}) {
  const pending = new Map<string, Promise<PublicStorageRead>>();
  async function read(url: string, existenceOnly: boolean): Promise<PublicStorageRead> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("business_card_storage_timeout"));
      }, timeoutMs);
    });
    const request = async (): Promise<PublicStorageRead> => {
      const requestUrl = new URL(url);
      requestUrl.searchParams.set("_ts", String(Date.now()));
      const response = await fetchImpl(requestUrl.toString(), {
        cache: "no-store",
        next: { revalidate: 0 },
        signal: controller.signal,
      });
      if (!response.ok || existenceOnly) {
        // Revocation is established by existence, even with a malformed or
        // stalled body. Do not accidentally turn a revoked card into a miss.
        void response.body?.cancel().catch(() => {});
        return { exists: response.ok, payload: null };
      }
      // The same deadline includes the body, not just response headers.
      return { exists: true, payload: await response.json().catch(() => null) };
    };
    try {
      return await Promise.race([request(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
  return (url: string, existenceOnly = false): Promise<PublicStorageRead> => {
    const key = `${existenceOnly ? "exists" : "payload"}:${url}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const result = read(url, existenceOnly);
    // Bound retained keys under arbitrary public traffic. Saturation does not
    // evict another caller or turn an unchecked revocation into a cached miss.
    if (pending.size < capacity) {
      pending.set(key, result);
      const release = () => {
        if (pending.get(key) === result) pending.delete(key);
      };
      void result.then(release, release);
    }
    return result;
  };
}

export const readBusinessCardStorageObject = createBusinessCardStorageReader();
