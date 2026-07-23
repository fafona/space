import {
  createEmptyMerchantManagerPreferencesSnapshot,
  updateMerchantManagerPreferencesSnapshot,
  type MerchantManagerPreferenceKind,
  type MerchantManagerPreferencesSnapshot,
} from "@/lib/merchantManagerPreferences";
import {
  loadStoredMerchantManagerPreferences,
  saveStoredMerchantManagerPreferences,
} from "@/lib/merchantManagerPreferencesStore";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

const mutationQueues = new Map<string, Promise<void>>();

function normalizeText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function requireStoreClient() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) throw new Error("manager_preferences_store_unavailable");
  return supabase;
}

async function waitForQueuedMutations(siteId: string) {
  await mutationQueues.get(siteId)?.catch(() => undefined);
}

function queueSiteMutation<T>(siteId: string, task: () => Promise<T>) {
  const previous = mutationQueues.get(siteId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(task);
  const marker = result.then(
    () => undefined,
    () => undefined,
  );
  mutationQueues.set(siteId, marker);
  return result.finally(() => {
    if (mutationQueues.get(siteId) === marker) mutationQueues.delete(siteId);
  });
}

export async function getMerchantManagerPreferences(
  siteId: string,
): Promise<MerchantManagerPreferencesSnapshot> {
  const normalizedSiteId = normalizeText(siteId, 64);
  if (!normalizedSiteId) throw new Error("invalid_site_id");
  await waitForQueuedMutations(normalizedSiteId);
  const stored = await loadStoredMerchantManagerPreferences(requireStoreClient(), normalizedSiteId);
  return stored ?? createEmptyMerchantManagerPreferencesSnapshot(normalizedSiteId);
}

export function updateMerchantManagerPreferences(input: {
  siteId: string;
  kind: MerchantManagerPreferenceKind;
  preferences: unknown;
}): Promise<MerchantManagerPreferencesSnapshot> {
  const siteId = normalizeText(input.siteId, 64);
  if (!siteId) return Promise.reject(new Error("invalid_site_id"));
  return queueSiteMutation(siteId, async () => {
    const supabase = requireStoreClient();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await loadStoredMerchantManagerPreferences(supabase, siteId);
      const next = updateMerchantManagerPreferencesSnapshot(current, {
        siteId,
        kind: input.kind,
        preferences: input.preferences,
        updatedAt: new Date().toISOString(),
      });
      const saved = await saveStoredMerchantManagerPreferences(supabase, {
        siteId,
        snapshot: next,
        expectedUpdatedAt: current?.updatedAt ?? null,
        source: `${input.kind}-manager-preferences`,
      });
      if (!saved.error) return next;
      if (saved.error !== "merchant_manager_preferences_conflict" || attempt >= 2) {
        throw new Error(saved.error);
      }
    }
    throw new Error("merchant_manager_preferences_conflict");
  });
}
