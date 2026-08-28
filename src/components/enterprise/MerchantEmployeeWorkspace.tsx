"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY,
  createMerchantBusinessApiClient,
  type MerchantBusinessApiClient,
} from "@/lib/merchantBusinessApiClient";
import {
  MERCHANT_EMPLOYEE_BUSINESS_MENUS,
  buildMerchantBusinessCapabilitiesMountKey,
  getMerchantEmployeeBusinessMenuIds,
  parseMerchantBusinessCapabilitiesPayload,
  type MerchantBusinessCapabilities,
  type MerchantEmployeeBusinessMenuId,
} from "@/lib/merchantBusinessCapabilities";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

const CAPABILITIES_REFRESH_INTERVAL_MS = 30_000;

function WorkspaceLoading() {
  return (
    <div className="grid min-h-48 place-items-center rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
      正在加载工作区…
    </div>
  );
}

const MerchantEnterpriseManager = dynamic(
  () => import("@/components/admin/MerchantEnterpriseManager"),
  { ssr: false, loading: WorkspaceLoading },
);
const MerchantOrderManagerDialog = dynamic(
  () => import("@/components/admin/MerchantOrderManagerDialog"),
  { ssr: false, loading: WorkspaceLoading },
);
const MerchantBookingManagerDialog = dynamic(
  () => import("@/components/admin/MerchantBookingManagerDialog"),
  { ssr: false, loading: WorkspaceLoading },
);
const MerchantMemberManager = dynamic(
  () => import("@/components/admin/MerchantMemberManager"),
  { ssr: false, loading: WorkspaceLoading },
);
const MerchantPointRedemptionCashier = dynamic(
  () => import("@/components/admin/MerchantPointRedemptionCashier"),
  { ssr: false, loading: WorkspaceLoading },
);
const MerchantMembershipSettingsPanel = dynamic(
  () => import("@/components/admin/MerchantMembershipSettingsPanel"),
  { ssr: false, loading: WorkspaceLoading },
);
const MerchantEmployeeConversationPanel = dynamic(
  () => import("@/components/enterprise/MerchantEmployeeConversationPanel"),
  { ssr: false, loading: WorkspaceLoading },
);

type MerchantEmployeeWorkspaceProps = {
  siteId: string;
  accessToken: string;
};

type WorkspaceRoot = "collaboration" | MerchantEmployeeBusinessMenuId;
type CapabilityStatus =
  | "loading"
  | "ready"
  | "disabled"
  | "unavailable"
  | "authorization_invalid";

type CapabilityState = {
  data: MerchantBusinessCapabilities | null;
  status: CapabilityStatus;
  epoch: number;
};

type RedemptionSubview =
  | "cashier"
  | "records"
  | "rechargeRecords"
  | "rechargePlans"
  | "redemptionCategories"
  | "redemptionItems";

type MemberSubview = "list" | "levels" | "pointsRules";

function hasPermission(
  permissions: readonly MerchantStaffBusinessPermission[],
  permission: MerchantStaffBusinessPermission,
) {
  return permissions.includes(permission);
}

function RedemptionWorkspace({
  siteId,
  siteName,
  apiClient,
  permissions,
}: {
  siteId: string;
  siteName: string;
  apiClient: MerchantBusinessApiClient;
  permissions: readonly MerchantStaffBusinessPermission[];
}) {
  const views = useMemo(
    () =>
      [
        { id: "cashier", label: "兑换收银", permission: "redemptions.view" },
        { id: "records", label: "兑换记录", permission: "redemptions.view" },
        {
          id: "rechargeRecords",
          label: "充值记录",
          permission: "redemptions.view",
        },
        {
          id: "rechargePlans",
          label: "充值方案",
          permission: "redemptions.catalog.manage",
        },
        {
          id: "redemptionCategories",
          label: "项目分类",
          permission: "redemptions.catalog.manage",
        },
        {
          id: "redemptionItems",
          label: "兑换项目",
          permission: "redemptions.catalog.manage",
        },
      ].filter((item) =>
        hasPermission(
          permissions,
          item.permission as MerchantStaffBusinessPermission,
        ),
      ) as Array<{
        id: RedemptionSubview;
        label: string;
        permission: MerchantStaffBusinessPermission;
      }>,
    [permissions],
  );
  const [view, setView] = useState<RedemptionSubview>("cashier");
  const activeView = views.some((item) => item.id === view)
    ? view
    : views[0]?.id;

  if (!activeView) return null;
  const cashierView =
    activeView === "cashier" ||
    activeView === "records" ||
    activeView === "rechargeRecords";

  return (
    <div className="space-y-4">
      <nav
        aria-label="积分兑换功能"
        className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
      >
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeView === item.id
                ? "bg-slate-950 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
            aria-current={activeView === item.id ? "page" : undefined}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {cashierView ? (
        <MerchantPointRedemptionCashier
          siteId={siteId}
          siteName={siteName}
          view={activeView}
          apiClient={apiClient}
          cachePolicy={MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY}
          permissions={permissions}
        />
      ) : (
        <MerchantMembershipSettingsPanel
          siteId={siteId}
          view={activeView}
          apiClient={apiClient}
          cachePolicy={MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY}
          permissions={permissions}
        />
      )}
    </div>
  );
}

function MemberWorkspace({
  siteId,
  siteName,
  apiClient,
  permissions,
}: {
  siteId: string;
  siteName: string;
  apiClient: MerchantBusinessApiClient;
  permissions: readonly MerchantStaffBusinessPermission[];
}) {
  const views = useMemo(
    () =>
      [
        { id: "list", label: "会员列表", permission: "members.view" },
        {
          id: "levels",
          label: "等级与权益",
          permission: "members.settings.manage",
        },
        {
          id: "pointsRules",
          label: "积分规则",
          permission: "members.settings.manage",
        },
      ].filter((item) =>
        hasPermission(
          permissions,
          item.permission as MerchantStaffBusinessPermission,
        ),
      ) as Array<{
        id: MemberSubview;
        label: string;
        permission: MerchantStaffBusinessPermission;
      }>,
    [permissions],
  );
  const [view, setView] = useState<MemberSubview>("list");
  const activeView = views.some((item) => item.id === view)
    ? view
    : views[0]?.id;

  if (!activeView) return null;
  return (
    <div className="space-y-4">
      <nav
        aria-label="会员管理功能"
        className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
      >
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeView === item.id
                ? "bg-slate-950 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
            aria-current={activeView === item.id ? "page" : undefined}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {activeView === "list" ? (
        <MerchantMemberManager
          siteId={siteId}
          siteName={siteName}
          apiClient={apiClient}
          cachePolicy={MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY}
          permissions={permissions}
        />
      ) : (
        <MerchantMembershipSettingsPanel
          siteId={siteId}
          view={activeView}
          apiClient={apiClient}
          cachePolicy={MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY}
          permissions={permissions}
        />
      )}
    </div>
  );
}

function readErrorCode(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const error = (value as { error?: unknown }).error;
  return typeof error === "string" ? error.trim().slice(0, 160) : "";
}

export default function MerchantEmployeeWorkspace({
  siteId,
  accessToken,
}: MerchantEmployeeWorkspaceProps) {
  const [activeRoot, setActiveRoot] = useState<WorkspaceRoot>("collaboration");
  const [capabilityState, setCapabilityState] = useState<CapabilityState>({
    data: null,
    status: "loading",
    epoch: 0,
  });
  const capabilities = capabilityState.data;
  const capabilityStatus = capabilityState.status;
  const authorizationEpoch = capabilityState.epoch;
  const capabilityRequestGenerationRef = useRef(0);
  const capabilityAbortRef = useRef<AbortController | null>(null);

  const capabilityApiClient = useMemo(
    () =>
      createMerchantBusinessApiClient({
        authMode: "employee",
        accessToken,
      }),
    [accessToken],
  );

  const closeBusinessWorkspace = useCallback(
    (status: CapabilityStatus, expectedEpoch?: number) => {
      setCapabilityState((current) => {
        if (expectedEpoch !== undefined && current.epoch !== expectedEpoch) {
          return current;
        }
        return {
          data: null,
          status,
          epoch: current.data ? current.epoch + 1 : current.epoch,
        };
      });
      setActiveRoot("collaboration");
    },
    [],
  );

  const invalidateBusinessAuthorization = useCallback(
    (expectedEpoch: number) => {
      closeBusinessWorkspace("authorization_invalid", expectedEpoch);
    },
    [closeBusinessWorkspace],
  );

  const refreshCapabilities = useCallback(async () => {
    const expectedEpoch = authorizationEpoch;
    const generation = capabilityRequestGenerationRef.current + 1;
    capabilityRequestGenerationRef.current = generation;
    capabilityAbortRef.current?.abort();
    const controller = new AbortController();
    capabilityAbortRef.current = controller;
    await Promise.resolve();
    if (controller.signal.aborted) return;
    setCapabilityState((current) =>
      current.epoch === expectedEpoch && current.status !== "ready"
        ? { ...current, status: "loading" }
        : current,
    );

    try {
      const params = new URLSearchParams({ siteId });
      const response = await capabilityApiClient(
        `/api/merchant-business/capabilities?${params.toString()}`,
        { signal: controller.signal },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (
        controller.signal.aborted ||
        generation !== capabilityRequestGenerationRef.current
      ) {
        return;
      }
      if (!response.ok) {
        const errorCode = readErrorCode(payload);
        closeBusinessWorkspace(
          errorCode === "staff_business_access_disabled"
            ? "disabled"
            : response.status === 401 || response.status === 403
              ? "authorization_invalid"
              : "unavailable",
          expectedEpoch,
        );
        return;
      }
      const parsed = parseMerchantBusinessCapabilitiesPayload(payload);
      if (!parsed || parsed.workspace.siteId !== siteId) {
        closeBusinessWorkspace("unavailable", expectedEpoch);
        return;
      }
      const nextMountKey = buildMerchantBusinessCapabilitiesMountKey(parsed);
      setCapabilityState((current) => {
        if (current.epoch !== expectedEpoch) return current;
        const currentMountKey = current.data
          ? buildMerchantBusinessCapabilitiesMountKey(current.data)
          : "";
        return {
          data: parsed,
          status: "ready",
          epoch:
            currentMountKey && currentMountKey !== nextMountKey
              ? current.epoch + 1
              : current.epoch,
        };
      });
      const menuIds = new Set(
        getMerchantEmployeeBusinessMenuIds(parsed.permissions),
      );
      setActiveRoot((current) =>
        current === "collaboration" || menuIds.has(current)
          ? current
          : "collaboration",
      );
    } catch {
      if (
        controller.signal.aborted ||
        generation !== capabilityRequestGenerationRef.current
      ) {
        return;
      }
      closeBusinessWorkspace("unavailable", expectedEpoch);
    }
  }, [
    authorizationEpoch,
    capabilityApiClient,
    closeBusinessWorkspace,
    siteId,
  ]);

  useEffect(() => {
    const initialRefreshId = window.setTimeout(() => {
      void refreshCapabilities();
    }, 0);

    const refreshWhenFocused = () => {
      if (document.visibilityState !== "hidden") void refreshCapabilities();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshCapabilities();
    };
    window.addEventListener("focus", refreshWhenFocused);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshCapabilities();
    }, CAPABILITIES_REFRESH_INTERVAL_MS);

    return () => {
      capabilityRequestGenerationRef.current += 1;
      capabilityAbortRef.current?.abort();
      window.clearTimeout(initialRefreshId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenFocused);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshCapabilities]);

  const capabilityMountKey = capabilities
    ? buildMerchantBusinessCapabilitiesMountKey(capabilities)
    : "";
  const businessApiClient = useMemo<MerchantBusinessApiClient | null>(() => {
    if (!capabilityMountKey) return null;
    const client = createMerchantBusinessApiClient({
      authMode: "employee",
      accessToken,
    });
    return async (path, init) => {
      const response = await client(path, init);
      if (response.status === 401 || response.status === 403) {
        invalidateBusinessAuthorization(authorizationEpoch);
      }
      return response;
    };
  }, [
    accessToken,
    authorizationEpoch,
    capabilityMountKey,
    invalidateBusinessAuthorization,
  ]);

  const visibleMenuIds = useMemo(
    () =>
      new Set(
        capabilities
          ? getMerchantEmployeeBusinessMenuIds(capabilities.permissions)
          : [],
      ),
    [capabilities],
  );
  const visibleMenus = MERCHANT_EMPLOYEE_BUSINESS_MENUS.filter((menu) =>
    visibleMenuIds.has(menu.id),
  );

  let businessContent = null;
  if (capabilities && businessApiClient && activeRoot !== "collaboration") {
    const common = {
      siteId,
      siteName: capabilities.workspace.siteName,
      apiClient: businessApiClient,
      permissions: capabilities.permissions,
    };
    if (activeRoot === "orders") {
      businessContent = (
        <MerchantOrderManagerDialog
          open
          mode="inline"
          showCloseButton={false}
          {...common}
          cachePolicy={MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY}
          onClose={() => undefined}
        />
      );
    } else if (activeRoot === "bookings") {
      const booking = capabilities.workspace.booking;
      businessContent = booking ? (
        <MerchantBookingManagerDialog
          open
          mode="inline"
          showCloseButton={false}
          {...common}
          siteCountryCode={capabilities.workspace.siteCountryCode}
          storeOptions={[...booking.storeOptions]}
          itemOptions={[...booking.itemOptions]}
          titleOptions={[...booking.titleOptions]}
          bookingRulesSnapshot={booking.bookingRulesSnapshot}
          allowBookingEmailPrefill={booking.allowBookingEmailPrefill}
          allowCustomerAutoEmail={booking.allowCustomerAutoEmail}
          cachePolicy={MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY}
          onClose={() => undefined}
        />
      ) : null;
    } else if (activeRoot === "members") {
      businessContent = <MemberWorkspace {...common} />;
    } else if (activeRoot === "redemptions") {
      businessContent = <RedemptionWorkspace {...common} />;
    } else if (activeRoot === "conversations") {
      businessContent = (
        <MerchantEmployeeConversationPanel
          siteId={siteId}
          apiClient={businessApiClient}
          permissions={capabilities.permissions}
          onAuthorizationInvalid={() =>
            invalidateBusinessAuthorization(authorizationEpoch)
          }
        />
      );
    }
  }

  return (
    <section className="min-w-0">
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
          <button
            type="button"
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeRoot === "collaboration"
                ? "bg-slate-950 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
            aria-current={activeRoot === "collaboration" ? "page" : undefined}
            onClick={() => setActiveRoot("collaboration")}
          >
            企业协作
          </button>
          {visibleMenus.map((menu) => (
            <button
              key={menu.id}
              type="button"
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                activeRoot === menu.id
                  ? "bg-slate-950 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
              aria-current={activeRoot === menu.id ? "page" : undefined}
              onClick={() => setActiveRoot(menu.id)}
            >
              {menu.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-slate-500" aria-live="polite">
            {capabilityStatus === "loading"
              ? "正在核验业务权限…"
              : capabilityStatus === "disabled"
                ? "业务功能尚未启用"
                : capabilityStatus === "unavailable" ||
                    capabilityStatus === "authorization_invalid"
                  ? "业务权限暂不可用"
                  : capabilities?.actor.displayName ?? ""}
          </span>
          {(capabilityStatus === "unavailable" ||
            capabilityStatus === "authorization_invalid") && (
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
              onClick={() => void refreshCapabilities()}
            >
              重新核验
            </button>
          )}
        </div>
      </div>

      {activeRoot === "collaboration" ? (
        <MerchantEnterpriseManager
          key={`${siteId}:${authorizationEpoch}:${capabilityMountKey || capabilityStatus}`}
          siteId={siteId}
          siteName={capabilities?.workspace.siteName}
          accessToken={accessToken}
          standalone
        />
      ) : businessContent ? (
        <div
          key={`${capabilityMountKey}:${activeRoot}`}
          className="mx-auto max-w-7xl p-4 sm:p-6"
        >
          {businessContent}
        </div>
      ) : (
        <div className="mx-auto max-w-7xl p-4 sm:p-6">
          <WorkspaceLoading />
        </div>
      )}
    </section>
  );
}
