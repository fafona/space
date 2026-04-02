import { NextResponse } from "next/server";
import {
  createMerchantPeerMessage,
  findMerchantPeerThreadForMerchants,
  listMerchantPeerContactsForMerchant,
  listMerchantPeerThreadsForMerchant,
  upsertMerchantPeerContact,
  upsertMerchantPeerMessage,
} from "@/lib/merchantPeerInbox";
import {
  loadStoredMerchantPeerInbox,
  saveMerchantPeerInbox,
  type MerchantPeerInboxStoreClient,
} from "@/lib/merchantPeerInboxStore";
import { loadStoredPlatformMerchantSnapshot, type PlatformMerchantSnapshotStoreClient } from "@/lib/platformMerchantSnapshotStore";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ResolvedMerchantRecord = {
  merchantId: string;
  merchantName: string;
  merchantEmail: string;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return trimText(value).toLowerCase();
}

function normalizeMerchantId(value: unknown) {
  const normalized = trimText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeSupportText(value: unknown) {
  return trimText(value).slice(0, 5000);
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function resolveMerchantSession(request: Request) {
  const origin = new URL(request.url).origin;
  const accessToken = trimText(request.headers.get("x-merchant-access-token"));
  const refreshToken = trimText(request.headers.get("x-merchant-refresh-token"));
  const expiresInHeader = trimText(request.headers.get("x-merchant-expires-in"));
  const hintedSiteId = trimText(request.headers.get("x-merchant-site-id"));
  const hintedEmail = normalizeEmail(request.headers.get("x-merchant-email"));
  const hintedName = trimText(request.headers.get("x-merchant-name"));
  const fallbackMerchantId = hintedSiteId || hintedEmail || hintedName;
  if (accessToken) {
    await fetch(`${origin}/api/auth/merchant-session`, {
      method: "POST",
      headers: {
        cookie: request.headers.get("cookie") ?? "",
        "content-type": "application/json",
        accept: "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        accessToken,
        refreshToken,
        expiresIn: expiresInHeader ? Number(expiresInHeader) : undefined,
      }),
    }).catch(() => null);
  }
  const response = await fetch(`${origin}/api/auth/merchant-session`, {
    method: "GET",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
    cache: "no-store",
  }).catch(() => null);
  if (!response) {
    if (!fallbackMerchantId) return null;
    return {
      merchantId: fallbackMerchantId,
      merchantEmail: hintedEmail,
      merchantName: hintedName,
    };
  }
  const payload = (await response.json().catch(() => null)) as
    | {
        authenticated?: boolean;
        merchantId?: string | null;
        user?: { email?: string | null } | null;
      }
    | null;
  if (!payload?.authenticated) {
    if (!fallbackMerchantId) return null;
    return {
      merchantId: fallbackMerchantId,
      merchantEmail: hintedEmail,
      merchantName: hintedName,
    };
  }
  const merchantId =
    trimText(payload.merchantId) || hintedSiteId || normalizeEmail(payload.user?.email) || hintedEmail || hintedName;
  if (!merchantId) return null;
  return {
    merchantId,
    merchantEmail: normalizeEmail(payload.user?.email) || hintedEmail,
    merchantName: hintedName,
  };
}

function readResolvedMerchantEmail(record: Record<string, unknown> | null | undefined) {
  const candidates = [
    record?.user_email,
    record?.email,
    record?.owner_email,
    record?.contact_email,
  ];
  return candidates.map((value) => normalizeEmail(value)).find(Boolean) ?? "";
}

function toResolvedMerchantRecord(record: Record<string, unknown> | null | undefined) {
  const merchantId = normalizeMerchantId(record?.id);
  if (!merchantId) return null;
  return {
    merchantId,
    merchantName: trimText(record?.name) || merchantId,
    merchantEmail: readResolvedMerchantEmail(record),
  } satisfies ResolvedMerchantRecord;
}

async function resolveMerchantById(
  supabase: ReturnType<typeof createServerSupabaseServiceClient>,
  merchantId: string,
) {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!supabase || !normalizedMerchantId) return null;
  const { data, error } = await supabase
    .from("merchants")
    .select("id,name,email,owner_email,contact_email,user_email")
    .eq("id", normalizedMerchantId)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return toResolvedMerchantRecord((data ?? null) as Record<string, unknown> | null);
}

async function resolveMerchantByEmail(
  supabase: ReturnType<typeof createServerSupabaseServiceClient>,
  email: string,
) {
  const normalizedEmail = normalizeEmail(email);
  if (!supabase || !normalizedEmail) return { record: null, ambiguous: false };

  const lookups = await Promise.allSettled(
    ["email", "owner_email", "contact_email", "user_email"].map((column) =>
      supabase
        .from("merchants")
        .select("id,name,email,owner_email,contact_email,user_email")
        .eq(column, normalizedEmail)
        .limit(10),
    ),
  );
  const records = new Map<string, ResolvedMerchantRecord>();
  lookups.forEach((result) => {
    if (result.status !== "fulfilled" || result.value.error) return;
    const rows = Array.isArray(result.value.data) ? result.value.data : [];
    rows.forEach((row) => {
      const record = toResolvedMerchantRecord((row ?? null) as Record<string, unknown> | null);
      if (!record || records.has(record.merchantId)) return;
      records.set(record.merchantId, record);
    });
  });
  const resolved = [...records.values()];
  return {
    record: resolved[0] ?? null,
    ambiguous: resolved.length > 1,
  };
}

async function resolveMerchantByExactQuery(
  supabase: ReturnType<typeof createServerSupabaseServiceClient>,
  query: string,
) {
  const normalizedQuery = trimText(query);
  if (!normalizedQuery) {
    return { record: null, error: "search_empty" as const };
  }
  const merchantId = normalizeMerchantId(normalizedQuery);
  if (merchantId) {
    return {
      record: await resolveMerchantById(supabase, merchantId),
      error: null,
    };
  }

  const email = normalizeEmail(normalizedQuery);
  if (email && email.includes("@")) {
    const resolved = await resolveMerchantByEmail(supabase, email);
    if (resolved.ambiguous) {
      return { record: null, error: "search_ambiguous" as const };
    }
    return {
      record: resolved.record,
      error: null,
    };
  }

  return { record: null, error: "search_requires_exact_id_or_email" as const };
}

function buildInboxResponse(
  payload: Awaited<ReturnType<typeof loadStoredMerchantPeerInbox>>,
  merchantId: string,
  chatBusinessCardByMerchantId?: Map<string, unknown>,
) {
  const contacts = listMerchantPeerContactsForMerchant(payload, merchantId).map((contact) => ({
    ...contact,
    chatBusinessCard: (chatBusinessCardByMerchantId?.get(contact.merchantId) as typeof contact.chatBusinessCard | undefined) ?? null,
  }));
  const threads = listMerchantPeerThreadsForMerchant(payload, merchantId);
  return {
    ok: true,
    contacts,
    threads,
  };
}

async function loadChatBusinessCardByMerchantId(
  supabase: PlatformMerchantSnapshotStoreClient,
  merchantIds: string[],
) {
  const normalizedMerchantIds = [...new Set(merchantIds.map((merchantId) => normalizeMerchantId(merchantId)).filter(Boolean))];
  if (normalizedMerchantIds.length === 0) return new Map<string, unknown>();
  const snapshotPayload = await loadStoredPlatformMerchantSnapshot(supabase);
  const map = new Map<string, unknown>();
  (snapshotPayload?.snapshot ?? []).forEach((site) => {
    const merchantId = normalizeMerchantId(site.id);
    if (!merchantId || !normalizedMerchantIds.includes(merchantId)) return;
    map.set(merchantId, site.chatBusinessCard ?? null);
  });
  return map;
}

export async function GET(request: Request) {
  const session = await resolveMerchantSession(request);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "merchant_peer_inbox_env_missing" }, { status: 503 });
  }

  const payload = await loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient);
  const chatBusinessCardByMerchantId = await loadChatBusinessCardByMerchantId(
    supabase as unknown as PlatformMerchantSnapshotStoreClient,
    listMerchantPeerContactsForMerchant(payload, session.merchantId).map((contact) => contact.merchantId),
  );
  return noStoreJson({
    ...buildInboxResponse(payload, session.merchantId, chatBusinessCardByMerchantId),
    currentMerchantId: session.merchantId,
    currentMerchantEmail: session.merchantEmail,
  });
}

export async function POST(request: Request) {
  const session = await resolveMerchantSession(request);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "merchant_peer_inbox_env_missing" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        action?: unknown;
        query?: unknown;
        text?: unknown;
        recipientMerchantId?: unknown;
        merchantName?: unknown;
        merchantEmail?: unknown;
      }
    | null;
  const action = trimText(body?.action);

  if (action === "search") {
    const resolved = await resolveMerchantByExactQuery(supabase, trimText(body?.query));
    if (resolved.error === "search_empty") {
      return noStoreJson({ error: "search_empty", message: "请输入完整的商户ID或邮箱。" }, { status: 400 });
    }
    if (resolved.error === "search_requires_exact_id_or_email") {
      return noStoreJson(
        { error: "search_requires_exact_id_or_email", message: "仅支持精确搜索 8 位商户ID或完整邮箱。" },
        { status: 400 },
      );
    }
    if (resolved.error === "search_ambiguous") {
      return noStoreJson(
        { error: "search_ambiguous", message: "这个邮箱对应多个商户，请改用商户ID精确搜索。" },
        { status: 409 },
      );
    }
    if (!resolved.record) {
      return noStoreJson({ error: "merchant_not_found", message: "没有找到匹配的商户。" }, { status: 404 });
    }
    if (resolved.record.merchantId === session.merchantId) {
      return noStoreJson({ error: "cannot_chat_with_self", message: "不能搜索自己，请输入其他商户的ID或邮箱。" }, { status: 400 });
    }

    const payload = await loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient);
    const nextPayload = upsertMerchantPeerContact(payload, {
      ownerMerchantId: session.merchantId,
      contactMerchantId: resolved.record.merchantId,
      contactName: resolved.record.merchantName,
      contactEmail: resolved.record.merchantEmail,
    });
    const saveResult = await saveMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient, nextPayload);
    if (saveResult.error) {
      return noStoreJson(
        { error: "merchant_contact_save_failed", message: saveResult.error },
        { status: 500 },
      );
    }
    const chatBusinessCardByMerchantId = await loadChatBusinessCardByMerchantId(
      supabase as unknown as PlatformMerchantSnapshotStoreClient,
      [resolved.record.merchantId, ...listMerchantPeerContactsForMerchant(nextPayload, session.merchantId).map((contact) => contact.merchantId)],
    );

    return noStoreJson({
      ...buildInboxResponse(nextPayload, session.merchantId, chatBusinessCardByMerchantId),
      contact: {
        ...resolved.record,
        chatBusinessCard: chatBusinessCardByMerchantId.get(resolved.record.merchantId) ?? null,
      },
    });
  }

  if (action === "send") {
    const text = normalizeSupportText(body?.text);
    const recipientMerchantId = normalizeMerchantId(body?.recipientMerchantId);
    if (!recipientMerchantId || !text) {
      return noStoreJson({ error: "merchant_message_invalid" }, { status: 400 });
    }
    if (recipientMerchantId === session.merchantId) {
      return noStoreJson({ error: "cannot_chat_with_self", message: "不能给自己发送消息。" }, { status: 400 });
    }

    const recipient = await resolveMerchantById(supabase, recipientMerchantId);
    if (!recipient) {
      return noStoreJson({ error: "merchant_not_found", message: "目标商户不存在。" }, { status: 404 });
    }
    const sender =
      (await resolveMerchantById(supabase, session.merchantId)) ??
      ({
        merchantId: session.merchantId,
        merchantName: trimText(body?.merchantName) || session.merchantName || session.merchantId,
        merchantEmail: normalizeEmail(body?.merchantEmail) || session.merchantEmail,
      } satisfies ResolvedMerchantRecord);

    const payload = await loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient);
    const nextPayload = upsertMerchantPeerMessage(payload, {
      senderMerchantId: sender.merchantId,
      senderMerchantName: trimText(body?.merchantName) || sender.merchantName,
      senderMerchantEmail: normalizeEmail(body?.merchantEmail) || sender.merchantEmail,
      recipientMerchantId: recipient.merchantId,
      recipientMerchantName: recipient.merchantName,
      recipientMerchantEmail: recipient.merchantEmail,
      message: createMerchantPeerMessage({
        senderMerchantId: sender.merchantId,
        text,
      }),
    });
    const saveResult = await saveMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient, nextPayload);
    if (saveResult.error) {
      return noStoreJson(
        { error: "merchant_message_save_failed", message: saveResult.error },
        { status: 500 },
      );
    }
    const chatBusinessCardByMerchantId = await loadChatBusinessCardByMerchantId(
      supabase as unknown as PlatformMerchantSnapshotStoreClient,
      [recipient.merchantId, ...listMerchantPeerContactsForMerchant(nextPayload, session.merchantId).map((contact) => contact.merchantId)],
    );

    return noStoreJson({
      ...buildInboxResponse(nextPayload, session.merchantId, chatBusinessCardByMerchantId),
      thread: findMerchantPeerThreadForMerchants(nextPayload, session.merchantId, recipient.merchantId),
    });
  }

  return noStoreJson({ error: "unsupported_action" }, { status: 400 });
}
