"use client";
import { useState } from "react";
import { buildTrafficChannelLink, type TrafficMedium } from "@/lib/accountTraffic";

export default function TrafficChannelLinkBuilder({ siteId }: { siteId: string }) {
  const [url, setUrl] = useState("");
  const [medium, setMedium] = useState<TrafficMedium>("qr");
  const [copied, setCopied] = useState("");
  const [label, setLabel] = useState("");
  const [campaign, setCampaign] = useState<{ key: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const currentKey = JSON.stringify([siteId,url,medium,label]);
  let result = "", error = "";
  if (url.trim()) { try { result = buildTrafficChannelLink(url, medium); } catch (reason) { error = reason instanceof Error ? reason.message : "链接无效"; } }
  return <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
    <summary className="cursor-pointer font-semibold">生成可选渠道链接（不修改现有名片或二维码）</summary>
    <p className="my-2 text-xs text-slate-500">仅用于已接入统计的 Faolla 公开网站或联系卡。名片内部跳转保留渠道标签；外部官网暂不支持。活动只归属当前账号，不会把其他账号的访问计入本账号。</p>
    <div className="flex flex-wrap gap-2"><input aria-label="公开页面地址" type="url" className="min-w-48 flex-1 rounded border p-2" placeholder="https://商户.faolla.com/ 或公开联系卡链接" value={url} onChange={(event) => { setUrl(event.target.value); setCopied(""); }}/>
      <select aria-label="链接渠道" className="rounded border p-2" value={medium} onChange={(event) => { setMedium(event.target.value as TrafficMedium); setCopied(""); }}>
        <option value="qr">二维码渠道</option><option value="share">分享链接</option><option value="nfc">NFC 渠道</option><option value="ad">广告渠道</option>
      </select></div>
    {error && <p role="alert" className="mt-2 text-amber-800">{error}</p>}
    <div className="mt-2 flex flex-wrap gap-2"><input aria-label="活动或投放位置名称" maxLength={80} className="min-w-48 flex-1 rounded border p-2" placeholder="例如：秋季活动·门口海报（不要填写个人资料）" value={label} onChange={(event)=>setLabel(event.target.value)}/><button type="button" disabled={!result || !label.trim() || busy} className="rounded border px-3 py-2 disabled:opacity-40" onClick={async()=>{
      setBusy(true); setCopied("");
      try {
        const response=await fetch('/api/super-admin/traffic/campaign',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId,url,medium,label}),signal:AbortSignal.timeout(10000)});
        const body=await response.json(); if(!response.ok) throw new Error(body.message || '活动链接生成失败，请确认超级后台登录。');
        setCampaign({key:currentKey,url:body.url}); setCopied('活动链接已生成。请保存此链接；再次生成将创建独立活动 ID。');
      } catch(reason) {setCopied(reason instanceof Error ? reason.message : '生成失败');} finally {setBusy(false);}
    }}>{busy ? '正在生成…' : '生成独立活动链接'}</button></div>
    {campaign?.key === currentKey && <div className="mt-2 flex gap-2"><input aria-label="活动渠道链接" readOnly value={campaign.url} className="min-w-0 flex-1 rounded border p-2"/><button type="button" className="rounded border px-3" onClick={async()=>{try{await navigator.clipboard.writeText(campaign.url);setCopied('已复制活动链接。');}catch{setCopied('请手动复制活动链接。');}}}>复制活动链接</button></div>}
    {result && <div className="mt-2 flex flex-wrap gap-2"><input aria-label="生成的渠道链接" readOnly value={result} className="min-w-48 flex-1 rounded border bg-slate-50 p-2"/><button type="button" className="rounded border px-3 py-2" onClick={async () => {
      try { await navigator.clipboard.writeText(result); setCopied("已复制；未修改或保存任何现有链接。"); }
      catch { setCopied("自动复制不可用，请选中链接手动复制。"); }
    }}>复制渠道链接</button></div>}
    {copied && <p role="status" className="mt-2 text-xs">{copied}</p>}
    <p className="mt-2 text-xs text-slate-500">链接标签可被复制或更改，不能证明真实扫码、分享发送或广告点击，也不跟踪跨页面路径。</p>
  </details>;
}
