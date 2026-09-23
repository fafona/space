import { signTrafficResource, trafficEnabled } from "@/lib/accountTraffic.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { isPersonalAccountNumericId } from "@/lib/platformAccounts";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { normalizeMerchantBusinessCards } from "@/lib/merchantBusinessCards";
/** Only a stored owner + exact stored share key can identify a personal card. */
export async function resolvePersonalCardTraffic(accountId: string | undefined, shareKey: string) {
  if (!trafficEnabled() || !accountId || !isPersonalAccountNumericId(accountId) || !shareKey) return null;
  try {
    const client = createServerSupabaseServiceClient(); if (!client) return null;
    const { data, error } = await client.from("pages").select("blocks").is("merchant_id", null)
      .eq("slug", `__personal_business_cards__:${accountId}`).limit(1).abortSignal(AbortSignal.timeout(1500)).maybeSingle();
    if (error || !data) return null;
    const cards = normalizeMerchantBusinessCards(Array.isArray(data.blocks) ? data.blocks : data.blocks?.cards);
    const card = cards.find((item) => item.shareKey === shareKey);
    return card ? { siteId: accountId, cardId: card.id, name: card.name } : null;
  } catch { return null; }
}
export function addCardTrafficScript(html: string, resource: { siteId: string; cardId: string; name: string } | null) {
  if (!trafficEnabled() || !resource || !isMerchantNumericId(resource.siteId) || !resource.cardId || resource.cardId.length > 240) return html;
  const token = signTrafficResource({ siteId: resource.siteId, module: "card", objectId: resource.cardId, label: resource.name });
  // The signature alphabet is safe in an attribute. No user text in executable JS.
  return html.replace("</body>", `<script defer src="/traffic-card-v1.js" data-traffic-token="${token}"></script></body>`);
}
