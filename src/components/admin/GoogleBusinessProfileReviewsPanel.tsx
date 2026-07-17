"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GoogleReviewsProps } from "@/data/homeBlocks";
import {
  buildGoogleBusinessProfileLocationKey,
  type GoogleBusinessProfileClientStatus,
} from "@/lib/googleBusinessProfile";

type GoogleBusinessProfileRequest = (path: string, init: RequestInit) => Promise<Response>;

type Props = {
  siteId: string;
  request?: GoogleBusinessProfileRequest;
  currentSyncedAt?: string;
  currentLocationName?: string;
  autoSync: boolean;
  onApply: (patch: Partial<GoogleReviewsProps>) => void;
};

type ApiPayload = {
  ok?: boolean;
  authorizationUrl?: string;
  status?: GoogleBusinessProfileClientStatus;
  message?: string;
  error?: string;
};

function formatDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function readPayload(response: Response) {
  return (await response.json().catch(() => null)) as ApiPayload | null;
}

export default function GoogleBusinessProfileReviewsPanel({
  siteId,
  request,
  currentSyncedAt = "",
  currentLocationName = "",
  autoSync,
  onApply,
}: Props) {
  const [status, setStatus] = useState<GoogleBusinessProfileClientStatus | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [locationKey, setLocationKey] = useState("");
  const onApplyRef = useRef(onApply);

  useEffect(() => {
    onApplyRef.current = onApply;
  }, [onApply]);

  const applyStatus = useCallback((nextStatus: GoogleBusinessProfileClientStatus) => {
    setStatus(nextStatus);
    const selected = nextStatus.selectedLocation;
    const nextLocationKey = selected
      ? buildGoogleBusinessProfileLocationKey(selected.accountName, selected.name)
      : "";
    setLocationKey(nextLocationKey);
    const snapshot = nextStatus.snapshot;
    if (!snapshot || !selected) return;
    if (snapshot.syncedAt === currentSyncedAt && selected.name === currentLocationName) return;
    onApplyRef.current({
      googleReviewItems: snapshot.reviews,
      googleReviewAverageRating: snapshot.averageRating,
      googleReviewTotalCount: snapshot.totalReviewCount,
      googleReviewSyncedAt: snapshot.syncedAt,
      googleReviewUrl: selected.mapsUri || undefined,
      googleReviewWriteUrl: selected.newReviewUri || undefined,
      googleReviewSourceLabel: "Google",
      googleReviewAutoSync: autoSync || !currentLocationName,
      googleReviewAccountName: selected.accountName,
      googleReviewLocationName: selected.name,
      googleReviewLocationTitle: selected.title,
    });
  }, [autoSync, currentLocationName, currentSyncedAt]);

  const send = useCallback(async (path: string, init: RequestInit) => {
    if (!request) throw new Error("编辑器登录请求通道不可用，请刷新后重试。");
    const response = await request(path, init);
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(payload?.message || "Google 商家资料请求失败。");
    return payload ?? {};
  }, [request]);

  const loadStatus = useCallback(async () => {
    if (!siteId || !request) return;
    setBusyAction("status");
    setError("");
    try {
      const payload = await send(`/api/google-business-profile?siteId=${encodeURIComponent(siteId)}`, {
        method: "GET",
      });
      if (payload.status) {
        applyStatus(payload.status);
        if (payload.status.connected && payload.status.locations.length === 0) {
          setBusyAction("refresh-locations");
          const discoveryPayload = await send("/api/google-business-profile", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ siteId, action: "refresh-locations" }),
          });
          if (discoveryPayload.status) applyStatus(discoveryPayload.status);
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取 Google 商家资料状态失败。");
    } finally {
      setBusyAction("");
    }
  }, [applyStatus, request, send, siteId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; siteId?: unknown; ok?: unknown; message?: unknown } | null;
      if (data?.type !== "faolla:google-business-profile-connected" || data.siteId !== siteId) return;
      if (data.ok !== true) {
        setError(typeof data.message === "string" ? data.message : "Google 商家资料连接失败。");
        return;
      }
      void loadStatus();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [loadStatus, siteId]);

  const selectedLocation = useMemo(
    () => status?.locations.find(
      (location) => buildGoogleBusinessProfileLocationKey(location.accountName, location.name) === locationKey,
    ) ?? null,
    [locationKey, status?.locations],
  );

  const connect = async () => {
    if (!siteId) {
      setError("当前商户 ID 不可用，请刷新编辑器后重试。");
      return;
    }
    const popup = window.open("about:blank", "faolla-google-business-profile", "popup,width=620,height=760");
    setBusyAction("connect");
    setError("");
    try {
      const payload = await send("/api/google-business-profile/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId }),
      });
      const authorizationUrl = payload.authorizationUrl?.trim() ?? "";
      if (!authorizationUrl) throw new Error("未能生成 Google 授权地址。");
      if (popup) {
        popup.location.replace(authorizationUrl);
        popup.focus();
      } else {
        window.location.assign(authorizationUrl);
      }
    } catch (connectError) {
      popup?.close();
      setError(connectError instanceof Error ? connectError.message : "连接 Google 商家资料失败。");
    } finally {
      setBusyAction("");
    }
  };

  const runAction = async (
    action: "refresh-locations" | "select-location" | "sync" | "disconnect",
    extra: Record<string, string> = {},
  ) => {
    setBusyAction(action);
    setError("");
    try {
      const payload = await send("/api/google-business-profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId, action, ...extra }),
      });
      if (payload.status) applyStatus(payload.status);
      if (action === "disconnect") {
        onApply({
          googleReviewAutoSync: false,
          googleReviewAccountName: "",
          googleReviewLocationName: "",
          googleReviewLocationTitle: "",
        });
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Google 商家资料操作失败。");
    } finally {
      setBusyAction("");
    }
  };

  const selectLocation = async (nextKey: string) => {
    setLocationKey(nextKey);
    const location = status?.locations.find(
      (item) => buildGoogleBusinessProfileLocationKey(item.accountName, item.name) === nextKey,
    );
    if (!location) return;
    await runAction("select-location", { accountName: location.accountName, locationName: location.name });
  };

  const disabled = Boolean(busyAction);
  const connected = status?.connected === true;

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Google Business Profile</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            授权后从 Google 官方接口读取已验证地点的真实评论，并保存最近一次成功同步的快照。
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
          {connected ? "已连接" : "未连接"}
        </span>
      </div>

      {status && !status.configured ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          服务端尚未配置 Google OAuth。需要配置客户端 ID、客户端密钥和令牌加密密钥后才能授权。
        </div>
      ) : null}
      {error || status?.lastError ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
          {error || status?.lastError}
        </div>
      ) : null}

      {!connected ? (
        <button
          type="button"
          className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || status?.configured === false || !siteId}
          onClick={() => void connect()}
        >
          {busyAction === "connect" ? "正在打开 Google 授权..." : "连接 Google 商家资料"}
        </button>
      ) : (
        <div className="mt-4 grid gap-3">
          <label className="space-y-1 text-sm">
            <span className="block text-slate-600">评论来源地点</span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              value={locationKey}
              disabled={disabled || status.locations.length === 0}
              onChange={(event) => void selectLocation(event.target.value)}
            >
              <option value="">请选择 Google 商家地点</option>
              {status.locations.map((location) => {
                const key = buildGoogleBusinessProfileLocationKey(location.accountName, location.name);
                return (
                  <option key={key} value={key}>
                    {location.title}{location.address ? ` - ${location.address}` : ""}
                  </option>
                );
              })}
            </select>
          </label>
          {selectedLocation ? (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
              <div className="font-semibold text-slate-800">{selectedLocation.title}</div>
              {selectedLocation.address ? <div>{selectedLocation.address}</div> : null}
              {status.snapshot ? (
                <div className="mt-1">
                  已同步 {status.snapshot.totalReviewCount} 条评分记录，最近更新 {formatDateTime(status.snapshot.syncedAt)}
                </div>
              ) : null}
            </div>
          ) : null}
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(event) => onApply({ googleReviewAutoSync: event.target.checked })}
            />
            网页访问时自动刷新过期评论
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={disabled}
              onClick={() => void runAction("refresh-locations")}
            >
              {busyAction === "refresh-locations" ? "正在读取地点..." : "刷新地点"}
            </button>
            <button
              type="button"
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={disabled || !status.selectedLocationName}
              onClick={() => void runAction("sync")}
            >
              {busyAction === "sync" || busyAction === "select-location" ? "正在同步评论..." : "立即同步"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              disabled={disabled}
              onClick={() => {
                if (window.confirm("确定断开 Google 商家资料？已保存的评论快照会继续保留。")) {
                  void runAction("disconnect");
                }
              }}
            >
              断开连接
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
