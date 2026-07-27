import { FAOLLA_DISPLAY_VERSION } from "@/lib/useFaollaAndroidAppUpdate";
import type { FaollaLegalDocumentKey } from "@/lib/faollaLegalContent";

export type FaollaMobileSettingsView =
  | "settings"
  | "settings-notifications"
  | "settings-about"
  | "settings-update"
  | "settings-legal"
  | "settings-legal-terms"
  | "settings-legal-privacy"
  | "settings-legal-cookies"
  | "settings-legal-notice";

const FAOLLA_SETTINGS_VIEWS = new Set<string>([
  "settings",
  "settings-notifications",
  "settings-about",
  "settings-update",
  "settings-legal",
  "settings-legal-terms",
  "settings-legal-privacy",
  "settings-legal-cookies",
  "settings-legal-notice",
]);

export const FAOLLA_MOBILE_LEGAL_VIEW_TO_KEY: Record<
  Extract<
    FaollaMobileSettingsView,
    "settings-legal-terms" | "settings-legal-privacy" | "settings-legal-cookies" | "settings-legal-notice"
  >,
  FaollaLegalDocumentKey
> = {
  "settings-legal-terms": "terms",
  "settings-legal-privacy": "privacy",
  "settings-legal-cookies": "cookies",
  "settings-legal-notice": "legalNotice",
};

export const FAOLLA_MOBILE_LEGAL_KEY_TO_VIEW: Record<FaollaLegalDocumentKey, FaollaMobileSettingsView> = {
  terms: "settings-legal-terms",
  privacy: "settings-legal-privacy",
  cookies: "settings-legal-cookies",
  legalNotice: "settings-legal-notice",
};

const FAOLLA_MOBILE_LEGAL_TITLES: Record<FaollaLegalDocumentKey, string> = {
  terms: "服务条款",
  privacy: "隐私政策",
  cookies: "Cookie 使用政策",
  legalNotice: "法律声明",
};

export function isFaollaMobileSettingsView(value: string | null | undefined): value is FaollaMobileSettingsView {
  return FAOLLA_SETTINGS_VIEWS.has(String(value ?? ""));
}

export function getFaollaMobileSettingsBackView(view: FaollaMobileSettingsView): FaollaMobileSettingsView | "home" {
  if (view === "settings") return "home";
  if (view === "settings-notifications" || view === "settings-about") return "settings";
  if (view === "settings-update" || view === "settings-legal") return "settings-about";
  return "settings-legal";
}

export function getFaollaMobileSettingsTitle(view: FaollaMobileSettingsView) {
  if (view === "settings") return "设置";
  if (view === "settings-notifications") return "通知";
  if (view === "settings-about") return "关于 Faolla";
  if (view === "settings-update") return "版本更新";
  if (view === "settings-legal") return "法律";
  return FAOLLA_MOBILE_LEGAL_TITLES[FAOLLA_MOBILE_LEGAL_VIEW_TO_KEY[view]];
}

export function getFaollaMobileSettingsSubtitle(view: FaollaMobileSettingsView, notificationSummary: string) {
  if (view === "settings") return "通知、版本和法律";
  if (view === "settings-notifications") return notificationSummary;
  if (view === "settings-about") return `版本 ${FAOLLA_DISPLAY_VERSION}`;
  if (view === "settings-update") return "检查并热更新到最新版本";
  if (view === "settings-legal") return "服务条款、隐私政策、Cookie 使用政策和法律声明";
  return "Faolla 法律文件";
}
