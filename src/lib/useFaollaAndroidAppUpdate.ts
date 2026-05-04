"use client";

import { useEffect, useState } from "react";

export const FAOLLA_DISPLAY_VERSION = "1.0";
export const FAOLLA_ANDROID_BUILD = 2;
export const FAOLLA_ANDROID_MANIFEST_URL = "/downloads/faolla-android-version.json";
export const FAOLLA_ANDROID_APK_URL = "/downloads/faolla-android.apk";

export type FaollaAndroidAppUpdateState = {
  checking: boolean;
  supported: boolean;
  platform: string;
  updateAvailable: boolean;
  currentVersion: string;
  currentBuild: number;
  latestVersion: string;
  latestBuild: number;
  apkUrl: string;
  error: string;
};

const DEFAULT_STATE: FaollaAndroidAppUpdateState = {
  checking: true,
  supported: false,
  platform: "web",
  updateAvailable: false,
  currentVersion: FAOLLA_DISPLAY_VERSION,
  currentBuild: 0,
  latestVersion: FAOLLA_DISPLAY_VERSION,
  latestBuild: FAOLLA_ANDROID_BUILD,
  apkUrl: FAOLLA_ANDROID_APK_URL,
  error: "",
};

function readInteger(value: unknown, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function resolveManifestApkUrl(rawValue: unknown) {
  const rawUrl = readString(rawValue, FAOLLA_ANDROID_APK_URL);
  if (typeof window === "undefined") return rawUrl;
  try {
    return new URL(rawUrl, window.location.origin).toString();
  } catch {
    return FAOLLA_ANDROID_APK_URL;
  }
}

export function openFaollaAndroidUpdate(apkUrl: string) {
  if (typeof window === "undefined") return;
  const targetUrl = resolveManifestApkUrl(apkUrl);
  window.location.assign(targetUrl);
}

export function useFaollaAndroidAppUpdate(): FaollaAndroidAppUpdateState {
  const [state, setState] = useState<FaollaAndroidAppUpdateState>(DEFAULT_STATE);

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      let platform = "web";
      let supported = false;
      let currentVersion = FAOLLA_DISPLAY_VERSION;
      let currentBuild = 0;

      try {
        const [{ Capacitor }, { App }] = await Promise.all([import("@capacitor/core"), import("@capacitor/app")]);
        if (Capacitor.isNativePlatform()) {
          platform = Capacitor.getPlatform();
          if (platform === "android") {
            supported = true;
            const info = await App.getInfo();
            currentVersion = readString(info.version, FAOLLA_DISPLAY_VERSION);
            currentBuild = readInteger(info.build, 0);
          }
        }
      } catch {
        platform = "web";
      }

      try {
        const manifestUrl = `${FAOLLA_ANDROID_MANIFEST_URL}?t=${Date.now()}`;
        const response = await fetch(manifestUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const manifest = (await response.json()) as Record<string, unknown>;
        const latestVersion = readString(manifest.version, FAOLLA_DISPLAY_VERSION);
        const latestBuild = readInteger(manifest.build, FAOLLA_ANDROID_BUILD);
        const apkUrl = resolveManifestApkUrl(manifest.apkUrl);
        if (!cancelled) {
          setState({
            checking: false,
            supported,
            platform,
            updateAvailable: supported && latestBuild > currentBuild,
            currentVersion,
            currentBuild,
            latestVersion,
            latestBuild,
            apkUrl,
            error: "",
          });
        }
      } catch {
        if (!cancelled) {
          setState({
            ...DEFAULT_STATE,
            checking: false,
            supported,
            platform,
            currentVersion,
            currentBuild,
            error: "暂时无法检查更新。",
          });
        }
      }
    };

    void sync();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
