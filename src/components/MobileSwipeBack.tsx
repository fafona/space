"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createMobileSwipeBackEvent,
  isMobileSwipeBackGesture,
  resolveMobileSwipeBackHref,
} from "@/lib/mobileSwipeBack";

type SwipeStart = {
  x: number;
  y: number;
  startedAt: number;
  target: EventTarget | null;
  viewportWidth: number;
  claimed: boolean;
  cancelled: boolean;
};

const INTERACTIVE_SWIPE_START_SELECTOR = [
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='slider']",
  "[role='switch']",
  "[data-mobile-swipe-back-ignore]",
  ".support-mobile-nav-shell",
].join(",");

function isMobileSwipeBackEnabled() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
}

function getTargetElement(target: EventTarget | null) {
  if (!target) return null;
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function isInteractiveSwipeStart(target: EventTarget | null) {
  const element = getTargetElement(target);
  return Boolean(element?.closest(INTERACTIVE_SWIPE_START_SELECTOR));
}

function hasHorizontalScrollAncestor(target: EventTarget | null) {
  const element = getTargetElement(target);
  if (!element || typeof window === "undefined") return false;

  for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    const scrollable = style.overflowX === "auto" || style.overflowX === "scroll";
    if (scrollable && node.scrollWidth > node.clientWidth + 16) return true;
  }
  return false;
}

function getSearchString(searchParams: ReturnType<typeof useSearchParams>) {
  const value = searchParams?.toString() ?? "";
  return value ? `?${value}` : "";
}

function toClientNavigationHref(href: string, origin: string) {
  if (!href) return "";
  if (!/^https?:\/\//i.test(href)) return href;
  try {
    const url = new URL(href);
    if (url.origin !== origin) return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

export default function MobileSwipeBack() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const swipeStartRef = useRef<SwipeStart | null>(null);
  const pathnameRef = useRef(pathname ?? "/");
  const searchRef = useRef(getSearchString(searchParams));
  const handlingSwipeRef = useRef(false);

  useEffect(() => {
    pathnameRef.current = pathname ?? "/";
    searchRef.current = getSearchString(searchParams);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const resetSwipe = () => {
      swipeStartRef.current = null;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (!isMobileSwipeBackEnabled() || event.touches.length !== 1) {
        resetSwipe();
        return;
      }
      if (isInteractiveSwipeStart(event.target) || hasHorizontalScrollAncestor(event.target)) {
        resetSwipe();
        return;
      }

      const touch = event.touches[0];
      if (!touch) return;
      swipeStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        startedAt: Date.now(),
        target: event.target,
        viewportWidth: window.innerWidth || document.documentElement.clientWidth || 0,
        claimed: false,
        cancelled: false,
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const start = swipeStartRef.current;
      if (!start || start.cancelled || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const verticalDrift = Math.abs(deltaY);
      if (deltaX < 0 || verticalDrift > 72 || deltaX <= verticalDrift * 1.35) {
        if (Math.abs(deltaX) > 12 || verticalDrift > 18) {
          start.cancelled = true;
        }
        return;
      }
      if (deltaX < 24) return;

      start.claimed = true;
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const start = swipeStartRef.current;
      resetSwipe();
      if (!start || start.cancelled || event.changedTouches.length !== 1 || handlingSwipeRef.current) return;

      const touch = event.changedTouches[0];
      if (!touch) return;
      if (
        !isMobileSwipeBackGesture({
          startX: start.x,
          startY: start.y,
          endX: touch.clientX,
          endY: touch.clientY,
          viewportWidth: start.viewportWidth,
          elapsedMs: Date.now() - start.startedAt,
        })
      ) {
        return;
      }

      const origin = window.location.origin;
      const currentPathname = pathnameRef.current || "/";
      const currentSearch = searchRef.current;
      const fallbackHref = resolveMobileSwipeBackHref(currentPathname, currentSearch, origin);
      const swipeEvent = createMobileSwipeBackEvent({
        pathname: currentPathname,
        search: currentSearch,
        fallbackHref,
        origin,
        source: "touch",
      });

      window.dispatchEvent(swipeEvent);
      if (swipeEvent.defaultPrevented || !fallbackHref) return;

      handlingSwipeRef.current = true;
      const clientNavigationHref = toClientNavigationHref(fallbackHref, origin);
      if (clientNavigationHref) {
        router.push(clientNavigationHref);
        window.setTimeout(() => {
          handlingSwipeRef.current = false;
        }, 450);
        return;
      }
      window.location.assign(fallbackHref);
    };

    document.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
    document.addEventListener("touchmove", handleTouchMove, { capture: true, passive: false });
    document.addEventListener("touchend", handleTouchEnd, { capture: true, passive: true });
    document.addEventListener("touchcancel", resetSwipe, { capture: true, passive: true });
    return () => {
      document.removeEventListener("touchstart", handleTouchStart, { capture: true });
      document.removeEventListener("touchmove", handleTouchMove, { capture: true });
      document.removeEventListener("touchend", handleTouchEnd, { capture: true });
      document.removeEventListener("touchcancel", resetSwipe, { capture: true });
    };
  }, [router]);

  return null;
}
