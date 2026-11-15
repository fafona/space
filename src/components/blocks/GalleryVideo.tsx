"use client";
import { useEffect, useRef, useState } from "react";

export default function GalleryVideo({ url, mobileUrl, poster, position, background }: {
  url: string; mobileUrl: string; poster: string; position: string; background: boolean;
}) {
  const element = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false), [pageVisible, setPageVisible] = useState(false);
  const [allowed, setAllowed] = useState(false), [activated, setActivated] = useState(false);
  const [state, setState] = useState("poster");
  const [failedSource, setFailedSource] = useState("");
  const [mobile, setMobile] = useState(false);
  const selectedUrl = mobile && mobileUrl ? mobileUrl : url;
  useEffect(() => {
    const video = element.current;
    if (!video) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: background ? "0px" : "160px" });
    observer.observe(video);
    const motion = matchMedia("(prefers-reduced-motion: reduce)"), data = matchMedia("(prefers-reduced-data: reduce)"), viewport = matchMedia("(max-width: 767px)");
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    const preferences = () => setAllowed(!background || !(motion.matches || data.matches || connection?.saveData));
    const framing = () => setMobile(viewport.matches);
    const visibility = () => setPageVisible(document.visibilityState === "visible");
    preferences(); visibility(); framing(); motion.addEventListener("change", preferences); data.addEventListener("change", preferences); viewport.addEventListener("change", framing);
    connection?.addEventListener("change", preferences); document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); motion.removeEventListener("change", preferences); data.removeEventListener("change", preferences); viewport.removeEventListener("change", framing);
      connection?.removeEventListener("change", preferences); document.removeEventListener("visibilitychange", visibility); video.pause(); };
  }, [background]);
  useEffect(() => {
    if (!visible || !allowed || !pageVisible || activated) return;
    const timer = setTimeout(() => setActivated(true), background ? 250 : 0);
    return () => clearTimeout(timer);
  }, [visible, allowed, pageVisible, activated, background]);
  const source = activated && allowed && failedSource !== selectedUrl ? selectedUrl : undefined;
  useEffect(() => {
    const video = element.current;
    if (!video) return;
    let cancelled = false;
    if (!source || !visible || !pageVisible) { video.pause(); return; }
    if (background) {
      video.muted = true;
      void video.play().catch(() => { if (!cancelled) setState("blocked"); });
    }
    return () => { cancelled = true; video.pause(); };
  }, [source, visible, pageVisible, background]);
  return <video ref={element} data-gallery-video={background ? "background" : "player"} data-video-state={state}
    src={source} poster={poster || undefined} muted={background} loop={background} playsInline preload="none"
    controls={!background} disablePictureInPicture={background} disableRemotePlayback={background}
    aria-hidden={background || undefined} tabIndex={background ? -1 : undefined}
    className={background ? "absolute inset-0 h-full w-full pointer-events-none" : "h-full w-full bg-slate-950"}
    style={{ objectFit: background ? "cover" : "contain", objectPosition: position, ...(background ? { opacity: state === "playing" ? 1 : 0 } : {}) }}
    onPlaying={() => setState("playing")} onPause={() => setState(current => current === "error" || current === "blocked" ? current : "paused")}
    onError={() => { setFailedSource(selectedUrl); setState("error"); }} />;
}
