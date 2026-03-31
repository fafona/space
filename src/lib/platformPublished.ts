import { createClient } from "@supabase/supabase-js";
import type { Block, MerchantListPublishedSite } from "@/data/homeBlocks";
import { createDefaultMerchantSortConfig, type MerchantSortRule } from "@/data/platformControlStore";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";
import {
  PLATFORM_MERCHANT_SNAPSHOT_SLUG,
  readPlatformMerchantSnapshotFromBlocks,
} from "@/lib/platformMerchantSnapshot";

type QueryErrorLike = { message?: string } | null;
type QueryResult<T> = { data: T | null; error: QueryErrorLike };
type QueryBuilder<T> = PromiseLike<QueryResult<T[]>> & {
  select: (columns: string) => QueryBuilder<T>;
  is: (column: string, value: unknown) => QueryBuilder<T>;
  eq: (column: string, value: unknown) => QueryBuilder<T>;
  limit: (value: number) => QueryBuilder<T>;
  maybeSingle: () => Promise<QueryResult<T>>;
};
type LooseSupabaseClient = {
  from: <T = Record<string, unknown>>(table: string) => QueryBuilder<T>;
};

export type PublishedPlatformBlocksResult = {
  blocks: Block[] | null;
  error: string | null;
};

type PublishedMerchantSnapshotLoadResult = {
  snapshot: MerchantListPublishedSite[];
  defaultSortRule: MerchantSortRule;
  replaceExistingSnapshot: boolean;
};

type PublishedMerchantPageRow = {
  merchant_id?: string | null;
  slug?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type PublishedMerchantProfileRow = {
  id?: string | null;
  name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function readEnv(key: string) {
  return String(process.env[key] ?? "").trim();
}

function createServerSupabaseClient() {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey =
    readEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY") ||
    readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

function toErrorMessage(input: unknown) {
  if (!input || typeof input !== "object") return "";
  const message = (input as { message?: unknown }).message;
  return typeof message === "string" ? message.trim() : "";
}

function toTimestamp(value: string | null | undefined) {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isNumericMerchantId(value: string | null | undefined) {
  return /^\d{8}$/.test(String(value ?? "").trim());
}

function choosePreferredPublishedMerchantPageRow(
  current: PublishedMerchantPageRow | null,
  candidate: PublishedMerchantPageRow,
) {
  if (!current) return candidate;
  const currentUpdatedAt = Math.max(toTimestamp(current.updated_at), toTimestamp(current.created_at));
  const candidateUpdatedAt = Math.max(toTimestamp(candidate.updated_at), toTimestamp(candidate.created_at));
  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt ? candidate : current;
  }

  const currentSlug = String(current.slug ?? "").trim().toLowerCase();
  const candidateSlug = String(candidate.slug ?? "").trim().toLowerCase();
  const currentHasCustomSlug = currentSlug.length > 0 && currentSlug !== "home";
  const candidateHasCustomSlug = candidateSlug.length > 0 && candidateSlug !== "home";
  if (candidateHasCustomSlug !== currentHasCustomSlug) {
    return candidateHasCustomSlug ? candidate : current;
  }
  return current;
}

function normalizePublishedMerchantSlug(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.toLowerCase() === "home") return "";
  return normalized;
}

export function buildPublishedMerchantSnapshotFromRows(
  pageRows: PublishedMerchantPageRow[],
  merchantRows: PublishedMerchantProfileRow[],
): MerchantListPublishedSite[] {
  const pageByMerchantId = new Map<string, PublishedMerchantPageRow>();
  pageRows.forEach((row) => {
    const merchantId = String(row.merchant_id ?? "").trim();
    if (!isNumericMerchantId(merchantId)) return;
    pageByMerchantId.set(
      merchantId,
      choosePreferredPublishedMerchantPageRow(pageByMerchantId.get(merchantId) ?? null, row),
    );
  });

  const merchantById = new Map(
    merchantRows
      .map((row) => {
        const merchantId = String(row.id ?? "").trim();
        return isNumericMerchantId(merchantId) ? ([merchantId, row] as const) : null;
      })
      .filter((item): item is readonly [string, PublishedMerchantProfileRow] => item !== null),
  );

  return [...pageByMerchantId.entries()]
    .map(([merchantId, pageRow]) => {
      const merchant = merchantById.get(merchantId);
      const merchantName = String(merchant?.name ?? "").trim();
      const domainPrefix = normalizePublishedMerchantSlug(pageRow.slug);
      const createdAt =
        String(merchant?.created_at ?? "").trim() ||
        String(pageRow.updated_at ?? "").trim() ||
        String(pageRow.created_at ?? "").trim();
      return {
        id: merchantId,
        merchantName,
        domainPrefix,
        domainSuffix: "",
        name: merchantName || merchantId,
        domain: domainPrefix || merchantId,
        category: "",
        industry: "",
        location: {
          countryCode: "",
          country: "",
          provinceCode: "",
          province: "",
          city: "",
        },
        merchantCardImageUrl: "",
        merchantCardImageOpacity: 1,
        sortConfig: createDefaultMerchantSortConfig(),
        createdAt,
      } satisfies MerchantListPublishedSite;
    })
    .sort((left, right) => {
      const delta = toTimestamp(right.createdAt) - toTimestamp(left.createdAt);
      if (delta !== 0) return delta;
      return left.id.localeCompare(right.id, "zh-CN");
    });
}

function blocksNeedPublishedMerchantSnapshotInPlanConfig(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const plans = (input as { plans?: unknown }).plans;
  if (!Array.isArray(plans)) return false;
  return plans.some((plan) => {
    const planBlocks = Array.isArray((plan as { blocks?: unknown }).blocks) ? ((plan as { blocks?: Block[] }).blocks ?? []) : [];
    const pages = Array.isArray((plan as { pages?: unknown }).pages) ? ((plan as { pages?: Array<{ blocks?: Block[] }> }).pages ?? []) : [];
    return (
      blocksNeedPublishedMerchantSnapshot(planBlocks) ||
      pages.some((page) => blocksNeedPublishedMerchantSnapshot(Array.isArray(page.blocks) ? page.blocks : []))
    );
  });
}

function blocksContainMerchantListInPlanConfig(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const plans = (input as { plans?: unknown }).plans;
  if (!Array.isArray(plans)) return false;
  return plans.some((plan) => {
    const planBlocks = Array.isArray((plan as { blocks?: unknown }).blocks) ? ((plan as { blocks?: Block[] }).blocks ?? []) : [];
    const pages = Array.isArray((plan as { pages?: unknown }).pages) ? ((plan as { pages?: Array<{ blocks?: Block[] }> }).pages ?? []) : [];
    return (
      blocksContainMerchantList(planBlocks) ||
      pages.some((page) => blocksContainMerchantList(Array.isArray(page.blocks) ? page.blocks : []))
    );
  });
}

export function blocksNeedPublishedMerchantSnapshot(blocks: Block[]): boolean {
  return blocks.some((block) => {
    const props = (block.props ?? {}) as Record<string, unknown>;
    if (block.type === "merchant-list") {
      const snapshot = props.publishedMerchantSnapshot;
      if (!Array.isArray(snapshot) || snapshot.length === 0) return true;
    }
    if (blocksNeedPublishedMerchantSnapshotInPlanConfig(props.pagePlanConfig)) return true;
    if (blocksNeedPublishedMerchantSnapshotInPlanConfig(props.pagePlanConfigMobile)) return true;
    return false;
  });
}

function blocksContainMerchantList(blocks: Block[]): boolean {
  return blocks.some((block) => {
    const props = (block.props ?? {}) as Record<string, unknown>;
    if (block.type === "merchant-list") return true;
    if (blocksContainMerchantListInPlanConfig(props.pagePlanConfig)) return true;
    if (blocksContainMerchantListInPlanConfig(props.pagePlanConfigMobile)) return true;
    return false;
  });
}

function injectPublishedMerchantSnapshotIntoPlanConfig(
  input: unknown,
  snapshot: MerchantListPublishedSite[],
  defaultSortRule: MerchantSortRule,
  options?: { forceReplace?: boolean },
) {
  if (!input || typeof input !== "object") return input;
  const plans = (input as { plans?: unknown }).plans;
  if (!Array.isArray(plans)) return input;
  return {
    ...(input as Record<string, unknown>),
    plans: plans.map((plan) => ({
      ...(plan as Record<string, unknown>),
      blocks: Array.isArray((plan as { blocks?: unknown }).blocks)
        ? injectPublishedMerchantSnapshotIntoBlocks(
            ((plan as { blocks?: Block[] }).blocks ?? []),
            snapshot,
            defaultSortRule,
            options,
          )
        : (plan as { blocks?: unknown }).blocks,
      pages: Array.isArray((plan as { pages?: unknown }).pages)
        ? ((plan as { pages?: Array<{ blocks?: Block[] }> }).pages ?? []).map((page) => ({
            ...page,
            blocks: Array.isArray(page.blocks)
              ? injectPublishedMerchantSnapshotIntoBlocks(page.blocks, snapshot, defaultSortRule, options)
              : page.blocks,
          }))
        : (plan as { pages?: unknown }).pages,
    })),
  };
}

export function injectPublishedMerchantSnapshotIntoBlocks(
  blocks: Block[],
  snapshot: MerchantListPublishedSite[],
  defaultSortRule: MerchantSortRule = "created_desc",
  options?: { forceReplace?: boolean },
): Block[] {
  return blocks.map((block) => {
    const nextProps = { ...(block.props ?? {}) } as Record<string, unknown>;
    let changed = false;
    if (block.type === "merchant-list") {
      const existingSnapshot = nextProps.publishedMerchantSnapshot;
      if (options?.forceReplace || !Array.isArray(existingSnapshot) || existingSnapshot.length === 0) {
        nextProps.publishedMerchantSnapshot = snapshot;
        if (
          options?.forceReplace ||
          typeof nextProps.publishedMerchantDefaultSortRule !== "string" ||
          !String(nextProps.publishedMerchantDefaultSortRule).trim()
        ) {
          nextProps.publishedMerchantDefaultSortRule = defaultSortRule;
        }
        changed = true;
      }
    }
    if ("pagePlanConfig" in nextProps) {
      const patched = injectPublishedMerchantSnapshotIntoPlanConfig(
        nextProps.pagePlanConfig,
        snapshot,
        defaultSortRule,
        options,
      );
      if (patched !== nextProps.pagePlanConfig) {
        nextProps.pagePlanConfig = patched;
        changed = true;
      }
    }
    if ("pagePlanConfigMobile" in nextProps) {
      const patched = injectPublishedMerchantSnapshotIntoPlanConfig(
        nextProps.pagePlanConfigMobile,
        snapshot,
        defaultSortRule,
        options,
      );
      if (patched !== nextProps.pagePlanConfigMobile) {
        nextProps.pagePlanConfigMobile = patched;
        changed = true;
      }
    }
    return changed
      ? ({
          ...block,
          props: nextProps as never,
        } as Block)
      : block;
  });
}

async function loadStoredPlatformMerchantSnapshot(
  supabase: LooseSupabaseClient,
): Promise<PublishedMerchantSnapshotLoadResult | null> {
  const initialQuery = await supabase
    .from("pages")
    .select("blocks")
    .is("merchant_id", null)
    .eq("slug", PLATFORM_MERCHANT_SNAPSHOT_SLUG)
    .limit(1)
    .maybeSingle();

  let data = initialQuery.data as { blocks?: unknown } | null;
  let error = initialQuery.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingPlatformMerchantIdColumn(message)) {
      const bySlug = await supabase
        .from("pages")
        .select("blocks")
        .eq("slug", PLATFORM_MERCHANT_SNAPSHOT_SLUG)
        .limit(1)
        .maybeSingle();
      data = bySlug.data as { blocks?: unknown } | null;
      error = bySlug.error;
    } else if (isMissingPlatformSlugColumn(message)) {
      return null;
    } else {
      return null;
    }
  }

  if (error) return null;
  const payload = readPlatformMerchantSnapshotFromBlocks(data?.blocks);
  if (!payload || payload.snapshot.length === 0) return null;
  return {
    snapshot: payload.snapshot,
    defaultSortRule: payload.defaultSortRule,
    replaceExistingSnapshot: true,
  };
}

async function loadPublishedMerchantSnapshot(
  supabase: LooseSupabaseClient,
): Promise<PublishedMerchantSnapshotLoadResult> {
  const stored = await loadStoredPlatformMerchantSnapshot(supabase);
  if (stored) return stored;

  const [pageRowsResult, merchantRowsResult] = await Promise.all([
    (await supabase
      .from<PublishedMerchantPageRow>("pages")
      .select("merchant_id,slug,updated_at,created_at")
      .limit(2000)) as QueryResult<PublishedMerchantPageRow[]>,
    (await supabase
      .from<PublishedMerchantProfileRow>("merchants")
      .select("id,name,created_at,updated_at")
      .limit(2000)) as QueryResult<PublishedMerchantProfileRow[]>,
  ]);

  if (pageRowsResult.error || merchantRowsResult.error) {
    return {
      snapshot: [],
      defaultSortRule: "created_desc",
      replaceExistingSnapshot: false,
    };
  }

  return {
    snapshot: buildPublishedMerchantSnapshotFromRows(pageRowsResult.data ?? [], merchantRowsResult.data ?? []),
    defaultSortRule: "created_desc",
    replaceExistingSnapshot: false,
  };
}

async function hydratePublishedMerchantSnapshotIfNeeded(
  supabase: LooseSupabaseClient,
  blocks: Block[],
): Promise<Block[]> {
  if (!blocksContainMerchantList(blocks)) return blocks;
  const snapshotResult = await loadPublishedMerchantSnapshot(supabase);
  if (snapshotResult.snapshot.length === 0) return blocks;
  if (snapshotResult.replaceExistingSnapshot) {
    return injectPublishedMerchantSnapshotIntoBlocks(
      blocks,
      snapshotResult.snapshot,
      snapshotResult.defaultSortRule,
      { forceReplace: true },
    );
  }
  if (!blocksNeedPublishedMerchantSnapshot(blocks)) return blocks;
  return injectPublishedMerchantSnapshotIntoBlocks(
    blocks,
    snapshotResult.snapshot,
    snapshotResult.defaultSortRule,
  );
}

export function isMissingPlatformSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

export function isMissingPlatformMerchantIdColumn(message: string) {
  return (
    /column\s+pages\.merchant_id\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]merchant_id['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

export async function loadPublishedPlatformHomeBlocks(): Promise<PublishedPlatformBlocksResult> {
  const supabase = createServerSupabaseClient() as unknown as LooseSupabaseClient | null;
  if (!supabase) {
    return { blocks: null, error: "platform_published_env_missing" };
  }

  const pages = supabase.from("pages");
  const scoped = await pages
    .select("blocks")
    .is("merchant_id", null)
    .eq("slug", "home")
    .limit(1)
    .maybeSingle();

  if (!scoped.error && Array.isArray(scoped.data?.blocks)) {
    const blocks = sanitizeBlocksForRuntime(scoped.data.blocks as Block[]).blocks;
    return {
      blocks: await hydratePublishedMerchantSnapshotIfNeeded(supabase, blocks),
      error: null,
    };
  }

  const scopedMessage = toErrorMessage(scoped.error);
  const canTryBySlug = isMissingPlatformMerchantIdColumn(scopedMessage);
  const canTryByMerchantOnly = isMissingPlatformSlugColumn(scopedMessage);

  if (canTryBySlug) {
    const bySlug = await supabase
      .from("pages")
      .select("blocks")
      .eq("slug", "home")
      .limit(1)
      .maybeSingle();
    if (!bySlug.error && Array.isArray(bySlug.data?.blocks)) {
      const blocks = sanitizeBlocksForRuntime(bySlug.data.blocks as Block[]).blocks;
      return {
        blocks: await hydratePublishedMerchantSnapshotIfNeeded(supabase, blocks),
        error: null,
      };
    }
  }

  if (canTryByMerchantOnly) {
    const byMerchantOnly = await supabase
      .from("pages")
      .select("blocks")
      .is("merchant_id", null)
      .limit(1)
      .maybeSingle();
    if (!byMerchantOnly.error && Array.isArray(byMerchantOnly.data?.blocks)) {
      const blocks = sanitizeBlocksForRuntime(byMerchantOnly.data.blocks as Block[]).blocks;
      return {
        blocks: await hydratePublishedMerchantSnapshotIfNeeded(supabase, blocks),
        error: null,
      };
    }
  }

  return { blocks: null, error: scopedMessage || "platform_published_not_found" };
}
