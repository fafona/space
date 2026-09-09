import type { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export type FaollaQrAccountType = "merchant" | "personal";
export type FaollaQrTokenEntry = { token: string; updatedAt: string };
export type FaollaQrTokenStoreClient = Pick<
  NonNullable<ReturnType<typeof createServerSupabaseServiceClient>>,
  "from" | "rpc"
>;

const QR_TOKEN_SLUG = "__faolla_qr_tokens__";
const QR_TOKEN_MUTATION_RPC = "faolla_mutate_qr_token_v1";

export class FaollaQrTokenStoreError extends Error {
  constructor(public readonly code: "qr_token_load_failed" | "qr_token_save_failed" | "qr_token_store_unavailable") {
    super(code);
    this.name = "FaollaQrTokenStoreError";
  }
}

function text(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function readEntry(value: unknown): FaollaQrTokenEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const token = text(entry.token, 128);
  return token ? {
    token,
    updatedAt: text(entry.updatedAt, 64) || new Date(0).toISOString(),
  } : null;
}

export async function loadFaollaQrTokenEntry(
  client: FaollaQrTokenStoreClient,
  type: FaollaQrAccountType,
  accountId: string,
): Promise<FaollaQrTokenEntry | null> {
  const { data, error } = await client.from("pages")
    .select("blocks")
    .is("merchant_id", null)
    .eq("slug", QR_TOKEN_SLUG)
    .limit(1)
    .maybeSingle();
  if (error) throw new FaollaQrTokenStoreError("qr_token_load_failed");
  const blocks: unknown = data?.blocks;
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) return null;
  const entries = (blocks as { entries?: unknown }).entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return null;
  return readEntry((entries as Record<string, unknown>)[`${type}:${accountId}`]);
}

export async function mutateFaollaQrTokenEntry(
  client: FaollaQrTokenStoreClient,
  type: FaollaQrAccountType,
  accountId: string,
  action: "ensure" | "reset",
): Promise<FaollaQrTokenEntry> {
  // The database decides both the winner of a concurrent ensure and the
  // ordering of resets. Never send a stale document or fall back to UPDATE.
  const { data, error } = await client.rpc(QR_TOKEN_MUTATION_RPC, {
    p_account_type: type,
    p_account_id: accountId,
    p_action: action,
  });
  if (error) {
    const code = typeof error.code === "string" ? error.code : "";
    throw new FaollaQrTokenStoreError(
      code === "PGRST202" || code === "42883" || code === "42501"
        ? "qr_token_store_unavailable"
        : "qr_token_save_failed",
    );
  }
  const entry = readEntry(data);
  if (!entry) throw new FaollaQrTokenStoreError("qr_token_save_failed");
  return entry;
}
