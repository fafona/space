"use client";

import type { ReactNode } from "react";
import {
  FAOLLA_DISPLAY_VERSION,
  type FaollaAndroidAppUpdateState,
} from "@/lib/useFaollaAndroidAppUpdate";
import { FAOLLA_LEGAL_DOCUMENTS, getFaollaLegalDocument, type FaollaLegalDocumentKey } from "@/lib/faollaLegalContent";

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

const LEGAL_VIEW_TO_KEY: Record<
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

const LEGAL_KEY_TO_VIEW: Record<FaollaLegalDocumentKey, FaollaMobileSettingsView> = {
  terms: "settings-legal-terms",
  privacy: "settings-legal-privacy",
  cookies: "settings-legal-cookies",
  legalNotice: "settings-legal-notice",
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
  return getFaollaLegalDocument(LEGAL_VIEW_TO_KEY[view]).title;
}

export function getFaollaMobileSettingsSubtitle(view: FaollaMobileSettingsView, notificationSummary: string) {
  if (view === "settings") return "通知、版本和法律";
  if (view === "settings-notifications") return notificationSummary;
  if (view === "settings-about") return `版本 ${FAOLLA_DISPLAY_VERSION}`;
  if (view === "settings-update") return "检查并热更新到最新版本";
  if (view === "settings-legal") return "服务条款、隐私政策、Cookie 使用政策和法律声明";
  return "Faolla 法律文件";
}

function SettingsIcon({ type }: { type: "settings" | "bell" | "info" | "refresh" | "legal" | "doc" }) {
  if (type === "bell") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path
          d="M12 4.5A4.5 4.5 0 0 0 7.5 9v2.1c0 .6-.2 1.2-.6 1.7L5.8 14a1 1 0 0 0 .8 1.6h10.8a1 1 0 0 0 .8-1.6l-1.1-1.2c-.4-.5-.6-1.1-.6-1.7V9A4.5 4.5 0 0 0 12 4.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M10.3 18a1.9 1.9 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "info") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 10.8v5.1M12 7.7h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "refresh") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path d="M20 11a8 8 0 0 0-14.2-5L4 8.2M4 4.5v3.7h3.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 13a8 8 0 0 0 14.2 5L20 15.8m0 3.7v-3.7h-3.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "legal") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path d="M7 20h10M8 4h8M12 4v16M6.2 8.5 4 14h4.4L6.2 8.5Zm11.6 0L15.6 14H20l-2.2-5.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "doc") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
        <path d="M7 4.8h6.6L18 9.2v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5.8a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M13.4 4.8v4.7H18M9 13h6M9 16h4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="m18.4 13.6.2 1.6 1.5 1-1.8 3.1-1.7-.7-1.3 1H8.7l-1.3-1-1.7.7-1.8-3.1 1.5-1 .2-1.6L4.3 12l1.3-1.6-.2-1.6-1.5-1 1.8-3.1 1.7.7 1.3-1h6.6l1.3 1 1.7-.7 1.8 3.1-1.5 1-.2 1.6 1.3 1.6-1.3 1.6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsRow({
  icon,
  label,
  summary,
  trailing,
  showDot = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  summary: string;
  trailing?: ReactNode;
  showDot?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50" onClick={onClick}>
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="truncate">{label}</span>
          {showDot ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-50" aria-label="有更新" /> : null}
        </span>
        <span className="mt-1 block truncate text-xs leading-5 text-slate-500">{summary}</span>
      </span>
      {trailing ? <span className="shrink-0 text-xs font-semibold text-slate-500">{trailing}</span> : null}
      <span className="text-slate-300">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
          <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}

function SettingsList({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
      <div className="divide-y divide-slate-100">{children}</div>
    </section>
  );
}

function UpdateStatus({ appUpdateState }: { appUpdateState: FaollaAndroidAppUpdateState }) {
  const progress = Math.max(0, Math.min(100, appUpdateState.downloadProgress));
  const busy = appUpdateState.downloadStatus === "downloading" || appUpdateState.downloadStatus === "installing";
  const statusText = appUpdateState.checking
    ? "正在检查更新"
    : appUpdateState.error
      ? appUpdateState.error
      : !appUpdateState.updateAvailable
        ? "当前为最新版本"
        : appUpdateState.updateKind === "web"
          ? appUpdateState.downloadStatus === "installing"
            ? "正在热更新"
            : appUpdateState.downloadStatus === "failed"
              ? appUpdateState.downloadMessage || "热更新失败，请重试"
              : "发现新版本"
        : appUpdateState.downloadStatus === "downloaded"
          ? "安装包已下载"
          : appUpdateState.downloadStatus === "installing"
            ? "正在安装必要更新"
            : appUpdateState.downloadStatus === "failed"
              ? appUpdateState.downloadMessage || "下载失败，请重试"
              : `发现原生必要更新 ${appUpdateState.latestVersion}`;
  const buttonLabel = appUpdateState.checking
    ? "检查中"
    : !appUpdateState.supported
      ? "仅 Android App 支持"
      : !appUpdateState.updateAvailable
        ? "当前为最新版本"
        : appUpdateState.downloadStatus === "downloading"
          ? `下载中 ${progress}%`
          : appUpdateState.downloadStatus === "downloaded"
            ? "安装必要更新"
            : appUpdateState.downloadStatus === "installing"
              ? appUpdateState.updateKind === "web"
                ? "热更中"
                : "必要更新安装中"
              : appUpdateState.downloadStatus === "failed"
                ? "重新下载"
                : appUpdateState.updateKind === "web"
                  ? "立即热更"
                  : "下载必要更新";
  const buttonDisabled =
    appUpdateState.checking ||
    !appUpdateState.supported ||
    !appUpdateState.updateAvailable ||
    busy;
  const handleUpdateButtonClick = () => {
    if (buttonDisabled) return;
    if (appUpdateState.downloadStatus === "downloaded") {
      appUpdateState.installUpdate();
      return;
    }
    appUpdateState.downloadUpdate();
  };

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-base font-semibold text-slate-950">{statusText}</div>
          <div className="mt-2 text-xs leading-5 text-slate-500">
            当前版本 {appUpdateState.currentVersion}
            {appUpdateState.currentBuild ? ` (${appUpdateState.currentBuild})` : ""}
            {appUpdateState.updateKind === "android" && appUpdateState.latestBuild
              ? ` · 最新 ${appUpdateState.latestVersion} (${appUpdateState.latestBuild})`
              : ""}
          </div>
        </div>
        {appUpdateState.updateAvailable ? (
          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-50" aria-label="有更新" />
        ) : null}
      </div>

      {appUpdateState.downloadStatus === "downloading" && appUpdateState.updateKind === "android" ? (
        <div className="mt-5 overflow-hidden rounded-2xl bg-slate-100">
          <div className="h-2 bg-emerald-500 transition-[width] duration-200" style={{ width: `${progress}%` }} />
        </div>
      ) : null}

      {appUpdateState.downloadMessage ? (
        <div className="mt-3 text-xs leading-5 text-slate-500">{appUpdateState.downloadMessage}</div>
      ) : null}

      <button
        type="button"
        className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-300"
        disabled={buttonDisabled}
        onClick={handleUpdateButtonClick}
      >
        {buttonLabel}
      </button>

      {!appUpdateState.supported ? (
        <div className="mt-3 text-xs leading-5 text-slate-500">App 内热更仅支持 Android App。</div>
      ) : null}
    </section>
  );
}

export function FaollaMobileSettingsContent({
  view,
  notificationSummary,
  notificationContent,
  appUpdateState,
  onViewChange,
}: {
  view: FaollaMobileSettingsView;
  notificationSummary: string;
  notificationContent: ReactNode;
  appUpdateState: FaollaAndroidAppUpdateState;
  onViewChange: (view: FaollaMobileSettingsView) => void;
}) {
  if (view === "settings") {
    return (
      <div className="space-y-4">
        <SettingsList>
          <SettingsRow
            icon={<SettingsIcon type="bell" />}
            label="通知"
            summary={notificationSummary}
            onClick={() => onViewChange("settings-notifications")}
          />
          <SettingsRow
            icon={<SettingsIcon type="info" />}
            label="关于 Faolla"
            summary={`版本 ${FAOLLA_DISPLAY_VERSION}`}
            trailing={FAOLLA_DISPLAY_VERSION}
            showDot={appUpdateState.updateAvailable}
            onClick={() => onViewChange("settings-about")}
          />
        </SettingsList>
      </div>
    );
  }

  if (view === "settings-notifications") {
    return <>{notificationContent}</>;
  }

  if (view === "settings-about") {
    return (
      <div className="space-y-4">
        <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-7 text-center shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
          <div className="mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-[24px] bg-slate-950 shadow-[0_16px_32px_rgba(15,23,42,0.18)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/faolla-app-icon-192.png" alt="Faolla" className="h-full w-full object-cover" />
          </div>
          <div className="mt-4 text-xl font-semibold text-slate-950">Faolla</div>
          <div className="mt-1 text-sm text-slate-500">版本 {FAOLLA_DISPLAY_VERSION}</div>
        </section>
        <SettingsList>
          <SettingsRow
            icon={<SettingsIcon type="refresh" />}
            label="版本更新"
            summary={appUpdateState.updateAvailable ? "有新版本可热更" : "检查并热更新到最新版本"}
            showDot={appUpdateState.updateAvailable}
            onClick={() => onViewChange("settings-update")}
          />
          <SettingsRow
            icon={<SettingsIcon type="legal" />}
            label="法律"
            summary="服务条款、隐私政策、Cookie 使用政策和法律声明"
            onClick={() => onViewChange("settings-legal")}
          />
        </SettingsList>
      </div>
    );
  }

  if (view === "settings-update") {
    return <UpdateStatus appUpdateState={appUpdateState} />;
  }

  if (view === "settings-legal") {
    return (
      <SettingsList>
        {FAOLLA_LEGAL_DOCUMENTS.map((document) => (
          <SettingsRow
            key={document.key}
            icon={<SettingsIcon type="doc" />}
            label={document.title}
            summary={document.summary}
            onClick={() => onViewChange(LEGAL_KEY_TO_VIEW[document.key])}
          />
        ))}
      </SettingsList>
    );
  }

  const document = getFaollaLegalDocument(LEGAL_VIEW_TO_KEY[view]);
  return (
    <article className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
      <div className="text-lg font-semibold text-slate-950">{document.title}</div>
      <div className="mt-1 text-xs text-slate-500">最后更新：{document.updatedAt}</div>
      <div className="mt-5 space-y-5">
        {document.sections.map((section) => (
          <section key={section.title}>
            <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
            <div className="mt-2 space-y-2 text-sm leading-7 text-slate-600">
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
