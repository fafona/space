"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { resolvePublishedSiteByPrefix } from "@/lib/publishedSiteLookup";

const MerchantPage = dynamic(() => import("@/app/site/[siteId]/SitePageClient"), {
  loading: () => <p role="status" className="p-8 text-center text-sm text-slate-500">正在加载商户网站…</p>,
});

/** Fallback only: never paint/download the platform home while resolving a merchant host. */
export default function MerchantHostEntry({ prefix, serviceOrigin }: { prefix: string; serviceOrigin?: string }) {
  const [siteId, setSiteId] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void resolvePublishedSiteByPrefix(prefix).then(result => {
      if (!active) return;
      setSiteId(result?.siteId ?? ""); setFailed(!result?.siteId);
    });
    return () => { active = false; };
  }, [prefix, attempt]);
  if (siteId) return <MerchantPage forcedSiteId={siteId} serviceOrigin={serviceOrigin} />;
  return <div className="p-8 text-center text-sm text-slate-500" role="status">
    {failed ? <><p>暂时无法读取商户网站。</p><button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>重新读取</button></> : "正在加载商户网站…"}
  </div>;
}
