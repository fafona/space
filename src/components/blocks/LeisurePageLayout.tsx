"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { Block } from "@/data/homeBlocks";
import { getLeisurePresentation } from "@/lib/leisurePresentation";

export default function LeisurePageLayout({ blocks, children, defaultClassName = "contents", editorBoundary = false, style, pageId }: {
  blocks: readonly Block[]; children: ReactNode; defaultClassName?: string; editorBoundary?: boolean; style?: CSSProperties; pageId?: string;
}) {
  const presentation = getLeisurePresentation(blocks);
  const rootRef = useRef<HTMLDivElement>(null);
  const previousPage = useRef(pageId);
  useEffect(() => {
    // Only actual navigation in the opted-in public layout resets its scroll
    // container. Initial deep links, ordinary pages and editor selection do not.
    if (presentation && pageId && previousPage.current && previousPage.current !== pageId) {
      rootRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    }
    previousPage.current = pageId;
  }, [pageId, presentation]);
  const boundary = editorBoundary ? { "data-editor-viewport-boundary": true } : {};
  if (!presentation) return <div {...boundary} className={defaultClassName} style={style}>{children}</div>;
  return <div ref={rootRef} className="faolla-leisure-shell" style={style}>
    <div {...boundary} data-leisure-presentation={presentation} className={`faolla-leisure-site ${presentation}`}>
      {children}
    </div>
  </div>;
}
