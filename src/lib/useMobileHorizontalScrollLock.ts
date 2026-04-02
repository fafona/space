import { useEffect } from "react";

export function useMobileHorizontalScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked || typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflowX = html.style.overflowX;
    const prevBodyOverflowX = body.style.overflowX;
    const prevHtmlOverscrollBehaviorX = html.style.overscrollBehaviorX;
    const prevBodyOverscrollBehaviorX = body.style.overscrollBehaviorX;

    html.style.overflowX = "hidden";
    body.style.overflowX = "hidden";
    html.style.overscrollBehaviorX = "none";
    body.style.overscrollBehaviorX = "none";

    return () => {
      html.style.overflowX = prevHtmlOverflowX;
      body.style.overflowX = prevBodyOverflowX;
      html.style.overscrollBehaviorX = prevHtmlOverscrollBehaviorX;
      body.style.overscrollBehaviorX = prevBodyOverscrollBehaviorX;
    };
  }, [locked]);
}
