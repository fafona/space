"use client";
import { useCallback, useEffect, useState } from "react";
import FaollaQrPanel from "@/components/FaollaQrPanel";
import { buildFaollaQrConnectUrl, fetchFaollaQrToken, resetFaollaQrToken } from "@/lib/faollaQrClient";
import { serviceButton, type ServiceIdentity } from "./serviceCenterClient";
import { serviceQrLink } from "./serviceQrLink";

export default function ServicePersonalQr({ active, identity, onBack }: { active: boolean; identity: ServiceIdentity; onBack: () => void }) {
  const [token, setToken] = useState(""), [error, setError] = useState(""), [retry, setRetry] = useState(0), [scanned, setScanned] = useState("");
  const [copyNote, setCopyNote] = useState("");
  const scannedResult = useCallback((value: string) => { setScanned(value); setCopyNote(""); }, []);
  useEffect(() => {
    if (!active || !identity.authenticated) return;
    let cancelled = false;
    void fetchFaollaQrToken("personal", identity.accountId).then(value => { if (!cancelled) { setToken(value); setError(""); } }).catch(() => { if (!cancelled) setError("个人二维码读取失败，请重试。"); });
    return () => { cancelled = true; };
  }, [active, identity.authenticated, identity.accountId, retry]);
  if (!active) return null; // Unmount the scanner and stop its camera when hidden.
  if (!identity.authenticated) return <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">请登录后使用个人二维码。</p>;
  const name = identity.profile.nickname || identity.profile.name || identity.accountId;
  const qrUrl = token ? buildFaollaQrConnectUrl({ origin: window.location.origin, type: "personal", id: identity.accountId, name, token }) : "";
  const scannedHref = serviceQrLink(scanned, window.location.origin);
  return <div className="space-y-3" data-service-personal-qr>
    {error ? <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}<button type="button" className={serviceButton + " ml-2"} onClick={() => setRetry(value => value + 1)}>重新读取二维码</button></div> : null}
    <FaollaQrPanel contained profileName={name} profileSubtitle="Faolla 个人用户" avatarUrl={identity.profile.avatarUrl} avatarFallback={name.slice(0, 2)} qrUrl={qrUrl} note="对方扫码后会在 Faolla 会话中添加你。" onBack={onBack} onScanResult={scannedResult}
      onResetQr={async () => { const next = await resetFaollaQrToken("personal", identity.accountId); setToken(next); }} />
    {scanned ? <section className="rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm"><h4 className="font-semibold">已识别二维码</h4><p className="mt-2 break-all text-xs" data-no-translate="1">{scanned}</p>{scannedHref ? <a className={serviceButton + " mt-3 inline-flex"} href={scannedHref} target="_top" rel="noreferrer">确认打开识别结果</a> : <p className="mt-2 text-xs">此内容不是可直接打开的安全链接。</p>}<button type="button" className={serviceButton + " ml-2 mt-3"} onClick={() => { void (async () => { try { if (!navigator.clipboard?.writeText) throw Error("clipboard unavailable"); await navigator.clipboard.writeText(scanned); setCopyNote("已复制识别内容。"); } catch { setCopyNote("浏览器不允许复制，可长按上方内容手动复制。"); } })(); }}>复制识别内容</button>{copyNote ? <p role="status" className="mt-2 text-xs">{copyNote}</p> : null}</section> : null}
  </div>;
}
