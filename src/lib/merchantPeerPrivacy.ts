import type { MerchantPeerInboxPayload } from "@/lib/merchantPeerInbox";
import { normalizeCanonicalPersonalAccountId } from "@/lib/personalAccountId";

export type PeerIdentityDecoration = {
  accountType: "merchant" | "personal";
  merchantId: string;
  merchantName: string;
  merchantEmail: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function email(value: unknown) {
  return text(value).toLowerCase();
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

export function sanitizePeerDisplayName(value: unknown, accountId: unknown) {
  const candidate = text(value);
  const fallback = text(accountId);
  return candidate && !looksLikeEmail(candidate) ? candidate : fallback;
}

const AUTH_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERSONAL_BINDING_PAGE_SIZE = 500;
const PERSONAL_BINDING_MAX_RECORDS = 100_000;

export type CompletePersonalPeerBinding = {
  authUserId: string;
  accountId: string;
  status: "active" | "disabled";
};

/**
 * Loads the canonical directory as one all-or-nothing snapshot. Partial pages,
 * malformed rows, duplicates and transport errors are authorization/PII
 * failures: callers must return 503 without serializing legacy inbox data.
 */
export async function loadCompletePersonalPeerBindingDirectory(
  fetchPage: (
    from: number,
    to: number,
  ) => Promise<{ data: unknown; error: unknown; count: unknown }>,
) {
  const rows: CompletePersonalPeerBinding[] = [];
  const seenAuthUserIds = new Set<string>();
  const seenAccountIds = new Set<string>();
  let expectedCount: number | null = null;
  let offset = 0;
  while (offset <= PERSONAL_BINDING_MAX_RECORDS) {
    const page = await fetchPage(
      offset,
      offset + PERSONAL_BINDING_PAGE_SIZE - 1,
    ).catch((error) => ({ data: null, error, count: null }));
    if (page.error || !Array.isArray(page.data)) {
      throw new Error("personal_peer_directory_unavailable");
    }
    if (
      !Number.isSafeInteger(page.count) ||
      Number(page.count) < 0 ||
      Number(page.count) > PERSONAL_BINDING_MAX_RECORDS ||
      (expectedCount !== null && Number(page.count) !== expectedCount) ||
      page.data.length > PERSONAL_BINDING_PAGE_SIZE
    ) {
      throw new Error("personal_peer_directory_invalid");
    }
    expectedCount ??= Number(page.count);
    for (const value of page.data) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("personal_peer_directory_invalid");
      }
      const record = value as Record<string, unknown>;
      const authUserId = text(record.auth_user_id).toLowerCase();
      const accountId = normalizeCanonicalPersonalAccountId(
        record.personal_account_id,
      );
      const status =
        record.status === "active" || record.status === "disabled"
          ? record.status
          : null;
      if (
        !AUTH_UUID_PATTERN.test(authUserId) ||
        !accountId ||
        !status ||
        seenAuthUserIds.has(authUserId) ||
        seenAccountIds.has(accountId)
      ) {
        throw new Error("personal_peer_directory_invalid");
      }
      seenAuthUserIds.add(authUserId);
      seenAccountIds.add(accountId);
      rows.push({ authUserId, accountId, status });
    }
    if (rows.length === expectedCount) return rows;
    if (
      rows.length > expectedCount ||
      page.data.length !== PERSONAL_BINDING_PAGE_SIZE
    ) {
      // A short page before the exact count is reached means PostgREST (or an
      // intermediary) truncated the result. Treat it like a partial outage.
      throw new Error("personal_peer_directory_incomplete");
    }
    offset += page.data.length;
  }
  throw new Error("personal_peer_directory_too_large");
}

export function buildPersonalPeerDecoration(input: {
  accountId: string;
  publicName?: unknown;
  privateEmail?: unknown;
}): PeerIdentityDecoration {
  const accountId = text(input.accountId);
  const candidateName = sanitizePeerDisplayName(input.publicName, accountId);
  const privateEmail = email(input.privateEmail);
  const merchantName =
    candidateName &&
    email(candidateName) !== privateEmail
      ? candidateName
      : accountId;
  return {
    accountType: "personal",
    merchantId: accountId,
    merchantName: merchantName || accountId,
    merchantEmail: "",
  };
}

/**
 * Request-supplied contact/sender decoration is allowed for merchant peers,
 * but never for a personal peer: otherwise callers could persist a personal
 * login email (or an email-shaped name) into shared inbox state.
 */
export function buildPeerWriteDecoration(
  record: PeerIdentityDecoration,
  requestedName?: unknown,
  requestedEmail?: unknown,
) {
  if (record.accountType === "personal") {
    return buildPersonalPeerDecoration({
      accountId: record.merchantId,
      publicName: record.merchantName,
      privateEmail: record.merchantEmail,
    });
  }
  return {
    ...record,
    merchantName: text(requestedName) || record.merchantName || record.merchantId,
    merchantEmail: email(requestedEmail) || email(record.merchantEmail),
  };
}

/** Clears both current and legacy persisted email/name fallbacks for exact
 * authoritative personal account IDs before save or response serialization. */
export function redactPersonalPeerIdentityData(
  payload: MerchantPeerInboxPayload,
  personalAccountIds: Iterable<string>,
): MerchantPeerInboxPayload {
  const personalIds = new Set(
    [...personalAccountIds].map((value) => text(value)).filter(Boolean),
  );
  if (personalIds.size === 0) return payload;
  return {
    contacts: payload.contacts.map((contact) =>
      personalIds.has(contact.contactMerchantId)
        ? {
            ...contact,
            contactName: sanitizePeerDisplayName(
              contact.contactName,
              contact.contactMerchantId,
            ),
            contactEmail: "",
          }
        : contact,
    ),
    threads: payload.threads.map((thread) => ({
      ...thread,
      ...(personalIds.has(thread.merchantAId)
        ? {
            merchantAName: sanitizePeerDisplayName(
              thread.merchantAName,
              thread.merchantAId,
            ),
            merchantAEmail: "",
          }
        : {}),
      ...(personalIds.has(thread.merchantBId)
        ? {
            merchantBName: sanitizePeerDisplayName(
              thread.merchantBName,
              thread.merchantBId,
            ),
            merchantBEmail: "",
          }
        : {}),
    })),
  };
}
