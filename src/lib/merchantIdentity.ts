import { supabase } from "@/lib/supabase";

const MERCHANT_ID_MIN = 10_000_000;
const MERCHANT_ID_MAX = 99_999_999;
const MERCHANT_ID_REGEX = /^\d{8}$/;

type SessionLikeUser = {
  id?: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

function dedupeIds(ids: string[]) {
  const next: string[] = [];
  ids.forEach((item) => {
    const trimmed = String(item ?? "").trim();
    if (!trimmed) return;
    if (!next.includes(trimmed)) next.push(trimmed);
  });
  return next;
}

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function getMetadataMerchantIds(user?: SessionLikeUser) {
  const ids: string[] = [];
  const metadata = {
    ...(user?.user_metadata ?? {}),
    ...(user?.app_metadata ?? {}),
  } as Record<string, unknown>;
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!ids.includes(trimmed)) ids.push(trimmed);
  };
  push(metadata.merchant_id);
  push(metadata.merchantId);
  push(metadata.merchantID);
  push(metadata.site_id);
  push(metadata.siteId);
  push(metadata.shop_id);
  push(metadata.shopId);
  return ids;
}

function isDuplicateKeyError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  if (typeof record.code === "string" && record.code === "23505") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return /duplicate key|already exists|unique constraint/i.test(message);
}

function compareMerchantNumericId(a: string, b: string) {
  return Number(a) - Number(b);
}

export function isMerchantNumericId(value: string | null | undefined) {
  return MERCHANT_ID_REGEX.test(String(value ?? "").trim());
}

export function normalizeDomainPrefix(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

export function normalizeDomainSuffix(value: string | null | undefined) {
  return normalizeDomainPrefix(value);
}

export async function lookupMerchantIdsForUser(user?: SessionLikeUser): Promise<string[]> {
  const userId = String(user?.id ?? "").trim();
  const email = normalizeEmail(user?.email);
  const metadataIds = getMetadataMerchantIds(user);

  if (!userId && !email) {
    return metadataIds;
  }

  const lookupTasks: Array<PromiseLike<{ data: { id?: string } | null; error: { message?: string } | null }>> = [];
  if (userId) {
    const lookupColumns = [
      "id",
      "user_id",
      "auth_user_id",
      "owner_user_id",
      "owner_id",
      "auth_id",
      "created_by",
      "created_by_user_id",
    ];
    lookupColumns.forEach((column) => {
      lookupTasks.push(supabase.from("merchants").select("id").eq(column, userId).limit(1).maybeSingle());
    });
  }
  if (email) {
    const emailColumns = ["email", "owner_email", "contact_email", "user_email"];
    emailColumns.forEach((column) => {
      lookupTasks.push(supabase.from("merchants").select("id").eq(column, email).limit(1).maybeSingle());
    });
  }

  const settled = await Promise.allSettled(lookupTasks);
  const foundIds: string[] = [...metadataIds];
  settled.forEach((result) => {
    if (result.status !== "fulfilled") return;
    if (result.value.error) return;
    const id = String(result.value.data?.id ?? "").trim();
    if (!id) return;
    if (!foundIds.includes(id)) foundIds.push(id);
  });
  return dedupeIds(foundIds);
}

async function tryAllocateSequentialMerchantId(user: SessionLikeUser): Promise<string | null> {
  const userId = String(user.id ?? "").trim();
  if (!userId) return null;
  const email = normalizeEmail(user.email);

  let candidate = MERCHANT_ID_MIN;
  while (candidate <= MERCHANT_ID_MAX) {
    const candidateId = String(candidate);
    const { error } = await supabase.from("merchants").insert({
      id: candidateId,
      name: email ? email.split("@")[0] : "",
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
    if (!isDuplicateKeyError(error)) return null;
    candidate += 1;
  }
  return null;
}

export async function ensureMerchantIdentityForUser(user?: SessionLikeUser): Promise<{
  merchantId: string | null;
  merchantIds: string[];
}> {
  if (!user?.id) {
    return { merchantId: null, merchantIds: [] };
  }

  const existing = await lookupMerchantIdsForUser(user);
  const numericIds = existing.filter(isMerchantNumericId).sort(compareMerchantNumericId);
  if (numericIds.length > 0) {
    const merchantId = numericIds[0];
    return {
      merchantId,
      merchantIds: dedupeIds([merchantId, ...existing]),
    };
  }

  const allocatedId = await tryAllocateSequentialMerchantId(user);
  if (allocatedId) {
    return {
      merchantId: allocatedId,
      merchantIds: dedupeIds([allocatedId, ...existing]),
    };
  }

  return {
    merchantId: existing[0] ?? null,
    merchantIds: existing,
  };
}
