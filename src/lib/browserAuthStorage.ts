function collectUsableBrowserStorages(candidates: Array<Storage | null | undefined>) {
  if (typeof window === "undefined") return [];
  const storages: Storage[] = [];
  for (const candidate of candidates) {
    if (!candidate || storages.includes(candidate)) continue;
    try {
      const probeKey = "__merchant_browser_auth_storage_probe__";
      candidate.setItem(probeKey, "1");
      candidate.removeItem(probeKey);
      storages.push(candidate);
    } catch {
      // Ignore unavailable browser storage backends.
    }
  }
  return storages;
}

function getBrowserAuthStorages() {
  if (typeof window === "undefined") return [];
  return collectUsableBrowserStorages([window.sessionStorage, window.localStorage]);
}

export function createMirroredBrowserAuthStorageAdapter() {
  return {
    getItem(key: string) {
      const storages = getBrowserAuthStorages();
      for (let index = 0; index < storages.length; index += 1) {
        const storage = storages[index];
        try {
          const raw = storage.getItem(key);
          if (raw === null) continue;
          if (index > 0) {
            for (let copyIndex = 0; copyIndex < index; copyIndex += 1) {
              try {
                if (storages[copyIndex].getItem(key) === null) {
                  storages[copyIndex].setItem(key, raw);
                }
              } catch {
                // Ignore best-effort mirroring failures.
              }
            }
          }
          return raw;
        } catch {
          // Ignore failed storage reads and keep trying fallbacks.
        }
      }
      return null;
    },
    setItem(key: string, value: string) {
      for (const storage of getBrowserAuthStorages()) {
        try {
          storage.setItem(key, value);
        } catch {
          // Ignore partial persistence failures.
        }
      }
    },
    removeItem(key: string) {
      for (const storage of getBrowserAuthStorages()) {
        try {
          storage.removeItem(key);
        } catch {
          // Ignore partial cleanup failures.
        }
      }
    },
  };
}
