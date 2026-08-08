"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";

type BusinessCardMediaExperienceProps = {
  introVideoUrl?: string;
  introPosterUrl?: string;
  introVideoMuted?: boolean;
  introImageUrl?: string;
  introImageDurationSeconds?: number;
  introMusicUrl?: string;
  backgroundMusicUrl?: string;
};

const INTRO_IMAGE_MIN_DURATION_SECONDS = 1;
const INTRO_IMAGE_MAX_DURATION_SECONDS = 15;
const INTRO_IMAGE_DEFAULT_DURATION_SECONDS = 5;

function normalizeIntroImageDuration(value: number | undefined) {
  if (!Number.isFinite(value)) return INTRO_IMAGE_DEFAULT_DURATION_SECONDS;
  return Math.max(
    INTRO_IMAGE_MIN_DURATION_SECONDS,
    Math.min(INTRO_IMAGE_MAX_DURATION_SECONDS, Math.round(value ?? INTRO_IMAGE_DEFAULT_DURATION_SECONDS)),
  );
}

export default function BusinessCardMediaExperience({
  introVideoUrl,
  introPosterUrl,
  introVideoMuted = true,
  introImageUrl,
  introImageDurationSeconds,
  introMusicUrl,
  backgroundMusicUrl,
}: BusinessCardMediaExperienceProps) {
  const normalizedIntroVideoUrl = normalizePublicAssetUrl(String(introVideoUrl ?? "").trim());
  const normalizedIntroPosterUrl = normalizePublicAssetUrl(String(introPosterUrl ?? "").trim());
  const normalizedIntroImageUrl = normalizedIntroVideoUrl
    ? ""
    : normalizePublicAssetUrl(String(introImageUrl ?? "").trim());
  const normalizedIntroMusicUrl = normalizePublicAssetUrl(String(introMusicUrl ?? "").trim());
  const normalizedBackgroundMusicUrl = normalizePublicAssetUrl(String(backgroundMusicUrl ?? "").trim());
  const hasIntro = Boolean(normalizedIntroVideoUrl || normalizedIntroImageUrl);
  const [introVisible, setIntroVisible] = useState(hasIntro);
  const [needsIntroSound, setNeedsIntroSound] = useState(false);
  const [backgroundPlaying, setBackgroundPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const introMusicRef = useRef<HTMLAudioElement>(null);
  const backgroundMusicRef = useRef<HTMLAudioElement>(null);
  const introCompletedRef = useRef(!hasIntro);
  const backgroundUserPausedRef = useRef(false);

  const stopIntroMusic = useCallback(() => {
    const music = introMusicRef.current;
    if (!music) return;
    try {
      music.pause();
      music.currentTime = 0;
    } catch {}
  }, []);

  const finishIntro = useCallback(() => {
    if (introCompletedRef.current) return;
    introCompletedRef.current = true;
    try {
      videoRef.current?.pause();
    } catch {}
    stopIntroMusic();
    setNeedsIntroSound(false);
    setIntroVisible(false);
  }, [stopIntroMusic]);

  const playIntroSound = useCallback(async () => {
    const tasks: Promise<unknown>[] = [];
    const video = videoRef.current;
    const music = introMusicRef.current;
    if (video && !introVideoMuted) {
      video.muted = false;
      video.defaultMuted = false;
      tasks.push(Promise.resolve(video.play()));
    }
    if (music) tasks.push(Promise.resolve(music.play()));
    if (tasks.length === 0) {
      setNeedsIntroSound(false);
      return;
    }
    const results = await Promise.allSettled(tasks);
    setNeedsIntroSound(results.some((result) => result.status === "rejected"));
  }, [introVideoMuted]);

  useEffect(() => {
    if (!introVisible) return;
    let timer = 0;
    const video = videoRef.current;
    const music = introMusicRef.current;

    if (normalizedIntroImageUrl) {
      timer = window.setTimeout(
        finishIntro,
        normalizeIntroImageDuration(introImageDurationSeconds) * 1000,
      );
    }

    if (video) {
      video.muted = introVideoMuted;
      video.defaultMuted = introVideoMuted;
      void video.play().catch(async () => {
        if (!introVideoMuted) {
          video.muted = true;
          video.defaultMuted = true;
          await video.play().catch(() => undefined);
          setNeedsIntroSound(true);
        }
      });
    }

    if (music) {
      void music.play().catch(() => setNeedsIntroSound(true));
    }

    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [finishIntro, introImageDurationSeconds, introVideoMuted, introVisible, normalizedIntroImageUrl]);

  const playBackgroundMusic = useCallback(async () => {
    const music = backgroundMusicRef.current;
    if (!music || !introCompletedRef.current || backgroundUserPausedRef.current || document.hidden) return;
    try {
      await music.play();
      setBackgroundPlaying(true);
    } catch {
      setBackgroundPlaying(false);
    }
  }, []);

  useEffect(() => {
    if (!normalizedBackgroundMusicUrl || introVisible) return;
    introCompletedRef.current = true;
    const timer = window.setTimeout(() => {
      void playBackgroundMusic();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [introVisible, normalizedBackgroundMusicUrl, playBackgroundMusic]);

  useEffect(() => {
    if (!normalizedBackgroundMusicUrl) return;
    const handleVisibilityChange = () => {
      const music = backgroundMusicRef.current;
      if (!music) return;
      if (document.hidden) {
        music.pause();
        setBackgroundPlaying(false);
      } else {
        void playBackgroundMusic();
      }
    };
    const handlePageHide = () => {
      backgroundMusicRef.current?.pause();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [normalizedBackgroundMusicUrl, playBackgroundMusic]);

  const toggleBackgroundMusic = useCallback(() => {
    const music = backgroundMusicRef.current;
    if (!music) return;
    if (!music.paused) {
      backgroundUserPausedRef.current = true;
      music.pause();
      setBackgroundPlaying(false);
      return;
    }
    backgroundUserPausedRef.current = false;
    void playBackgroundMusic();
  }, [playBackgroundMusic]);

  return (
    <>
      {introVisible ? (
        <div className="fixed inset-0 z-[200] bg-black" data-no-translate="1">
          <div className="relative h-screen w-screen overflow-hidden bg-black [height:100dvh]">
            {normalizedIntroVideoUrl ? (
              <video
                ref={videoRef}
                src={normalizedIntroVideoUrl}
                poster={normalizedIntroPosterUrl || undefined}
                autoPlay
                muted={introVideoMuted}
                playsInline
                preload="auto"
                className="absolute inset-0 h-full w-full object-contain"
                onEnded={finishIntro}
                onError={finishIntro}
              />
            ) : normalizedIntroImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={normalizedIntroImageUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-contain"
                onError={finishIntro}
              />
            ) : null}
            {normalizedIntroMusicUrl ? (
              <audio ref={introMusicRef} src={normalizedIntroMusicUrl} preload="auto" />
            ) : null}
            <button
              type="button"
              onClick={finishIntro}
              className="absolute right-[max(14px,calc(env(safe-area-inset-right)+14px))] top-[max(14px,calc(env(safe-area-inset-top)+14px))] rounded-full border border-white/30 bg-slate-900/70 px-4 py-2 text-sm text-white shadow-xl backdrop-blur"
            >
              跳过
            </button>
            {needsIntroSound ? (
              <button
                type="button"
                onClick={() => void playIntroSound()}
                className="absolute bottom-[max(28px,calc(env(safe-area-inset-bottom)+28px))] left-1/2 -translate-x-1/2 rounded-full border border-white/30 bg-slate-900/75 px-5 py-2.5 text-sm text-white shadow-xl backdrop-blur"
              >
                开启声音
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {normalizedBackgroundMusicUrl ? (
        <>
          <audio ref={backgroundMusicRef} src={normalizedBackgroundMusicUrl} preload="metadata" loop />
          <button
            type="button"
            onClick={toggleBackgroundMusic}
            className={`fixed bottom-[max(14px,calc(env(safe-area-inset-bottom)+14px))] right-[max(14px,calc(env(safe-area-inset-right)+14px))] z-40 flex h-11 w-11 items-center justify-center rounded-full border text-[22px] font-bold shadow-xl transition ${
              backgroundPlaying
                ? "border-white/70 bg-slate-900/90 text-white"
                : "border-slate-900/15 bg-white/95 text-slate-900"
            }`}
            title={backgroundPlaying ? "暂停背景音乐" : "播放背景音乐"}
            aria-label={backgroundPlaying ? "暂停背景音乐" : "播放背景音乐"}
          >
            &#9835;
          </button>
        </>
      ) : null}
    </>
  );
}
