"use client";
import { useEffect, useRef, useState } from "react";

/** Explicit, local-only camera use. Frames never leave this browser. */
export default function MerchantAttendanceOnsiteScanner({ onScan, disabled = false }: { onScan: (value: string) => void; disabled?: boolean }) {
  // Disabling removes the camera-owning subtree. Re-enabling mounts an idle
  // capture component, never revives the old user activation or media request.
  return <section className="space-y-3" aria-label="本机扫码">
    {disabled ? <>
      <button type="button" disabled className="rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:opacity-40">打开摄像头扫码</button>
      <p className="text-sm leading-6 text-slate-600">正在处理账号状态，摄像头保持关闭；完成后可手动重新打开。</p>
    </> : <OnsiteCameraCapture onScan={onScan}/>}
  </section>;
}
function OnsiteCameraCapture({ onScan }: { onScan: (value: string) => void }) {
  const video = useRef<HTMLVideoElement>(null), stopRef = useRef<() => void>(() => {}), latest = useRef(onScan);
  const [active, setActive] = useState(false), [message, setMessage] = useState(""); latest.current = onScan;
  useEffect(() => {
    if (!active) return;
    let cancelled = false, stream: MediaStream | null = null, timer: ReturnType<typeof setTimeout> | null = null;
    let lifetime: ReturnType<typeof setTimeout> | null = null;
    const element = video.current;
    const stop = () => { cancelled = true; if (timer) clearTimeout(timer); if (lifetime) clearTimeout(lifetime); stream?.getTracks().forEach(track => track.stop());
      if (element) element.srcObject = null; };
    stopRef.current = stop;
    const pause = () => { stop(); setActive(false); setMessage("已停止摄像头。返回后可手动重新开始扫码。"); };
    const hide = () => { if (document.hidden) pause(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", pause);
    lifetime = setTimeout(() => { stop(); setActive(false); setMessage("扫码已暂停，摄像头已停止。需要时请重新打开。"); }, 60000);
    void (async () => {
      try {
        // Recheck after pending activation work before requesting hardware. A
        // page can have become hidden between the button event and this effect.
        await Promise.resolve();
        if (cancelled) return;
        if (document.hidden) { pause(); return; }
        if (!navigator.mediaDevices?.getUserMedia) throw Error("camera_unavailable");
        const obtained = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (cancelled || document.hidden) { obtained.getTracks().forEach(track => track.stop()); if (!cancelled) pause(); return; }
        stream = obtained; if (!element) throw Error("camera_unavailable");
        element.srcObject = stream; await element.play(); if (cancelled) return;
        if (document.hidden) { pause(); return; }
        const { default: jsQR } = await import("jsqr"); if (cancelled) return;
        if (document.hidden) { pause(); return; }
        const canvas = document.createElement("canvas"), context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw Error("camera_unavailable");
        const scan = () => {
          if (cancelled) return;
          if (document.hidden) { pause(); return; }
          try {
            if (element.readyState >= 2 && element.videoWidth > 0 && element.videoHeight > 0) {
              const scale = Math.min(1, 640 / Math.max(element.videoWidth, element.videoHeight));
              canvas.width = Math.max(1, Math.round(element.videoWidth * scale)); canvas.height = Math.max(1, Math.round(element.videoHeight * scale));
              context.drawImage(element, 0, 0, canvas.width, canvas.height);
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height), result = jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
              if (result) { stop(); setActive(false); setMessage("已读取二维码，摄像头已停止。尚未打卡。"); latest.current(result.data); return; }
            }
            timer = setTimeout(scan, 250);
          } catch { stop(); setActive(false); setMessage("摄像头读取失败，可用手机相机扫码或粘贴现场码链接。"); }
        };
        setMessage("将门店屏幕上的现场码放入画面；画面仅在本机识别，不会上传。"); scan();
      } catch { if (!cancelled) { stop(); setActive(false); setMessage("无法使用摄像头或未获授权。可用手机相机扫码，或粘贴刚读取的现场码链接。"); } }
    })();
    return () => { stop(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", pause); };
  }, [active]);
  useEffect(() => () => stopRef.current(), []);
  return <>
    {active && <video ref={video} muted playsInline aria-label="现场码摄像头画面" className="max-h-72 w-full rounded-xl bg-slate-950"/>}
    <button type="button" className="rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:opacity-40"
      onClick={() => { if (active || document.hidden) stopRef.current(); setActive(!active && !document.hidden); setMessage(""); }}>{active ? "停止摄像头" : "打开摄像头扫码"}</button>
    {message && <p className="text-sm leading-6 text-slate-600" aria-live="polite">{message}</p>}
  </>;
}
