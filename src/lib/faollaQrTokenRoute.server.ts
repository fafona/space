import { NextResponse } from "next/server";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import {
  FaollaQrTokenStoreError,
  loadFaollaQrTokenEntry,
  mutateFaollaQrTokenEntry,
  type FaollaQrAccountType,
  type FaollaQrTokenStoreClient,
} from "@/lib/faollaQrTokenStore.server";

type QrTokenDependencies = {
  client: () => FaollaQrTokenStoreClient | null;
  authorized: (request: Request, type: FaollaQrAccountType, accountId: string) => Promise<boolean>;
  load: typeof loadFaollaQrTokenEntry;
  mutate: typeof mutateFaollaQrTokenEntry;
};

const defaults: QrTokenDependencies = {
  client: createServerSupabaseServiceClient,
  authorized: async (request, type, accountId) => {
    if (type === "personal") {
      const session = await resolvePersonalAccountSessionFromRequest(request);
      return session?.accountId === accountId;
    }
    const session = await resolveMerchantSessionFromRequest(request, { hintedMerchantId: accountId });
    return session?.merchantId === accountId;
  },
  load: loadFaollaQrTokenEntry,
  mutate: mutateFaollaQrTokenEntry,
};

function text(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function normalizeAccount(type: unknown, accountId: unknown) {
  const id = text(accountId, 32);
  if ((type !== "merchant" && type !== "personal") || !/^\d{8}$/.test(id)) return null;
  return { type, id } as const;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function storeFailure(error: unknown, fallback: "qr_token_load_failed" | "qr_token_save_failed") {
  const code = error instanceof FaollaQrTokenStoreError ? error.code : fallback;
  return json({ error: code }, code === "qr_token_store_unavailable" ? 503 : 500);
}

export async function handleFaollaQrTokenGet(request: Request, dependencies: Partial<QrTokenDependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  const params = new URL(request.url).searchParams;
  const account = normalizeAccount(params.get("type"), params.get("id"));
  if (!account) return json({ error: "invalid_qr_account" }, 400);
  const validate = text(params.get("mode"), 32) === "validate";
  if (!validate && !await deps.authorized(request, account.type, account.id)) {
    return json({ error: "unauthorized" }, 401);
  }
  const client = deps.client();
  if (!client) return json({ error: "supabase_not_configured" }, 503);
  const ensure = !validate && params.get("ensure") === "1";
  try {
    // Re-read under the database lock even if an entry already exists.
    const entry = ensure
      ? await deps.mutate(client, account.type, account.id, "ensure")
      : await deps.load(client, account.type, account.id);
    if (validate) {
      const token = text(params.get("token"), 128);
      return json({ ok: true, valid: Boolean(token && entry?.token === token) });
    }
    return json({ ok: true, token: entry?.token ?? "", updatedAt: entry?.updatedAt ?? "" });
  } catch (error) {
    return storeFailure(error, ensure ? "qr_token_save_failed" : "qr_token_load_failed");
  }
}

export async function handleFaollaQrTokenPost(request: Request, dependencies: Partial<QrTokenDependencies> = {}) {
  const deps = { ...defaults, ...dependencies };
  const body = await request.json().catch(() => null) as {
    type?: unknown; id?: unknown; action?: unknown;
  } | null;
  const account = normalizeAccount(body?.type, body?.id);
  if (!account) return json({ error: "invalid_qr_account" }, 400);
  if (text(body?.action, 32) !== "reset") return json({ error: "unsupported_action" }, 400);
  if (!await deps.authorized(request, account.type, account.id)) return json({ error: "unauthorized" }, 401);
  const client = deps.client();
  if (!client) return json({ error: "supabase_not_configured" }, 503);
  try {
    const entry = await deps.mutate(client, account.type, account.id, "reset");
    return json({ ok: true, ...entry });
  } catch (error) {
    return storeFailure(error, "qr_token_save_failed");
  }
}
