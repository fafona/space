import { loadMerchantIdRulesFromStore } from "@/lib/merchantIdRuleStore";
import {
  findNextAllowedMerchantIdNumber,
  MERCHANT_ID_MAX,
  MERCHANT_ID_MIN,
  type MerchantIdRule,
} from "@/lib/merchantIdRules";

type AuthMetadata = Record<string, unknown> | null | undefined;

export type MerchantAuthUserSummary = {
  id?: string | null;
  email?: string | null;
  user_metadata?: AuthMetadata;
  app_metadata?: AuthMetadata;
};

type MerchantLookupResult = {
  data?: unknown;
  error?: { message?: string } | Error | null;
};

type MerchantTableQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      limit: (count: number) => PromiseLike<MerchantLookupResult>;
    };
  };
  insert: (values: Record<string, unknown>) => PromiseLike<{ error: Error | null }>;
};

export type MerchantIdentitySupabaseClient = {
  from: (table: string) => MerchantTableQuery;
};

type MerchantIdentityOptions = {
  preferredEmail?: string | null;
  preferredMerchantId?: string | null;
  preferredMerchantIds?: string[] | null;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeMerchantNumericId(value: unknown) {
  const normalized = trimText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

export function normalizeMerchantEmail(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized) return normalized;
  }
  return "";
}

function readMetadataString(metadata: AuthMetadata, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return "";
}

export function readMerchantIdFromMetadata(user: MerchantAuthUserSummary | null | undefined) {
  const candidate =
    readMetadataString(user?.user_metadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId") ||
    readMetadataString(user?.app_metadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId");
  return normalizeMerchantNumericId(candidate);
}

export function mergeMerchantIdentityCandidateIds(...sources: Array<unknown>) {
  const merchantIds: string[] = [];
  const push = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    const normalized = normalizeMerchantNumericId(value);
    if (!normalized || merchantIds.includes(normalized)) return;
    merchantIds.push(normalized);
  };
  sources.forEach(push);
  return merchantIds;
}

function isDuplicateKeyError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  if (typeof record.code === "string" && record.code === "23505") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return /duplicate key|already exists|unique constraint/i.test(message);
}

async function readBlockedMerchantIdRules(supabase: MerchantIdentitySupabaseClient | null): Promise<MerchantIdRule[]> {
  if (!supabase) return [];
  try {
    const { rules } = await loadMerchantIdRulesFromStore(supabase);
    return rules;
  } catch {
    return [];
  }
}

async function tryAllocateSequentialMerchantId(
  supabase: MerchantIdentitySupabaseClient | null,
  user: MerchantAuthUserSummary | null,
  preferredEmail?: string | null,
) {
  const userId = trimText(user?.id);
  if (!supabase || !userId) return "";
  const email = normalizeMerchantEmail(preferredEmail, user?.email);
  const blockedRules = await readBlockedMerchantIdRules(supabase);

  let candidate = MERCHANT_ID_MIN;
  while (candidate <= MERCHANT_ID_MAX) {
    const nextAllowed = findNextAllowedMerchantIdNumber(candidate, blockedRules);
    if (!nextAllowed) return "";
    candidate = nextAllowed;
    const candidateId = String(candidate);
    const { error } = await supabase.from("merchants").insert({
      id: candidateId,
      name: "",
      email: email || null,
      owner_email: email || null,
      contact_email: email || null,
      user_email: email || null,
      user_id: userId,
      auth_user_id: userId,
      owner_user_id: userId,
      owner_id: userId,
      auth_id: userId,
      created_by: userId,
      created_by_user_id: userId,
    });
    if (!error) return candidateId;
    if (!isDuplicateKeyError(error)) return "";
    candidate += 1;
  }

  return "";
}

export async function listMerchantIdsForUser(
  supabase: MerchantIdentitySupabaseClient | null,
  user: MerchantAuthUserSummary | null,
) {
  const merchantIds = mergeMerchantIdentityCandidateIds(readMerchantIdFromMetadata(user));
  if (!supabase || !user) return merchantIds;

  const userId = trimText(user.id);
  const email = normalizeMerchantEmail(user.email);
  const lookupTasks: Array<PromiseLike<{ data?: unknown; error?: { message?: string } | null }>> = [];

  if (userId) {
    [
      "user_id",
      "auth_user_id",
      "owner_user_id",
      "owner_id",
      "auth_id",
      "created_by",
      "created_by_user_id",
    ].forEach((column) => {
      lookupTasks.push(supabase.from("merchants").select("id").eq(column, userId).limit(20));
    });
  }

  if (email) {
    ["email", "owner_email", "contact_email", "user_email"].forEach((column) => {
      lookupTasks.push(supabase.from("merchants").select("id").eq(column, email).limit(20));
    });
  }

  const settled = await Promise.allSettled(lookupTasks);
  settled.forEach((result) => {
    if (result.status !== "fulfilled" || result.value.error) return;
    const rows = Array.isArray(result.value.data) ? result.value.data : [];
    rows.forEach((row) => {
      const record = row as { id?: unknown } | null;
      const normalized = normalizeMerchantNumericId(record?.id);
      if (!normalized || merchantIds.includes(normalized)) return;
      merchantIds.push(normalized);
    });
  });

  return merchantIds;
}

export async function resolveMerchantIdentityForUser(
  supabase: MerchantIdentitySupabaseClient | null,
  user: MerchantAuthUserSummary | null,
  options?: MerchantIdentityOptions,
) {
  const preferredIds = mergeMerchantIdentityCandidateIds(
    options?.preferredMerchantId,
    options?.preferredMerchantIds ?? [],
  );
  let merchantIds = mergeMerchantIdentityCandidateIds(preferredIds, await listMerchantIdsForUser(supabase, user));
  let merchantId = merchantIds[0] ?? "";

  if (!merchantId) {
    const allocatedId = await tryAllocateSequentialMerchantId(supabase, user, options?.preferredEmail);
    if (allocatedId) {
      merchantIds = mergeMerchantIdentityCandidateIds(allocatedId, merchantIds);
      merchantId = allocatedId;
    }
  }

  return {
    merchantId: merchantId || null,
    merchantIds,
  };
}
