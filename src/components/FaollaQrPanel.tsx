"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import QRCode from "qrcode";

type FaollaQrPanelProps = {
  profileName: string;
  profileSubtitle: string;
  avatarUrl?: string;
  avatarFallback?: string;
  qrUrl: string;
  note: string;
  onBack: () => void;
  onScanResult: (value: string) => void;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getAvatarFallback(value: string) {
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 2).toUpperCase() : "FA";
}

export default function FaollaQrPanel({
  profileName,
  profileSubtitle,
  avatarUrl,
  avatarFallback,
  qrUrl,
  note,
  onBack,
  onScanResult,
}: FaollaQrPanelProps) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerMessage, setScannerMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl("");
    if (!qrUrl) return;
    void QRCode.toDataURL(qrUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 720,
      color: {
        dark: "#020617",
        light: "#ffffff",
      },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setShareMessage("二维码生成失败，请稍后重试");
      });
    return () => {
      cancelled = true;
    };
  }, [qrUrl]);

  const stopScanner = useCallback(() => {
    if (scanFrameRef.current !== null) {
      window.cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (!scannerActive) return;
    let cancelled = false;

    const scan = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        scanFrameRef.current = window.requestAnimationFrame(scan);
        return;
      }

      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width <= 0 || height <= 0) {
        scanFrameRef.current = window.requestAnimationFrame(scan);
        return;
      }

      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        scanFrameRef.current = window.requestAnimationFrame(scan);
        return;
      }
      context.drawImage(video, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const code = jsQR(imageData.data, width, height);
      const value = trimText(code?.data);
      if (value) {
        cancelled = true;
        stopScanner();
        setScannerActive(false);
        setScannerMessage("");
        onScanResult(value);
        return;
      }
      scanFrameRef.current = window.requestAnimationFrame(scan);
    };

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("camera_unavailable");
        }
        setScannerMessage("正在打开摄像头...");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play();
        setScannerMessage("将二维码放入取景框");
        scan();
      } catch {
        if (!cancelled) {
          stopScanner();
          setScannerActive(false);
          setScannerMessage("无法打开摄像头，请检查浏览器权限");
        }
      }
    })();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [onScanResult, scannerActive, stopScanner]);

  async function shareQr() {
    setShareMessage("");
    try {
      if (navigator.share) {
        await navigator.share({
          title: profileName || "Faolla 二维码",
          text: profileSubtitle || "Faolla 二维码",
          url: qrUrl,
        });
        return;
      }
      await navigator.clipboard?.writeText(qrUrl);
      setShareMessage("链接已复制");
    } catch {
      setShareMessage("分享失败，请稍后重试");
    }
  }

  const fallback = avatarFallback || getAvatarFallback(profileName);

  return (
    <div className="min-h-full bg-slate-50 px-4 pb-[calc(var(--faolla-mobile-safe-bottom)+8.75rem)] pt-[calc(var(--faolla-mobile-safe-top)+0.9rem)] text-slate-950">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-950 shadow-[0_12px_26px_rgba(15,23,42,0.08)]"
          onClick={onBack}
          aria-label="返回"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
            <path d="M19 12H7M12 7l-5 5 5 5" stroke="currentColor" strokeWidth="2.3" strokeLinecap="square" strokeLinejoin="miter" />
          </svg>
        </button>
        <div className="text-lg font-semibold">二维码</div>
        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-950 shadow-[0_12px_26px_rgba(15,23,42,0.08)] disabled:opacity-45"
          onClick={() => {
            void shareQr();
          }}
          disabled={!qrUrl}
          aria-label="分享二维码"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
            <path d="M12 16V4m0 0 4 4m-4-4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 14v3.5A2.5 2.5 0 0 0 7.5 20h9A2.5 2.5 0 0 0 19 17.5V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="mx-auto mt-24 max-w-[360px]">
        <section className="relative rounded-[34px] bg-white px-6 pb-8 pt-16 text-center shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <div className="absolute left-1/2 top-0 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border-4 border-slate-50 bg-slate-900 text-lg font-semibold text-white">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={profileName} className="h-full w-full rounded-full object-cover" />
            ) : (
              fallback
            )}
          </div>
          <div className="truncate text-2xl font-semibold">{profileName || "Faolla"}</div>
          <div className="mt-1 truncate text-sm text-slate-500">{profileSubtitle}</div>
          <div className="mt-8 flex aspect-square w-full items-center justify-center rounded-[24px] bg-white p-2">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="Faolla 二维码" className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-[22px] bg-slate-50 text-sm text-slate-400">
                {qrUrl ? "正在生成二维码..." : "二维码暂不可用"}
              </div>
            )}
          </div>
        </section>
        <p className="mx-auto mt-6 max-w-[330px] text-center text-sm leading-7 text-slate-500">{note}</p>
        {shareMessage || scannerMessage ? (
          <div className="mt-3 text-center text-xs font-medium text-emerald-700">{shareMessage || scannerMessage}</div>
        ) : null}
      </div>

      <div className="fixed inset-x-4 bottom-[calc(var(--faolla-mobile-safe-bottom)+1rem)] z-30 mx-auto max-w-[360px] space-y-3">
        <button
          type="button"
          className="h-14 w-full rounded-full bg-emerald-600 text-base font-semibold text-white shadow-[0_16px_36px_rgba(16,185,129,0.24)] active:scale-[0.99]"
          onClick={() => setScannerActive(true)}
        >
          扫描
        </button>
        <button
          type="button"
          className="h-11 w-full rounded-full text-sm font-semibold text-emerald-700"
          onClick={() => {
            setQrDataUrl("");
            void QRCode.toDataURL(qrUrl, { errorCorrectionLevel: "M", margin: 1, width: 720 }).then(setQrDataUrl);
          }}
          disabled={!qrUrl}
        >
          重置二维码
        </button>
      </div>

      {scannerActive ? (
        <div className="fixed inset-0 z-[2147483600] flex flex-col bg-slate-950 text-white">
          <div className="flex items-center justify-between px-5 pt-[calc(var(--faolla-mobile-safe-top)+1rem)]">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10"
              onClick={() => setScannerActive(false)}
              aria-label="关闭扫描"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
            <div className="text-sm font-medium text-white/80">{scannerMessage || "扫描二维码"}</div>
            <div className="h-11 w-11" />
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-6">
            <video ref={videoRef} className="h-full max-h-[70vh] w-full rounded-[28px] object-cover" muted playsInline />
            <canvas ref={canvasRef} className="hidden" />
            <div className="pointer-events-none absolute inset-x-12 top-1/2 aspect-square -translate-y-1/2 rounded-[30px] border-2 border-white/80 shadow-[0_0_0_999px_rgba(2,6,23,0.38)]" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
