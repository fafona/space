"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import MerchantEmployeeShell, {
  type MerchantEmployeeShellContextItem,
  type MerchantEmployeeShellIcon,
  type MerchantEmployeeShellItem,
} from "@/components/enterprise/MerchantEmployeeShell";
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
  resolveMerchantEmployeeWorkspaceRoot,
  type MerchantBusinessCapabilities,
  type MerchantEmployeeWorkspaceRoot,
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
  accountActions?: ReactNode;
  onSignOut?: () => void;
  signOutDisabled?: boolean;
};

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

type AuthorizedSubviewPreference<T extends string> = {
  authorizationKey: string;
  view: T;
};

const REDEMPTION_VIEW_DEFINITIONS = [
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
] as const satisfies ReadonlyArray<{
  id: RedemptionSubview;
  label: string;
  permission: MerchantStaffBusinessPermission;
}>;

const MEMBER_VIEW_DEFINITIONS = [
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
] as const satisfies ReadonlyArray<{
  id: MemberSubview;
  label: string;
  permission: MerchantStaffBusinessPermission;
}>;

const EMPLOYEE_SHELL_ROOT_ORDER = [
  "redemptions",
  "bookings",
  "orders",
  "collaboration",
  "conversations",
  "members",
] as const satisfies readonly MerchantEmployeeWorkspaceRoot[];

const EMPLOYEE_SHELL_ICON_BY_ROOT = {
  redemptions: "points",
  bookings: "booking",
  orders: "orders",
  collaboration: "enterprise",
  conversations: "support",
  members: "members",
} as const satisfies Record<
  MerchantEmployeeWorkspaceRoot,
  MerchantEmployeeShellIcon
>;

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
  activeView,
}: {
  siteId: string;
  siteName: string;
  apiClient: MerchantBusinessApiClient;
  permissions: readonly MerchantStaffBusinessPermission[];
  activeView: RedemptionSubview;
}) {
  const cashierView =
    activeView === "cashier" ||
    activeView === "records" ||
    activeView === "rechargeRecords";

  return cashierView ? (
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
  );
}

function MemberWorkspace({
  siteId,
  siteName,
  apiClient,
  permissions,
  activeView,
}: {
  siteId: string;
  siteName: string;
  apiClient: MerchantBusinessApiClient;
  permissions: readonly MerchantStaffBusinessPermission[];
  activeView: MemberSubview;
}) {
  return activeView === "list" ? (
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
  accountActions,
  onSignOut,
  signOutDisabled,
}: MerchantEmployeeWorkspaceProps) {
  const [rootPreference, setRootPreference] = useState<{
    capabilityMountKey: string;
    root: MerchantEmployeeWorkspaceRoot | null;
  }>({ capabilityMountKey: "", root: null });
  const [redemptionSubviewPreference, setRedemptionSubviewPreference] =
    useState<AuthorizedSubviewPreference<RedemptionSubview>>({
      authorizationKey: "",
      view: "cashier",
    });
  const [memberSubviewPreference, setMemberSubviewPreference] = useState<
    AuthorizedSubviewPreference<MemberSubview>
  >({ authorizationKey: "", view: "list" });
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
          response.status === 403 &&
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
  const subviewAuthorizationKey = `${authorizationEpoch}:${capabilityMountKey}`;
  const preferredRoot =
    rootPreference.capabilityMountKey === capabilityMountKey
      ? rootPreference.root
      : null;
  const activeRoot = capabilities
    ? resolveMerchantEmployeeWorkspaceRoot(
        preferredRoot,
        capabilities.collaborationPermissions,
        capabilities.permissions,
      )
    : capabilityStatus === "disabled"
      ? "collaboration"
      : null;
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
  const collaborationAvailable = capabilities
    ? capabilities.collaborationPermissions.includes("enterprise.view")
    : capabilityStatus === "disabled";
  const capabilityDecisionPending =
    !capabilities && capabilityStatus === "loading";
  const allowedRedemptionViews = capabilities
    ? REDEMPTION_VIEW_DEFINITIONS.filter((view) =>
        hasPermission(capabilities.permissions, view.permission),
      )
    : [];
  const requestedRedemptionSubview =
    redemptionSubviewPreference.authorizationKey === subviewAuthorizationKey
      ? redemptionSubviewPreference.view
      : "cashier";
  const activeRedemptionSubview = allowedRedemptionViews.some(
    (view) => view.id === requestedRedemptionSubview,
  )
    ? requestedRedemptionSubview
    : allowedRedemptionViews[0]?.id;
  const allowedMemberViews = capabilities
    ? MEMBER_VIEW_DEFINITIONS.filter((view) =>
        hasPermission(capabilities.permissions, view.permission),
      )
    : [];
  const requestedMemberSubview =
    memberSubviewPreference.authorizationKey === subviewAuthorizationKey
      ? memberSubviewPreference.view
      : "list";
  const activeMemberSubview = allowedMemberViews.some(
    (view) => view.id === requestedMemberSubview,
  )
    ? requestedMemberSubview
    : allowedMemberViews[0]?.id;
  const shellItems: MerchantEmployeeShellItem[] = [];
  for (const root of EMPLOYEE_SHELL_ROOT_ORDER) {
    if (root === "collaboration") {
      if (collaborationAvailable) {
        shellItems.push({
          id: root,
          label: "企业协作",
          icon: EMPLOYEE_SHELL_ICON_BY_ROOT[root],
        });
      }
      continue;
    }
    const menu = visibleMenus.find((candidate) => candidate.id === root);
    if (menu) {
      shellItems.push({
        id: menu.id,
        label: menu.label,
        icon: EMPLOYEE_SHELL_ICON_BY_ROOT[menu.id],
      });
    }
  }
  const capabilityStatusLabel =
    capabilityStatus === "loading"
      ? "正在核验业务权限…"
      : capabilityStatus === "disabled"
        ? "业务功能尚未启用"
        : capabilityStatus === "unavailable" ||
            capabilityStatus === "authorization_invalid"
          ? "业务权限暂不可用"
          : "员工账号";
  let shellContextLabel = "";
  let shellContextHint = "";
  let shellContextItems: MerchantEmployeeShellContextItem[] = [];
  if (activeRoot === "redemptions") {
    shellContextLabel = "积分兑换子菜单";
    shellContextItems = allowedRedemptionViews
      .filter((view) => view.id !== "cashier")
      .map((view) => ({
        id: view.id,
        label: view.label,
        active: activeRedemptionSubview === view.id,
      }));
  } else if (activeRoot === "bookings") {
    shellContextLabel = "预约管理子菜单";
    shellContextItems = [
      { id: "booking-workbench", label: "预约工作台", active: true },
    ];
  } else if (activeRoot === "orders") {
    shellContextLabel = "订单管理子菜单";
    shellContextItems = [
      { id: "order-workbench", label: "订单工作台", active: true },
    ];
  } else if (activeRoot === "conversations") {
    shellContextHint = "这里集中处理当前角色获准访问的商户会话。";
  } else if (activeRoot === "members") {
    shellContextLabel = "会员管理子菜单";
    shellContextItems = allowedMemberViews
      .filter((view) => view.id !== "list")
      .map((view) => ({
        id: view.id,
        label: view.label,
        active: activeMemberSubview === view.id,
      }));
  }

  let businessContent = null;
  if (
    capabilities &&
    businessApiClient &&
    activeRoot &&
    activeRoot !== "collaboration"
  ) {
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
    } else if (activeRoot === "members" && activeMemberSubview) {
      businessContent = (
        <MemberWorkspace {...common} activeView={activeMemberSubview} />
      );
    } else if (activeRoot === "redemptions" && activeRedemptionSubview) {
      businessContent = (
        <RedemptionWorkspace
          {...common}
          activeView={activeRedemptionSubview}
        />
      );
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

  let workspaceContent: ReactNode;
  if (capabilityDecisionPending) {
    workspaceContent = (
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        <WorkspaceLoading />
      </div>
    );
  } else if (activeRoot === "collaboration" && collaborationAvailable) {
    workspaceContent = (
      <MerchantEnterpriseManager
        key={`${siteId}:${authorizationEpoch}:${capabilityMountKey || capabilityStatus}`}
        siteId={siteId}
        siteName={capabilities?.workspace.siteName}
        accessToken={accessToken}
        standalone
      />
    );
  } else if (businessContent) {
    workspaceContent = (
      <div
        key={`${capabilityMountKey}:${activeRoot}`}
        className="mx-auto max-w-7xl p-4 sm:p-6"
      >
        {businessContent}
      </div>
    );
  } else if (capabilities && capabilityStatus === "ready") {
    workspaceContent = (
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        <div
          role="status"
          className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm"
        >
          当前角色没有可用功能，请联系企业负责人分配权限。
        </div>
      </div>
    );
  } else if (
    capabilityStatus === "unavailable" ||
    capabilityStatus === "authorization_invalid"
  ) {
    workspaceContent = (
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        <div
          role="alert"
          className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 shadow-sm"
        >
          <p>
            {capabilityStatus === "authorization_invalid"
              ? "登录状态或角色权限已变化，请重新核验。"
              : "暂时无法核验当前角色权限，请稍后重试。"}
          </p>
          <button
            type="button"
            className="mt-4 rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-900"
            onClick={() => void refreshCapabilities()}
          >
            重新核验权限
          </button>
        </div>
      </div>
    );
  } else {
    workspaceContent = (
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        <WorkspaceLoading />
      </div>
    );
  }

  return (
    <MerchantEmployeeShell
      siteName={capabilities?.workspace.siteName}
      actorName={capabilities?.actor.displayName}
      items={shellItems}
      activeItemId={activeRoot}
      statusLabel={capabilityStatusLabel}
      canRefresh={
        capabilityStatus === "unavailable" ||
        capabilityStatus === "authorization_invalid"
      }
      onRefresh={() => void refreshCapabilities()}
      onSelect={(root) => {
        if (root === "redemptions") {
          setRedemptionSubviewPreference({
            authorizationKey: subviewAuthorizationKey,
            view: "cashier",
          });
        }
        if (root === "members") {
          setMemberSubviewPreference({
            authorizationKey: subviewAuthorizationKey,
            view: "list",
          });
        }
        setRootPreference({ capabilityMountKey, root });
      }}
      contextLabel={shellContextLabel}
      contextItems={shellContextItems}
      contextHint={shellContextHint}
      onSelectContextItem={(itemId) => {
        if (activeRoot === "redemptions") {
          const selected = allowedRedemptionViews.find(
            (view) => view.id === itemId,
          );
          if (selected) {
            setRedemptionSubviewPreference({
              authorizationKey: subviewAuthorizationKey,
              view: selected.id,
            });
          }
        } else if (activeRoot === "members") {
          const selected = allowedMemberViews.find(
            (view) => view.id === itemId,
          );
          if (selected) {
            setMemberSubviewPreference({
              authorizationKey: subviewAuthorizationKey,
              view: selected.id,
            });
          }
        }
      }}
      onSignOut={onSignOut}
      signOutDisabled={signOutDisabled}
      accountActions={accountActions}
    >
      {workspaceContent}
    </MerchantEmployeeShell>
  );
}
