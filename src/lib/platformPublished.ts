import { createClient } from "@supabase/supabase-js";
import type { Block } from "@/data/homeBlocks";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";

type QueryErrorLike = { message?: string } | null;
type QueryResult<T> = { data: T | null; error: QueryErrorLike };
type QueryBuilder<T> = {
  select: (columns: string) => QueryBuilder<T>;
  is: (column: string, value: unknown) => QueryBuilder<T>;
  eq: (column: string, value: unknown) => QueryBuilder<T>;
  limit: (value: number) => QueryBuilder<T>;
  maybeSingle: () => Promise<QueryResult<T>>;
};
type LooseSupabaseClient = {
  from: (table: string) => QueryBuilder<{ blocks?: unknown }>;
};

export type PublishedPlatformBlocksResult = {
  blocks: Block[] | null;
  error: string | null;
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
    return {
      blocks: sanitizeBlocksForRuntime(scoped.data.blocks as Block[]).blocks,
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
      return {
        blocks: sanitizeBlocksForRuntime(bySlug.data.blocks as Block[]).blocks,
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
      return {
        blocks: sanitizeBlocksForRuntime(byMerchantOnly.data.blocks as Block[]).blocks,
        error: null,
      };
    }
  }

  return { blocks: null, error: scopedMessage || "platform_published_not_found" };
}
