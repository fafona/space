import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { MerchantContactVisibility, MerchantIndustry, SiteLocation } from "@/data/platformControlStore";
import { readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import { normalizeMerchantProfileBindingPayload } from "@/lib/merchantProfileBinding";
import {
  buildPlatformMerchantSnapshotSite,
  upsertPlatformMerchantSnapshotSite,
} from "@/lib/platformMerchantSnapshot";
import {
  loadStoredPlatformMerchantSnapshot,
  savePlatformMerchantSnapshot,
  type PlatformMerchantSnapshotStoreClient,
} from "@/lib/platformMerchantSnapshotStore";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LoosePostgrestError = { message?: string } | null;
type LoosePostgrestResponse = {
  data?: unknown;
  error: LoosePostgrestError;
};
type LooseQueryBuilder = PromiseLike<LoosePostgrestResponse> & {
  select: (columns: string) => LooseQueryBuilder;
  update: (payload: never) => LooseQueryBuilder;
  eq: (column: string, value: unknown) => LooseQueryBuilder;
  limit: (value: number) => LooseQueryBuilder;
  maybeSingle: () => Promise<LoosePostgrestResponse>;
};
type LooseSupabaseClient = {
  from: (table: string) => LooseQueryBuilder;
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: { id?: string; email?: string | null } | null };
      error: { message?: string } | null;
    }>;
  };
};

type MerchantRow = {
  id?: string | null;
};

type DomainBindingBody = {
  merchantId?: unknown;
  domainPrefix?: unknown;
  merchantName?: unknown;
  signature?: unknown;
  domain?: unknown;
  contactAddress?: unknown;
  contactName?: unknown;
  contactPhone?: unknown;
  contactEmail?: unknown;
  industry?: unknown;
  location?: unknown;
  chatAvatarImageUrl?: unknown;
  contactVisibility?: unknown;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLocation(value: unknown): SiteLocation {
  if (!value || typeof value !== "object") {
    return {
      countryCode: "",
      country: "",
      provinceCode: "",
      province: "",
      city: "",
    };
  }
  const input = value as Partial<SiteLocation>;
  return {
    countryCode: normalizeText(input.countryCode).toUpperCase(),
    country: normalizeText(input.country),
    provinceCode: normalizeText(input.provinceCode),
    province: normalizeText(input.province),
    city: normalizeText(input.city),
  };
}

function normalizeIndustry(value: unknown): MerchantIndustry {
  return normalizeText(value) as MerchantIndustry;
}

function normalizeContactVisibility(
  value: unknown,
  fallback?: {
    phoneHidden?: boolean;
    emailHidden?: boolean;
    businessCardHidden?: boolean;
  } | null,
) {
  return {
    phoneHidden: value && typeof value === "object"
      ? (value as { phoneHidden?: unknown }).phoneHidden === true
      : fallback?.phoneHidden === true,
    emailHidden: value && typeof value === "object"
      ? (value as { emailHidden?: unknown }).emailHidden === true
      : fallback?.emailHidden === true,
    businessCardHidden: value && typeof value === "object"
      ? (value as { businessCardHidden?: unknown }).businessCardHidden === true
      : fallback?.businessCardHidden === true,
  };
}

function isMissingSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingUpdatedAtColumn(message: string) {
  return (
    /column\s+pages\.updated_at\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]updated_at['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

async function getAuthorizedMerchantIds(
  supabase: LooseSupabaseClient,
  userId: string,
  email: string,
) {
  const lookups: LooseQueryBuilder[] = [];

  if (userId) {
    ["user_id", "auth_user_id", "owner_user_id", "owner_id", "auth_id", "created_by", "created_by_user_id"].forEach(
      (column) => {
        lookups.push(supabase.from("merchants").select("id").eq(column, userId).limit(20));
      },
    );
  }

  if (email) {
    ["email", "owner_email", "contact_email", "user_email"].forEach((column) => {
      lookups.push(supabase.from("merchants").select("id").eq(column, email).limit(20));
    });
  }

  const settled = await Promise.allSettled(lookups);
  const merchantIds: string[] = [];
  settled.forEach((result) => {
    if (result.status !== "fulfilled") return;
    if (result.value.error) return;
    ((result.value.data ?? []) as MerchantRow[]).forEach((row) => {
      const merchantId = String(row.id ?? "").trim();
      if (!merchantId || merchantIds.includes(merchantId)) return;
      merchantIds.push(merchantId);
    });
  });
  return merchantIds;
}

async function isAuthorizedForMerchant(
  request: Request,
  supabase: LooseSupabaseClient,
  merchantId: string,
) {
  if (isSuperAdminRequestAuthorized(request)) {
    return true;
  }

  const resolvedSession = await resolveMerchantSessionFromRequest(request);
  if (resolvedSession?.merchantId === merchantId) {
    return true;
  }

  const accessTokens = readMerchantRequestAccessTokens(request);
  for (const accessToken of accessTokens) {
    const authResult = await supabase.auth.getUser(accessToken);
    if (authResult.error || !authResult.data.user) continue;

    const authorizedMerchantIds = await getAuthorizedMerchantIds(
      supabase,
      String(authResult.data.user.id ?? "").trim(),
      normalizeEmail(authResult.data.user.email),
    );
    if (authorizedMerchantIds.includes(merchantId)) {
      return true;
    }
  }

  return false;
}

async function updateMerchantSlug(
  supabase: LooseSupabaseClient,
  merchantId: string,
  slug: string,
) {
  const { data: existing, error: existingError } = await supabase
    .from("pages")
    .select("id")
    .eq("merchant_id", merchantId)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return { ok: false, status: 409, message: existingError.message };
  }

  const existingRow = (existing ?? null) as { id?: string | number | null } | null;
  const rowId = String(existingRow?.id ?? "").trim();
  if (!rowId) {
    return { ok: true, updated: false };
  }

  const withUpdatedAt = await supabase
    .from("pages")
    .update({ slug, updated_at: new Date().toISOString() } as never)
    .eq("id", rowId);
  if (!withUpdatedAt.error) {
    return { ok: true, updated: true };
  }

  const withUpdatedAtMessage = String(withUpdatedAt.error?.message ?? "");
  if (isMissingUpdatedAtColumn(withUpdatedAtMessage)) {
    const withoutUpdatedAt = await supabase.from("pages").update({ slug } as never).eq("id", rowId);
    if (!withoutUpdatedAt.error) {
      return { ok: true, updated: true };
    }
    const withoutUpdatedAtMessage = String(withoutUpdatedAt.error?.message ?? "");
    if (isMissingSlugColumn(withoutUpdatedAtMessage)) {
      return { ok: false, status: 503, message: "pages.slug column missing" };
    }
    return { ok: false, status: 409, message: withoutUpdatedAtMessage };
  }

  if (isMissingSlugColumn(withUpdatedAtMessage)) {
    return { ok: false, status: 503, message: "pages.slug column missing" };
  }

  return { ok: false, status: 409, message: withUpdatedAtMessage };
}

async function updateMerchantName(
  supabase: LooseSupabaseClient,
  merchantId: string,
  merchantName: string,
) {
  if (!merchantName) {
    return { ok: true as const, updated: false };
  }

  const { data: existing, error: existingError } = await supabase
    .from("merchants")
    .select("id,name")
    .eq("id", merchantId)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return { ok: false as const, status: 409, message: existingError.message };
  }

  const existingRow = (existing ?? null) as { id?: string | number | null; name?: string | null } | null;
  const rowId = String(existingRow?.id ?? "").trim();
  if (!rowId) {
    return { ok: true as const, updated: false };
  }

  if (String(existingRow?.name ?? "").trim() === merchantName) {
    return { ok: true as const, updated: false };
  }

  const updated = await supabase.from("merchants").update({ name: merchantName } as never).eq("id", rowId);
  if (updated.error) {
    return { ok: false as const, status: 409, message: String(updated.error.message ?? "merchant_name_update_failed") };
  }

  return { ok: true as const, updated: true };
}

async function syncMerchantProfileSnapshot(
  supabase: PlatformMerchantSnapshotStoreClient,
  input: {
    merchantId: string;
    merchantName: string;
    domainPrefix: string;
    signature?: string;
    domain?: string;
    contactAddress?: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    industry?: MerchantIndustry;
    location?: SiteLocation;
    chatAvatarImageUrl?: string;
    contactVisibility?: MerchantContactVisibility;
  },
) {
  const existingPayload = await loadStoredPlatformMerchantSnapshot(supabase);
  const existingSite = existingPayload?.snapshot.find((site) => site.id === input.merchantId) ?? null;
  const snapshotSite = buildPlatformMerchantSnapshotSite({
    id: input.merchantId,
    merchantName: input.merchantName,
      domainPrefix: input.domainPrefix || existingSite?.domainPrefix || existingSite?.domainSuffix || "",
      domainSuffix: input.domainPrefix || existingSite?.domainSuffix || existingSite?.domainPrefix || "",
      name: input.merchantName || existingSite?.name || input.merchantId,
      signature: typeof input.signature === "string" ? input.signature : existingSite?.signature ?? "",
      domain: input.domain || existingSite?.domain,
    category: existingSite?.category ?? "",
    industry: input.industry || existingSite?.industry || "",
    location: input.location || existingSite?.location,
    contactAddress: input.contactAddress || existingSite?.contactAddress || "",
    contactName: input.contactName || existingSite?.contactName || "",
    contactPhone: input.contactPhone || existingSite?.contactPhone || "",
    contactEmail: input.contactEmail || existingSite?.contactEmail || "",
    merchantCardImageUrl: existingSite?.merchantCardImageUrl || "",
    chatAvatarImageUrl: input.chatAvatarImageUrl || existingSite?.chatAvatarImageUrl || "",
    contactVisibility: input.contactVisibility || existingSite?.contactVisibility,
    permissionConfig: existingSite?.permissionConfig ?? undefined,
    businessCards: existingSite?.businessCards ?? [],
    merchantCardImageOpacity: existingSite?.merchantCardImageOpacity ?? 1,
    chatBusinessCard: existingSite?.chatBusinessCard ?? null,
    status: existingSite?.status ?? "online",
    serviceExpiresAt: existingSite?.serviceExpiresAt ?? null,
    sortConfig: existingSite?.sortConfig ?? undefined,
    createdAt: existingSite?.createdAt ?? new Date().toISOString(),
  });
  if (!snapshotSite) {
    return { ok: false as const, message: "merchant_profile_snapshot_invalid" };
  }

  const nextPayload = {
    snapshot: upsertPlatformMerchantSnapshotSite(existingPayload?.snapshot ?? [], snapshotSite),
    defaultSortRule: existingPayload?.defaultSortRule ?? "created_desc",
  };
  const saveResult = await savePlatformMerchantSnapshot(supabase, nextPayload);
  if (saveResult.error) {
    return { ok: false as const, message: saveResult.error };
  }
  return { ok: true as const };
}

export async function POST(request: Request) {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "merchant_domain_binding_env_missing" }, { status: 503 });
  }

  let body: DomainBindingBody | null = null;
  try {
    body = (await request.json()) as DomainBindingBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const normalizedPayload = normalizeMerchantProfileBindingPayload(body);
  if (!normalizedPayload) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const { merchantId, domainPrefix, merchantName } = normalizedPayload;
  const normalizedProfile = {
    signature:
      body && Object.prototype.hasOwnProperty.call(body, "signature")
        ? normalizeText(body?.signature)
        : undefined,
    domain: normalizeText(body?.domain),
    contactAddress: normalizeText(body?.contactAddress),
    contactName: normalizeText(body?.contactName),
    contactPhone: normalizeText(body?.contactPhone),
    contactEmail: normalizeText(body?.contactEmail),
    industry: normalizeIndustry(body?.industry),
    location: normalizeLocation(body?.location),
    chatAvatarImageUrl:
      body && Object.prototype.hasOwnProperty.call(body, "chatAvatarImageUrl")
        ? normalizeText(body?.chatAvatarImageUrl)
        : undefined,
    contactVisibility:
      body && Object.prototype.hasOwnProperty.call(body, "contactVisibility")
        ? normalizeContactVisibility(body?.contactVisibility)
        : undefined,
  };

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }) as unknown as LooseSupabaseClient;

    const authorized = await isAuthorizedForMerchant(request, supabase, merchantId);
    if (!authorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const slugResult = await updateMerchantSlug(supabase, merchantId, domainPrefix);
    if (!slugResult.ok) {
      return NextResponse.json(
        {
          error: "merchant_domain_binding_failed",
          message: slugResult.message,
        },
        { status: slugResult.status },
      );
    }

    const merchantNameResult = await updateMerchantName(supabase, merchantId, merchantName);
    if (!merchantNameResult.ok) {
      return NextResponse.json(
        {
          error: "merchant_domain_binding_failed",
          message: merchantNameResult.message,
        },
        { status: merchantNameResult.status },
      );
    }

    const snapshotResult = await syncMerchantProfileSnapshot(supabase as unknown as PlatformMerchantSnapshotStoreClient, {
      merchantId,
      merchantName,
      domainPrefix,
      signature: normalizedProfile.signature,
      domain: normalizedProfile.domain,
      contactAddress: normalizedProfile.contactAddress,
      contactName: normalizedProfile.contactName,
      contactPhone: normalizedProfile.contactPhone,
      contactEmail: normalizedProfile.contactEmail,
      industry: normalizedProfile.industry,
      location: normalizedProfile.location,
      chatAvatarImageUrl: normalizedProfile.chatAvatarImageUrl,
      contactVisibility: normalizedProfile.contactVisibility,
    });
    if (!snapshotResult.ok) {
      return NextResponse.json(
        {
          error: "merchant_domain_binding_failed",
          message: snapshotResult.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      merchantId,
      slug: domainPrefix,
      merchantName,
      updated: slugResult.updated || merchantNameResult.updated,
      slugUpdated: slugResult.updated,
      merchantNameUpdated: merchantNameResult.updated,
      profileSnapshotUpdated: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "merchant_domain_binding_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
