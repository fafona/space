import type { CSSProperties, ReactNode } from "react";
import type { Block } from "@/data/homeBlocks";
import { getLeisurePresentation } from "@/lib/leisurePresentation";

export default function LeisurePageLayout({ blocks, children, defaultClassName = "contents", editorBoundary = false, style }: {
  blocks: readonly Block[]; children: ReactNode; defaultClassName?: string; editorBoundary?: boolean; style?: CSSProperties;
}) {
  const presentation = getLeisurePresentation(blocks);
  const boundary = editorBoundary ? { "data-editor-viewport-boundary": true } : {};
  if (!presentation) return <div {...boundary} className={defaultClassName} style={style}>{children}</div>;
  return <div className="faolla-leisure-shell" style={style}>
    <div {...boundary} data-leisure-presentation={presentation} className={`faolla-leisure-site ${presentation}`}>
      {children}
    </div>
  </div>;
}
