"use client";

import dynamic from "next/dynamic";

function DeferredAdminPanelLoading({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">
      {label}
    </div>
  );
}

function DeferredEditorPreviewLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white/70 px-4 text-xs text-slate-500">
      {label}
    </div>
  );
}

export const loadMerchantBusinessCardManager = () =>
  import("@/components/admin/MerchantBusinessCardManager");
export const loadMerchantCustomerManager = () =>
  import("@/components/admin/MerchantCustomerManager");
export const loadMerchantCouponManager = () => import("@/components/admin/MerchantCouponManager");
export const loadMerchantMemberManager = () => import("@/components/admin/MerchantMemberManager");
export const loadMerchantMembershipSettingsPanel = () =>
  import("@/components/admin/MerchantMembershipSettingsPanel");
export const loadMerchantPointRedemptionCashier = () =>
  import("@/components/admin/MerchantPointRedemptionCashier");
export const loadMerchantPrintSettingsPanel = () =>
  import("@/components/admin/MerchantPrintSettingsPanel");
export const loadMerchantBookingManagerDialog = () =>
  import("@/components/admin/MerchantBookingManagerDialog");
export const loadMerchantOrderManagerDialog = () =>
  import("@/components/admin/MerchantOrderManagerDialog");
export const loadMerchantProfileDialog = () => import("@/components/admin/MerchantProfileDialog");
const loadMerchantBookingMobilePanel = () => import("@/components/admin/MerchantBookingMobilePanel");
const loadMerchantOrderMobilePanel = () => import("@/components/admin/MerchantOrderMobilePanel");
const loadChatBusinessCardDialog = () => import("@/components/admin/ChatBusinessCardDialog");
const loadSupportMessageImagePreviewOverlay = () =>
  import("@/components/support/SupportMessageImagePreviewOverlay");
export const loadSupportMessageContent = () => import("@/components/support/SupportMessageContent");
export const loadFaollaQrPanel = () => import("@/components/FaollaQrPanel");
export const loadAccountSwitcherDialog = () => import("@/components/AccountSwitcherDialog");
const loadFaollaMobileSettingsContent = () => import("@/components/FaollaMobileSettingsPages");
const loadEditorColorControls = () => import("@/components/admin/EditorColorControls");
const loadEditorFormControls = () => import("@/components/admin/EditorFormControls");
export const loadEditorAssetProcessing = () => import("@/lib/editorAssetProcessing");
export const loadEditorThemeProcessing = () => import("@/lib/editorThemeProcessing");
const loadInlineEditorBlock = () => import("@/components/admin/InlineEditorBlock");
const loadEditorBlockRenderer = () => import("@/components/blocks/BlockRenderer");
const loadEditorBookingBlock = () => import("@/components/blocks/BookingBlock");
const loadEditorCouponBlock = () => import("@/components/blocks/CouponBlock");
const loadEditorGoogleReviewsBlock = () => import("@/components/blocks/GoogleReviewsBlock");

export function preloadEditorPreviewComponents() {
  void Promise.allSettled([
    loadEditorColorControls(),
    loadEditorFormControls(),
    loadEditorAssetProcessing(),
    loadEditorThemeProcessing(),
    loadInlineEditorBlock(),
    loadEditorBlockRenderer(),
    loadEditorBookingBlock(),
    loadEditorCouponBlock(),
    loadEditorGoogleReviewsBlock(),
  ]);
}

export const MerchantBusinessCardManager = dynamic(loadMerchantBusinessCardManager, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="名片夹加载中..." />,
});

export const MerchantCustomerManager = dynamic(loadMerchantCustomerManager, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="客户管理加载中..." />,
});

export const MerchantCouponManager = dynamic(loadMerchantCouponManager, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="优惠券加载中..." />,
});

export const MerchantMemberManager = dynamic(loadMerchantMemberManager, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="会员管理加载中..." />,
});

export const MerchantMembershipSettingsPanel = dynamic(loadMerchantMembershipSettingsPanel, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="会员配置加载中..." />,
});

export const MerchantRedemptionSettingsPanel = dynamic(loadMerchantMembershipSettingsPanel, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="项目配置加载中..." />,
});

export const MerchantPointRedemptionCashier = dynamic(loadMerchantPointRedemptionCashier, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="积分兑换加载中..." />,
});

export const MerchantPrintSettingsPanel = dynamic(loadMerchantPrintSettingsPanel, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="打印配置加载中..." />,
});

export const MerchantBookingManagerDialog = dynamic(loadMerchantBookingManagerDialog, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="预约管理加载中..." />,
});

export const MerchantOrderManagerDialog = dynamic(loadMerchantOrderManagerDialog, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="订单管理加载中..." />,
});

export const MerchantProfileDialog = dynamic(loadMerchantProfileDialog, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="商户资料加载中..." />,
});

export const MerchantBookingMobilePanel = dynamic(loadMerchantBookingMobilePanel, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="预约列表加载中..." />,
});

export const MerchantOrderMobilePanel = dynamic(loadMerchantOrderMobilePanel, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="订单列表加载中..." />,
});

export const ChatBusinessCardDialog = dynamic(loadChatBusinessCardDialog, {
  ssr: false,
  loading: () => null,
});

export const SupportMessageImagePreviewOverlay = dynamic(loadSupportMessageImagePreviewOverlay, {
  ssr: false,
  loading: () => null,
});

export const SupportMessageContent = dynamic(loadSupportMessageContent, {
  ssr: false,
  loading: () => null,
});

export const FaollaQrPanel = dynamic(loadFaollaQrPanel, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="二维码加载中..." />,
});

export const AccountSwitcherDialog = dynamic(loadAccountSwitcherDialog, {
  ssr: false,
  loading: () => null,
});

export const FaollaMobileSettingsContent = dynamic(
  () => loadFaollaMobileSettingsContent().then((module) => module.FaollaMobileSettingsContent),
  {
    ssr: false,
    loading: () => <DeferredAdminPanelLoading label="设置加载中..." />,
  },
);

export const ColorOrGradientPicker = dynamic(
  () => loadEditorColorControls().then((module) => module.ColorOrGradientPicker),
  {
    ssr: false,
    loading: () => <div className="h-10 w-full animate-pulse rounded border bg-white/70" />,
  },
);

export const RecentColorBar = dynamic(
  () => loadEditorColorControls().then((module) => module.RecentColorBar),
  {
    ssr: false,
    loading: () => <div className="h-8 w-full animate-pulse rounded border border-dashed bg-white/70" />,
  },
);

export const MemoizedInlineEditorBlock = dynamic(loadInlineEditorBlock, {
  ssr: false,
  loading: () => <DeferredEditorPreviewLoading label="区块编辑器加载中..." />,
});

export const BlockRenderer = dynamic(loadEditorBlockRenderer, {
  ssr: false,
  loading: () => <DeferredEditorPreviewLoading label="页面预览加载中..." />,
});
