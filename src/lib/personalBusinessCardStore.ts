import { normalizeMerchantBusinessCards, type MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";

const PERSONAL_BUSINESS_CARD_SLUG_PREFIX = "__personal_business_cards__:";

export type PersonalBusinessCardStoreClient = {
  from: (table: string) => any;
};

export type StoredPersonalBusinessCards = {
  accountId: string;
  cards: MerchantBusinessCardAsset[];
  updatedAt: string | null;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAccountId(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function toErrorMessage(input: unknown) {
  if (!input || typeof input !== "object") return "unknown_error";
  const message = (input as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : "unknown_error";
}

function isMissingSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingMerchantIdColumn(message: string) {
  return (
    /column\s+pages\.merchant_id\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]merchant_id['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingUpdatedAtColumn(message: string) {
  return (
    /column\s+pages\.updated_at\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]updated_at['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function buildPersonalBusinessCardSlug(accountId: string) {
  return `${PERSONAL_BUSINESS_CARD_SLUG_PREFIX}${accountId}`;
}

function readCardsFromBlocks(value: unknown) {
  if (Array.isArray(value)) return normalizeMerchantBusinessCards(value);
  if (!value || typeof value !== "object") return [];
  const record = value as { cards?: unknown };
  return normalizeMerchantBusinessCards(record.cards);
}

export async function loadStoredPersonalBusinessCards(
  supabase: PersonalBusinessCardStoreClient,
  accountId: string,
): Promise<StoredPersonalBusinessCards | null> {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!normalizedAccountId) return null;
  const slug = buildPersonalBusinessCardSlug(normalizedAccountId);

  const initialQuery = await supabase
    .from("pages")
    .select("blocks,updated_at")
    .is("merchant_id", null)
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();

  let data = initialQuery.data as { blocks?: unknown; updated_at?: unknown } | null;
  let error = initialQuery.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      const bySlug = await supabase.from("pages").select("blocks,updated_at").eq("slug", slug).limit(1).maybeSingle();
      data = bySlug.data as { blocks?: unknown; updated_at?: unknown } | null;
      error = bySlug.error;
    } else if (isMissingSlugColumn(message)) {
      return null;
    } else {
      return null;
    }
  }

  if (error) return null;
  const cards = readCardsFromBlocks(data?.blocks);
  return {
    accountId: normalizedAccountId,
    cards,
    updatedAt: typeof data?.updated_at === "string" ? data.updated_at.trim() : null,
  };
}

export async function saveStoredPersonalBusinessCards(
  supabase: PersonalBusinessCardStoreClient,
  input: {
    accountId: string;
    cards: MerchantBusinessCardAsset[];
    updatedAt?: string | null;
  },
): Promise<{ error: string | null; cards?: MerchantBusinessCardAsset[] }> {
  const normalizedAccountId = normalizeAccountId(input.accountId);
  if (!normalizedAccountId) return { error: "invalid_account_id" };
  const slug = buildPersonalBusinessCardSlug(normalizedAccountId);
  const normalizedCards = normalizeMerchantBusinessCards(input.cards);
  const updatedAt = normalizeText(input.updatedAt) || new Date().toISOString();
  const blocks = {
    type: "personal_business_cards",
    version: 1,
    cards: normalizedCards,
  };
  const basePayload = {
    blocks,
    updated_at: updatedAt,
  };

  const queryExisting = async () => {
    const scoped = await supabase
      .from("pages")
      .select("id")
      .is("merchant_id", null)
      .eq("slug", slug)
      .limit(1)
      .maybeSingle();
    if (!scoped.error) {
      return {
        record: (scoped.data ?? null) as { id?: string | number | null } | null,
        supportsSlug: true,
        supportsMerchantId: true,
      };
    }

    const scopedMessage = toErrorMessage(scoped.error);
    if (isMissingMerchantIdColumn(scopedMessage)) {
      const bySlug = await supabase.from("pages").select("id").eq("slug", slug).limit(1).maybeSingle();
      if (!bySlug.error) {
        return {
          record: (bySlug.data ?? null) as { id?: string | number | null } | null,
          supportsSlug: true,
          supportsMerchantId: false,
        };
      }
      return { error: toErrorMessage(bySlug.error) };
    }

    if (isMissingSlugColumn(scopedMessage)) {
      return { error: "pages_slug_column_missing" };
    }

    return { error: scopedMessage };
  };

  const existing = await queryExisting();
  if ("error" in existing && existing.error) {
    return { error: existing.error };
  }

  const updatePayload = async (body: Record<string, unknown>) => {
    const recordId = existing.record?.id;
    if (recordId !== undefined && recordId !== null) {
      const updated = await supabase.from("pages").update(body).eq("id", recordId);
      return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
    }

    if (existing.supportsSlug) {
      const inserted = await supabase.from("pages").insert({
        ...body,
        slug,
        ...(existing.supportsMerchantId ? { merchant_id: null } : {}),
      });
      return inserted.error ? { error: toErrorMessage(inserted.error) } : { error: null };
    }

    return { error: "pages_slug_column_missing" };
  };

  const first = await updatePayload(basePayload);
  if (!first.error) return { error: null, cards: normalizedCards };
  if (!isMissingUpdatedAtColumn(first.error)) return { error: first.error };
  const fallback = await updatePayload({ blocks });
  return fallback.error ? { error: fallback.error } : { error: null, cards: normalizedCards };
}
