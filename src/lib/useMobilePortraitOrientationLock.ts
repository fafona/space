import { useEffect } from "react";

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

const MOBILE_PORTRAIT_LOCK_QUERY = "(max-width: 767px), (pointer: coarse) and (max-width: 1024px)";

function matchesMobilePortraitLockViewport() {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return window.innerWidth < 768;
  return window.matchMedia(MOBILE_PORTRAIT_LOCK_QUERY).matches;
}

function getLockableOrientation() {
  if (typeof window === "undefined") return null;
  return window.screen.orientation as LockableScreenOrientation | undefined;
}

function requestPortraitLock() {
  const orientation = getLockableOrientation();
  const lock = orientation?.lock?.bind(orientation);
  if (!lock) return;
  void lock("portrait-primary").catch(() => {
    void lock("portrait").catch(() => undefined);
  });
}

export function useMobilePortraitOrientationLock(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const syncPortraitLock = () => {
      if (!matchesMobilePortraitLockViewport()) return;
      requestPortraitLock();
    };

    syncPortraitLock();
    const mediaQuery = typeof window.matchMedia === "function" ? window.matchMedia(MOBILE_PORTRAIT_LOCK_QUERY) : null;
    const legacyMediaQuery = mediaQuery as
      | (MediaQueryList & {
          addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
          removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
        })
      | null;

    mediaQuery?.addEventListener?.("change", syncPortraitLock);
    legacyMediaQuery?.addListener?.(syncPortraitLock);
    window.addEventListener("resize", syncPortraitLock);
    window.addEventListener("orientationchange", syncPortraitLock);
    document.addEventListener("visibilitychange", syncPortraitLock);

    return () => {
      mediaQuery?.removeEventListener?.("change", syncPortraitLock);
      legacyMediaQuery?.removeListener?.(syncPortraitLock);
      window.removeEventListener("resize", syncPortraitLock);
      window.removeEventListener("orientationchange", syncPortraitLock);
      document.removeEventListener("visibilitychange", syncPortraitLock);
      getLockableOrientation()?.unlock?.();
    };
  }, [enabled]);
}
