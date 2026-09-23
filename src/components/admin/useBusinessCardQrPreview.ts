"use client";

import { useEffect, useState } from "react";
import { isBusinessCardQrColorReadable, type BusinessCardQrAppearance } from "@/lib/merchantBusinessCardQr";
import { businessCardQrSvgDataUrl, createBusinessCardQrSvg } from "@/lib/merchantBusinessCardQrRender";
import { decodeBusinessCardQrPreview, selectBusinessCardQrPreview, type BusinessCardQrPreview } from "@/lib/merchantBusinessCardQrPreview";

export function useBusinessCardQrPreview(key: string, enabled: boolean, scope: string, onError: (message: string) => void) {
  const [preview, setPreview] = useState<BusinessCardQrPreview | null>(null);
  const [target, appearance] = JSON.parse(key) as [string, BusinessCardQrAppearance];
  const allowed = enabled && !!target && isBusinessCardQrColorReadable(appearance.color || "#000000", appearance.backgroundColor);

  useEffect(() => {
    let cancelled = false;
    if (!allowed) return;
    const [nextTarget, nextAppearance] = JSON.parse(key) as [string, BusinessCardQrAppearance];
    const timer = window.setTimeout(() => {
      void (async () => {
        const svg = await createBusinessCardQrSvg(nextTarget, nextAppearance);
        if (cancelled) return;
        const url = businessCardQrSvgDataUrl(svg);
        await decodeBusinessCardQrPreview(url);
        if (!cancelled) setPreview({ key, scope, target: nextTarget, appearance: nextAppearance, url });
      })().catch(error => {
        if (cancelled) return;
        setPreview(null);
        onError(error instanceof Error && /字体/.test(error.message) ? error.message : "二维码预览生成失败，请调整设置后重试。");
      });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [allowed, key, scope, onError]);

  return selectBusinessCardQrPreview(preview, key, target, scope, allowed);
}
