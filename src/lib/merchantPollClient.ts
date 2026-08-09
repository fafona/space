import { isMerchantNumericId } from "@/lib/merchantIdentity";

type AllocatePollIdPayload = {
  ok?: boolean;
  pollId?: string;
  error?: string;
  message?: string;
};

export async function allocateMerchantPollId(siteId: string) {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!isMerchantNumericId(normalizedSiteId)) throw new Error("invalid_merchant_id");

  const response = await fetch("/api/polls", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action: "allocate_poll_id", siteId: normalizedSiteId }),
  });
  const payload = (await response.json().catch(() => null)) as AllocatePollIdPayload | null;
  const pollId = String(payload?.pollId ?? "").trim();
  if (!response.ok || !payload?.ok || !/^TP\d{16}$/.test(pollId)) {
    throw new Error(payload?.message || payload?.error || "poll_id_allocation_failed");
  }
  return pollId;
}
