"use client";

import { useCallback, useEffect, useState } from "react";

export const FAOLLA_DISPLAY_VERSION = "1.0";
export const FAOLLA_ANDROID_BUILD = 9;
export const FAOLLA_ANDROID_MANIFEST_URL = "/downloads/faolla-android-version.json";
export const FAOLLA_ANDROID_APK_URL = "/downloads/faolla-android.apk";

export type FaollaAndroidUpdateDownloadStatus =
  | "idle"
  | "downloading"
  | "downloaded"
  | "installing"
  | "failed";

type FaollaNativeUpdateBridge = {
  downloadUpdate?: (url: string) => void;
  installDownloadedUpdate?: () => void;
  downloadAndInstall?: (url: string) => void;
};

type FaollaNativeUpdateWindow = Window &
  typeof globalThis & {
    FaollaNativeUpdates?: FaollaNativeUpdateBridge;
  };

type NativeUpdateEventDetail = {
  status?: unknown;
  progress?: unknown;
  message?: unknown;
};

type FaollaAndroidAppUpdateData = {
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
  downloadStatus: FaollaAndroidUpdateDownloadStatus;
  downloadProgress: number;
  downloadMessage: string;
  stagedInstallSupported: boolean;
};

export type FaollaAndroidAppUpdateState = FaollaAndroidAppUpdateData & {
  downloadUpdate: () => void;
  installUpdate: () => void;
  resetDownloadState: () => void;
};

const DEFAULT_STATE: FaollaAndroidAppUpdateData = {
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
  downloadStatus: "idle",
  downloadProgress: 0,
  downloadMessage: "",
  stagedInstallSupported: false,
};

function readInteger(value: unknown, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampProgress(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
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

function readNativeBridge() {
  if (typeof window === "undefined") return undefined;
  return (window as FaollaNativeUpdateWindow).FaollaNativeUpdates;
}

function hasStagedInstallBridge(nativeBridge: FaollaNativeUpdateBridge | undefined) {
  return (
    typeof nativeBridge?.downloadUpdate === "function" &&
    typeof nativeBridge.installDownloadedUpdate === "function"
  );
}

export function openFaollaAndroidUpdate(apkUrl: string) {
  if (typeof window === "undefined") return;
  const targetUrl = resolveManifestApkUrl(apkUrl);
  const nativeBridge = readNativeBridge();
  if (typeof nativeBridge?.downloadUpdate === "function") {
    nativeBridge.downloadUpdate(targetUrl);
    return;
  }
  if (typeof nativeBridge?.downloadAndInstall === "function") {
    nativeBridge.downloadAndInstall(targetUrl);
    return;
  }
  window.location.assign(targetUrl);
}

export function useFaollaAndroidAppUpdate(): FaollaAndroidAppUpdateState {
  const [state, setState] = useState<FaollaAndroidAppUpdateData>(DEFAULT_STATE);

  useEffect(() => {
    const handleNativeUpdateEvent = (event: Event) => {
      const detail = (event as CustomEvent<NativeUpdateEventDetail>).detail ?? {};
      const status = readString(detail.status);
      const progress = clampProgress(detail.progress);
      const message = readString(detail.message);

      if (status === "download-started" || status === "downloading") {
        setState((current) => ({
          ...current,
          downloadStatus: "downloading",
          downloadProgress: status === "download-started" ? 0 : progress,
          downloadMessage: message,
        }));
        return;
      }

      if (status === "downloaded") {
        setState((current) => ({
          ...current,
          downloadStatus: "downloaded",
          downloadProgress: 100,
          downloadMessage: message,
        }));
        return;
      }

      if (status === "installing") {
        setState((current) => ({
          ...current,
          downloadStatus: "installing",
          downloadProgress: 100,
          downloadMessage: message,
        }));
        return;
      }

      if (status === "failed") {
        setState((current) => ({
          ...current,
          downloadStatus: "failed",
          downloadProgress: 0,
          downloadMessage: message || "下载失败，请重试。",
        }));
      }
    };

    window.addEventListener("faolla-native-update", handleNativeUpdateEvent);
    return () => {
      window.removeEventListener("faolla-native-update", handleNativeUpdateEvent);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      let platform = "web";
      let supported = false;
      let currentVersion = FAOLLA_DISPLAY_VERSION;
      let currentBuild = 0;
      const nativeBridge = readNativeBridge();
      const stagedInstallSupported = hasStagedInstallBridge(nativeBridge);

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
        const hasComparableBuild = currentBuild > 0 && latestBuild > 0;
        const updateAvailable = supported
          ? hasComparableBuild
            ? latestBuild > currentBuild
            : latestVersion !== currentVersion
          : false;
        if (!cancelled) {
          setState((current) => ({
            ...current,
            checking: false,
            supported,
            platform,
            updateAvailable,
            currentVersion,
            currentBuild,
            latestVersion,
            latestBuild,
            apkUrl,
            error: "",
            downloadStatus: updateAvailable ? current.downloadStatus : "idle",
            downloadProgress: updateAvailable ? current.downloadProgress : 0,
            downloadMessage: updateAvailable ? current.downloadMessage : "",
            stagedInstallSupported,
          }));
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
            stagedInstallSupported,
          });
        }
      }
    };

    void sync();

    return () => {
      cancelled = true;
    };
  }, []);

  const downloadUpdate = useCallback(() => {
    if (!state.updateAvailable || state.downloadStatus === "downloading" || state.downloadStatus === "installing") {
      return;
    }
    const targetUrl = resolveManifestApkUrl(state.apkUrl);
    const nativeBridge = readNativeBridge();
    if (typeof nativeBridge?.downloadUpdate === "function") {
      setState((current) => ({
        ...current,
        downloadStatus: "downloading",
        downloadProgress: 0,
        downloadMessage: "",
        stagedInstallSupported: true,
      }));
      nativeBridge.downloadUpdate(targetUrl);
      return;
    }
    if (typeof nativeBridge?.downloadAndInstall === "function") {
      setState((current) => ({
        ...current,
        downloadStatus: "installing",
        downloadProgress: 100,
        downloadMessage: "当前 App 需要先完成这次更新，之后将支持进度和手动安装。",
      }));
      nativeBridge.downloadAndInstall(targetUrl);
      return;
    }
    window.location.assign(targetUrl);
  }, [state.apkUrl, state.downloadStatus, state.updateAvailable]);

  const installUpdate = useCallback(() => {
    if (state.downloadStatus !== "downloaded") return;
    const nativeBridge = readNativeBridge();
    if (typeof nativeBridge?.installDownloadedUpdate !== "function") {
      return;
    }
    setState((current) => ({
      ...current,
      downloadStatus: "installing",
      downloadProgress: 100,
      downloadMessage: "",
    }));
    nativeBridge.installDownloadedUpdate();
  }, [state.downloadStatus]);

  const resetDownloadState = useCallback(() => {
    setState((current) => ({
      ...current,
      downloadStatus: "idle",
      downloadProgress: 0,
      downloadMessage: "",
    }));
  }, []);

  return {
    ...state,
    downloadUpdate,
    installUpdate,
    resetDownloadState,
  };
}
