import { createClient } from "@supabase/supabase-js";
import HomePageClient from "./HomePageClient";
import { homeBlocks, type Block } from "@/data/homeBlocks";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type QueryErrorLike = { message?: string } | null;
type QueryResult<T> = { data: T | null; error: QueryErrorLike };
type LooseQueryBuilder<T> = {
  select: (columns: string) => QueryBuilder<T>;
  is: (column: string, value: unknown) => QueryBuilder<T>;
  eq: (column: string, value: unknown) => QueryBuilder<T>;
  limit: (value: number) => QueryBuilder<T>;
  maybeSingle: () => Promise<QueryResult<T>>;
};
type QueryBuilder<T> = LooseQueryBuilder<T>;
type LooseSupabaseClient = {
  from: (table: string) => LooseQueryBuilder<{ blocks?: unknown }>;
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

async function queryPublishedPlatformHomeBlocks(): Promise<Block[]> {
  const supabase = createServerSupabaseClient() as unknown as LooseSupabaseClient | null;
  if (!supabase) return homeBlocks;

  const pages = supabase.from("pages");

  const scoped = await pages
    .select("blocks")
    .is("merchant_id", null)
    .eq("slug", "home")
    .limit(1)
    .maybeSingle();

  if (!scoped.error && Array.isArray(scoped.data?.blocks)) {
    return sanitizeBlocksForRuntime(scoped.data.blocks as Block[]).blocks;
  }

  const scopedMessage = toErrorMessage(scoped.error);
  const canTryBySlug = isMissingMerchantIdColumn(scopedMessage);
  const canTryByMerchantOnly = isMissingSlugColumn(scopedMessage);

  if (canTryBySlug) {
    const bySlug = await supabase
      .from("pages")
      .select("blocks")
      .eq("slug", "home")
      .limit(1)
      .maybeSingle();
    if (!bySlug.error && Array.isArray(bySlug.data?.blocks)) {
      return sanitizeBlocksForRuntime(bySlug.data.blocks as Block[]).blocks;
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
      return sanitizeBlocksForRuntime(byMerchantOnly.data.blocks as Block[]).blocks;
    }
  }

  return homeBlocks;
}

export default async function Page() {
  const initialBlocks = await queryPublishedPlatformHomeBlocks();
  return <HomePageClient initialBlocks={initialBlocks} />;
}
