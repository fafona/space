import type { MerchantMembershipsStoreClient } from "@/lib/merchantMembershipsStore";

export const MEMBERSHIP_PROFILE_PROJECTION_RPC = "faolla_customer_membership_profiles_v1";
export const MEMBERSHIP_PROFILE_PROJECTION_TIMEOUT_MS = 1500;

type ProfileProjectionRow = {
  id: string | number;
  slug: string;
  blocks: unknown[];
  updated_at: string | null;
};

/** Opt in only after installing the additive RPC; never probe an old DB by default. */
export function isMembershipProfileProjectionEnabled(
  siteId: string,
  env: Record<string, string | undefined> = process.env,
) {
  if (!/^[0-9]{8}$/.test(siteId) || env.MERCHANT_CUSTOMER_MEMBERSHIP_PROJECTION_ENABLED !== "1") return false;
  const sites = (env.MERCHANT_CUSTOMER_MEMBERSHIP_PROJECTION_SITE_IDS ?? "").split(",").map((value) => value.trim());
  return sites.every((value) => /^[0-9]{8}$/.test(value)) && sites.includes(siteId);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** null always means use the existing reader, never an empty customer result. */
export function decodeMembershipProfileProjection(value: unknown, siteId: string): ProfileProjectionRow[] | null {
  if (!isObject(value) || value.version !== 1 || value.status !== "projected" || value.siteId !== siteId ||
    !Array.isArray(value.rows) || value.rows.length !== 1) return null;
  const row: unknown = value.rows[0];
  if (!isObject(row) || row.slug !== "__merchant_memberships__:" + siteId ||
    !(typeof row.id === "string" && row.id.length > 0 || typeof row.id === "number" && Number.isFinite(row.id)) ||
    !(row.updated_at === null || typeof row.updated_at === "string") || !Array.isArray(row.blocks)) return null;
  // Do not accept partially projected histories under the v1 success contract.
  // All original array elements are retained; invalid membership shapes still
  // go through the same original normalizer instead of being silently removed.
  if (row.blocks.some((membership) => isObject(membership) &&
    (!Array.isArray(membership.transactions) || membership.transactions.length !== 0))) return null;
  return [{ id: row.id, slug: row.slug, blocks: row.blocks, updated_at: row.updated_at }];
}

/** A bounded, optional read. Fallback uses the same authorized client, no writes. */
export async function tryLoadMembershipProfileProjection(
  supabase: MerchantMembershipsStoreClient,
  siteId: string,
): Promise<ProfileProjectionRow[] | null> {
  if (!isMembershipProfileProjectionEnabled(siteId) || typeof supabase.rpc !== "function") return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => { resolve(null); controller.abort(); }, MEMBERSHIP_PROFILE_PROJECTION_TIMEOUT_MS);
    });
    let query = supabase.rpc(MEMBERSHIP_PROFILE_PROJECTION_RPC, { p_site_id: siteId });
    const abortable = query as typeof query & { abortSignal?: (signal: AbortSignal) => typeof query };
    if (typeof abortable.abortSignal === "function") query = abortable.abortSignal(controller.signal);
    const result = await Promise.race([Promise.resolve(query), timeout]);
    if (!result || result.error) return null;
    return decodeMembershipProfileProjection(result.data, siteId);
  } catch {
    // Missing RPC/old schema, permission/transport failures or a malformed
    // response cannot manufacture an empty success. The original authorized
    // reader remains the authority for both data and its existing error result.
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
