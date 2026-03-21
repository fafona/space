import { normalizeMerchantIdRules, sortMerchantIdRules, type MerchantIdRule } from "@/lib/merchantIdRules";

export const MERCHANT_ID_RULES_PAGE_SLUG = "merchant-id-rules";

type QueryErrorLike = { message?: string } | null;

type MerchantIdRulesPageRow = {
  id?: string | null;
  blocks?: unknown;
};

type MerchantIdRulesPageSelectBuilder = {
  eq: (column: string, value: unknown) => MerchantIdRulesPageSelectBuilder;
  is: (column: string, value: null) => MerchantIdRulesPageSelectBuilder;
  limit: (value: number) => MerchantIdRulesPageSelectBuilder;
  maybeSingle: () => PromiseLike<{
    data: MerchantIdRulesPageRow | null;
    error: QueryErrorLike;
  }>;
};

type MerchantIdRulesPageMutationBuilder = {
  eq: (column: string, value: unknown) => PromiseLike<{
    error: QueryErrorLike;
  }>;
};

type MerchantIdRulesStoreClient = {
  from: (table: string) => {
    select: (columns: string) => MerchantIdRulesPageSelectBuilder;
    update: (values: { blocks: unknown }) => MerchantIdRulesPageMutationBuilder;
    insert: (values: { merchant_id: null; slug: string; blocks: unknown }) => PromiseLike<{
      error: QueryErrorLike;
    }>;
  };
};

type MerchantIdRulesPagePayload = {
  version: 1;
  rules: MerchantIdRule[];
};

function buildPayload(rules: MerchantIdRule[]): MerchantIdRulesPagePayload {
  return {
    version: 1,
    rules: sortMerchantIdRules(rules),
  };
}

function readRulesFromBlocks(blocks: unknown) {
  if (Array.isArray(blocks)) return normalizeMerchantIdRules(blocks);
  if (!blocks || typeof blocks !== "object") return [];
  const payload = blocks as { rules?: unknown };
  return normalizeMerchantIdRules(payload.rules);
}

export async function loadMerchantIdRulesFromStore(supabase: unknown): Promise<{
  rowId: string;
  rules: MerchantIdRule[];
}> {
  const client = supabase as MerchantIdRulesStoreClient;
  const { data, error } = await client
    .from("pages")
    .select("id,blocks")
    .is("merchant_id", null)
    .eq("slug", MERCHANT_ID_RULES_PAGE_SLUG)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "merchant_id_rules_load_failed");
  }

  return {
    rowId: String(data?.id ?? "").trim(),
    rules: readRulesFromBlocks(data?.blocks),
  };
}

export async function saveMerchantIdRulesToStore(
  supabase: unknown,
  rowId: string,
  rules: MerchantIdRule[],
) {
  const client = supabase as MerchantIdRulesStoreClient;
  const payload = buildPayload(rules);
  if (rowId) {
    const { error } = await client.from("pages").update({ blocks: payload }).eq("id", rowId);
    if (error) {
      throw new Error(error.message || "merchant_id_rules_save_failed");
    }
    return;
  }

  const { error } = await client.from("pages").insert({
    merchant_id: null,
    slug: MERCHANT_ID_RULES_PAGE_SLUG,
    blocks: payload,
  });
  if (error) {
    throw new Error(error.message || "merchant_id_rules_save_failed");
  }
}
