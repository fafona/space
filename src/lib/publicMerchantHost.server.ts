import { cache } from "react";
import { extractMerchantPrefixFromHost } from "@/lib/siteRouting";
import { loadPublishedMerchantServiceStateByTargetUrl } from "@/lib/publishedMerchantService";

export function readPublicMerchantHost(host: string, baseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN || "faolla.com") {
  const normalized = host.trim().toLowerCase();
  if (!normalized || /[\\/@?#\s]/.test(normalized)) return null;
  try {
    const root = new URL(/^https?:\/\//.test(baseDomain) ? baseDomain : `https://${baseDomain}`).hostname.replace(/^(?:www|launch)\./, "");
    const current = new URL(`https://${normalized}`).hostname;
    if (!current.endsWith(`.${root}`)) return null;
  } catch { return null; }
  const prefix = extractMerchantPrefixFromHost(normalized, baseDomain);
  return prefix ? { prefix, host: normalized } : null;
}

export const resolvePublicMerchantHost = cache(async (host: string) => {
  const merchant = readPublicMerchantHost(host);
  if (!merchant) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const state = await Promise.race([
      loadPublishedMerchantServiceStateByTargetUrl(`https://${merchant.host}/`).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1200); }),
    ]);
    return { ...merchant, siteId: state?.siteId ?? "" };
  } finally { if (timer) clearTimeout(timer); }
});
