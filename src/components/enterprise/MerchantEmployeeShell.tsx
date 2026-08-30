"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type { MerchantEmployeeWorkspaceRoot } from "@/lib/merchantBusinessCapabilities";

export type MerchantEmployeeShellIcon =
  | "points"
  | "booking"
  | "orders"
  | "enterprise"
  | "support"
  | "members";

export type MerchantEmployeeShellItem = Readonly<{
  id: MerchantEmployeeWorkspaceRoot;
  label: string;
  icon: MerchantEmployeeShellIcon;
}>;

export type MerchantEmployeeShellContextItem = Readonly<{
  id: string;
  label: string;
  active: boolean;
}>;

type MerchantEmployeeShellProps = {
  siteName?: string;
  actorName?: string;
  items: readonly MerchantEmployeeShellItem[];
  activeItemId: MerchantEmployeeWorkspaceRoot | null;
  statusLabel: string;
  canRefresh: boolean;
  onRefresh: () => void;
  onSelect: (itemId: MerchantEmployeeWorkspaceRoot) => void;
  contextLabel?: string;
  contextItems?: readonly MerchantEmployeeShellContextItem[];
  contextHint?: string;
  onSelectContextItem?: (itemId: string) => void;
  onSignOut?: () => void;
  signOutDisabled?: boolean;
  accountActions?: ReactNode;
  children: ReactNode;
};

const MOBILE_SIDEBAR_MEDIA_QUERY = "(max-width: 1023px)";

function isMobileSidebarViewport() {
  return window.matchMedia(MOBILE_SIDEBAR_MEDIA_QUERY).matches;
}

function getMenuButtonClassName(active: boolean) {
  return active
    ? "relative flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border-0 bg-[#1f2f55] px-3 py-2 text-left text-sm font-semibold leading-tight text-white shadow-[inset_3px_0_0_#93c5fd,0_1px_0_rgba(255,255,255,0.04)]"
    : "relative flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-sm font-semibold leading-tight text-[#dbeafe] transition hover:bg-[#17233f] hover:text-white";
}

function getSubmenuButtonClassName(active: boolean) {
  return active
    ? "flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border-0 bg-[#1f2f55] px-3 py-2 text-left text-sm font-semibold leading-tight text-white shadow-[inset_3px_0_0_#93c5fd,0_1px_0_rgba(255,255,255,0.04)] transition"
    : "flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-sm font-semibold leading-tight text-[#dbeafe] transition hover:bg-[#17233f] hover:text-white";
}

function MerchantEmployeeShellMenuIcon({
  name,
}: {
  name: MerchantEmployeeShellIcon;
}) {
  const commonProps = {
    className: "h-[18px] w-[18px] shrink-0",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  };

  if (name === "points") {
    return (
      <svg {...commonProps}>
        <path d="M12 3 4 7l8 4 8-4-8-4Z" />
        <path d="M4 12l8 4 8-4" />
        <path d="M4 17l8 4 8-4" />
      </svg>
    );
  }
  if (name === "booking") {
    return (
      <svg {...commonProps}>
        <path d="M8 2v4M16 2v4M4 9h16" />
        <path d="M5 5h14a1 1 0 0 1 1 1v16H4V6a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }
  if (name === "orders") {
    return (
      <svg {...commonProps}>
        <path d="M7 3h10l2 3v18l-2-1-2 1-2-1-2 1-2-1-2 1V3Z" />
        <path d="M9 9h6M9 13h6M9 17h4" />
      </svg>
    );
  }
  if (name === "enterprise") {
    return (
      <svg {...commonProps}>
        <path d="M4 21V8l8-4 8 4v13" />
        <path d="M8 21v-5h8v5M8 10h.01M12 10h.01M16 10h.01M8 13h.01M12 13h.01M16 13h.01" />
      </svg>
    );
  }
  if (name === "support") {
    return (
      <svg {...commonProps}>
        <path d="M21 15a4 4 0 0 1-4 4H9l-5 3v-7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4Z" />
        <path d="M8 7a4 4 0 0 1 4-4h1a4 4 0 0 1 4 4" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <path d="M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M14 7h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 8 6 12l4 4M7 12h9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MerchantEmployeeShell({
  siteName,
  actorName,
  items,
  activeItemId,
  statusLabel,
  canRefresh,
  onRefresh,
  onSelect,
  contextLabel,
  contextItems = [],
  contextHint,
  onSelectContextItem,
  onSignOut,
  signOutDisabled = false,
  accountActions,
  children,
}: MerchantEmployeeShellProps) {
  const navigationId = useId();
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const mobileSidebarRef = useRef<HTMLElement>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const focusFirstMobileSidebarControl = useCallback(() => {
    mobileSidebarRef.current?.focus();
  }, []);
  const openMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(true);
    window.setTimeout(focusFirstMobileSidebarControl, 0);
  }, [focusFirstMobileSidebarControl]);
  const closeMobileSidebar = useCallback(() => {
    const shouldRestoreFocus =
      mobileSidebarOpen && isMobileSidebarViewport();
    setMobileSidebarOpen(false);
    if (shouldRestoreFocus) {
      window.setTimeout(() => mobileMenuTriggerRef.current?.focus(), 0);
    }
  }, [mobileSidebarOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        mobileSidebarOpen &&
        isMobileSidebarViewport()
      ) {
        closeMobileSidebar();
      }
      if (event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setDesktopSidebarCollapsed((current) => !current);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeMobileSidebar, mobileSidebarOpen]);

  useEffect(() => {
    const mobileViewport = window.matchMedia(MOBILE_SIDEBAR_MEDIA_QUERY);
    const closeDrawerWhenEnteringDesktop = () => {
      if (!mobileViewport.matches) setMobileSidebarOpen(false);
    };
    mobileViewport.addEventListener("change", closeDrawerWhenEnteringDesktop);
    return () =>
      mobileViewport.removeEventListener(
        "change",
        closeDrawerWhenEnteringDesktop,
      );
  }, []);

  const displaySiteName = siteName?.trim() || "FAOLLA";
  const selectItem = (itemId: MerchantEmployeeWorkspaceRoot) => {
    onSelect(itemId);
    closeMobileSidebar();
  };
  const selectContextItem = (itemId: string) => {
    onSelectContextItem?.(itemId);
    closeMobileSidebar();
  };
  const trapMobileSidebarFocus = (
    event: ReactKeyboardEvent<HTMLElement>,
  ) => {
    if (
      !mobileSidebarOpen ||
      event.key !== "Tab" ||
      !isMobileSidebarViewport()
    ) {
      return;
    }
    const focusableElements = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (document.activeElement === event.currentTarget) {
      event.preventDefault();
      (event.shiftKey ? lastElement : firstElement).focus();
    } else if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  return (
    <section
      data-employee-merchant-shell="1"
      className="relative min-h-screen min-w-0 bg-[#f3f6fb]"
    >
      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="关闭员工工作区导航"
          className="fixed inset-0 z-40 bg-slate-950/55 lg:hidden"
          onClick={closeMobileSidebar}
        />
      ) : null}

      <aside
        ref={mobileSidebarRef}
        data-employee-merchant-sidebar="1"
        aria-label="员工工作区侧栏"
        tabIndex={-1}
        onKeyDown={trapMobileSidebarFocus}
        className={`fixed inset-y-0 left-0 z-50 flex w-[228px] flex-col bg-[#111827] text-white shadow-[10px_0_30px_rgba(15,23,42,0.12)] transition-transform duration-200 ${
          mobileSidebarOpen
            ? "visible translate-x-0"
            : "invisible -translate-x-full"
        } ${
          desktopSidebarCollapsed
            ? "lg:invisible lg:-translate-x-full"
            : "lg:visible lg:translate-x-0"
        }`}
      >
        <header className="min-h-[90px] shrink-0 border-b border-white/10 px-3 pb-[18px] pt-5">
          <div className="flex min-w-0 items-start justify-between gap-3 px-2">
            <div className="min-w-0">
              <div
                className="truncate text-[17px] font-bold leading-tight text-white"
                title={displaySiteName}
              >
                {displaySiteName}
              </div>
              <div className="mt-1 truncate text-[13px] text-[#bfdbfe]">
                FAOLLA
              </div>
            </div>
            {onSignOut ? (
              <button
                type="button"
                className="inline-flex h-9 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-300/35 bg-white/5 text-[#dbeafe] transition hover:bg-[#17233f] hover:text-white disabled:opacity-50"
                onClick={onSignOut}
                disabled={signOutDisabled}
                title="退出登录"
                aria-label="退出员工登录"
              >
                <SignOutIcon />
              </button>
            ) : null}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <nav
            id={navigationId}
            aria-label="员工工作区主导航"
            className="grid gap-[5px] px-3 py-4"
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={getMenuButtonClassName(activeItemId === item.id)}
                aria-current={activeItemId === item.id ? "page" : undefined}
                onClick={() => selectItem(item.id)}
              >
                <span className="inline-flex min-w-0 flex-1 items-center gap-2 text-left">
                  <MerchantEmployeeShellMenuIcon name={item.icon} />
                  <span className="min-w-0 text-left" data-no-translate="1">
                    {item.label}
                  </span>
                </span>
              </button>
            ))}
          </nav>

          {contextItems.length > 0 || contextHint ? (
            <div className="border-t border-blue-200/15 bg-[#16213a] px-2 py-4 shadow-[inset_0_1px_0_rgba(147,197,253,0.08),inset_0_18px_30px_rgba(0,0,0,0.10)]">
              <div className="rounded-xl border border-blue-200/10 bg-[#111c32] px-2 py-2">
                {contextItems.length > 0 ? (
                  <nav
                    aria-label={contextLabel || "当前功能子菜单"}
                    className="grid gap-2"
                  >
                    {contextItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={getSubmenuButtonClassName(item.active)}
                        aria-current={item.active ? "page" : undefined}
                        onClick={() => selectContextItem(item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </nav>
                ) : null}
                {contextHint ? (
                  <div className={`${contextItems.length > 0 ? "mt-2" : ""} px-3 py-2 text-xs leading-5 text-[#8fa39b]`}>
                    {contextHint}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-auto border-t border-white/10 px-3 py-4">
            <div className="rounded-xl border border-white/10 bg-[#0f1b31] px-3 py-3">
              {actorName ? (
                <div className="truncate text-sm font-semibold text-white" title={actorName}>
                  {actorName}
                </div>
              ) : null}
              <div
                className={`${actorName ? "mt-1" : ""} text-xs leading-5 text-slate-300`}
                aria-live="polite"
              >
                {statusLabel}
              </div>
              {canRefresh ? (
                <button
                  type="button"
                  className="mt-3 w-full rounded-lg border border-blue-300/30 bg-white/5 px-3 py-2 text-xs font-semibold text-[#dbeafe] transition hover:bg-[#17233f] hover:text-white"
                  onClick={onRefresh}
                >
                  重新核验权限
                </button>
              ) : null}
            </div>
            {accountActions ? <div className="mt-3">{accountActions}</div> : null}
          </div>
        </div>
      </aside>

      <button
        type="button"
        className={`fixed top-28 z-[60] hidden h-24 w-7 items-center justify-center rounded-r-[16px] border-0 bg-[#111827] text-[#dbeafe] transition-all hover:text-white lg:flex ${
          desktopSidebarCollapsed ? "left-0" : "left-[227px]"
        }`}
        onClick={() => setDesktopSidebarCollapsed((current) => !current)}
        title={`${desktopSidebarCollapsed ? "展开" : "收起"}侧栏 (Alt+S)`}
        aria-label={desktopSidebarCollapsed ? "展开员工工作区侧栏" : "收起员工工作区侧栏"}
        aria-keyshortcuts="Alt+S"
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-7 w-7 transition-transform ${desktopSidebarCollapsed ? "rotate-180" : ""}`}
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M15 6 9 12l6 6"
            stroke="currentColor"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div
        className={`min-h-screen min-w-0 transition-[margin] duration-200 ${
          desktopSidebarCollapsed ? "lg:ml-0" : "lg:ml-[228px]"
        }`}
      >
        <div className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 shadow-sm backdrop-blur lg:hidden">
          <button
            ref={mobileMenuTriggerRef}
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700"
            aria-controls={navigationId}
            aria-expanded={mobileSidebarOpen}
            aria-label="打开员工工作区导航"
            onClick={openMobileSidebar}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-slate-950">{displaySiteName}</div>
            <div className="truncate text-xs text-slate-500">{actorName || statusLabel}</div>
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
