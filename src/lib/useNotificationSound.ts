"use client";

import { useCallback, useEffect, useRef } from "react";

const NOTIFICATION_FREQUENCIES = [880, 1174.66];
const NOTE_DURATION_SECONDS = 0.09;
const NOTE_GAP_SECONDS = 0.05;
const NOTIFICATION_VOLUME = 0.045;
const MIN_PLAY_GAP_MS = 1200;

type BrowserWindowWithWebkitAudio = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

function getAudioContextConstructor() {
  if (typeof window === "undefined") return null;
  const browserWindow = window as BrowserWindowWithWebkitAudio;
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext ?? null;
}

export function useNotificationSound() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastPlayAtRef = useRef(0);

  const ensureAudioContext = useCallback(() => {
    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) return null;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor();
    }
    return audioContextRef.current;
  }, []);

  const unlockAudioContext = useCallback(() => {
    const audioContext = ensureAudioContext();
    if (!audioContext) return;
    void audioContext.resume().catch(() => {
      // Ignore unlock failures; we'll retry on the next user interaction or play attempt.
    });
  }, [ensureAudioContext]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.addEventListener("pointerdown", unlockAudioContext, { passive: true });
    window.addEventListener("keydown", unlockAudioContext);
    return () => {
      window.removeEventListener("pointerdown", unlockAudioContext);
      window.removeEventListener("keydown", unlockAudioContext);
      const audioContext = audioContextRef.current;
      audioContextRef.current = null;
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close().catch(() => {
          // Ignore cleanup failures.
        });
      }
    };
  }, [unlockAudioContext]);

  return useCallback(async () => {
    const nowMs = Date.now();
    if (nowMs - lastPlayAtRef.current < MIN_PLAY_GAP_MS) {
      return false;
    }

    const audioContext = ensureAudioContext();
    if (!audioContext) return false;

    try {
      if (audioContext.state !== "running") {
        await audioContext.resume();
      }
    } catch {
      return false;
    }

    if (audioContext.state !== "running") {
      return false;
    }

    const startAt = audioContext.currentTime + 0.01;
    NOTIFICATION_FREQUENCIES.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      const noteStartAt = startAt + index * NOTE_GAP_SECONDS;
      const noteEndAt = noteStartAt + NOTE_DURATION_SECONDS;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, noteStartAt);

      gainNode.gain.setValueAtTime(0.0001, noteStartAt);
      gainNode.gain.exponentialRampToValueAtTime(NOTIFICATION_VOLUME, noteStartAt + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, noteEndAt);

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start(noteStartAt);
      oscillator.stop(noteEndAt + 0.02);
    });

    lastPlayAtRef.current = nowMs;
    return true;
  }, [ensureAudioContext]);
}
