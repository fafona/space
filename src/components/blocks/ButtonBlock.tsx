import type { BackgroundEditableProps } from "@/data/homeBlocks";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { toRichHtml } from "./richText";

type ButtonTextBox = {
  id: string;
  html: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotateDeg?: number;
};

type ButtonBlockProps = BackgroundEditableProps & {
  commonTextBoxes?: ButtonTextBox[];
  commonItems?: string[];
  heading?: string;
  text?: string;
  buttonJumpTarget?: string;
  onNavigatePage?: (pageId: string) => void;
};

function normalizeButtonTextBoxes(props: ButtonBlockProps): ButtonTextBox[] {
  const fromBoxes = Array.isArray(props.commonTextBoxes) ? props.commonTextBoxes : [];
  if (fromBoxes.length > 0) {
    return fromBoxes
      .filter((item) => item && typeof item.id === "string")
      .map((item) => ({
        id: item.id,
        html: item.html ?? "",
        x: Number.isFinite(item.x) ? Math.round(item.x) : 0,
        y: Number.isFinite(item.y) ? Math.round(item.y) : 0,
        width: Number.isFinite(item.width) ? Math.max(18, Math.round(item.width)) : 140,
        height: Number.isFinite(item.height) ? Math.max(18, Math.round(item.height)) : 40,
        rotateDeg: Number.isFinite(item.rotateDeg) ? Number(item.rotateDeg) : 0,
      }));
  }

  const itemsFromArray = Array.isArray(props.commonItems) ? props.commonItems.map((item) => item.trim()).filter(Boolean) : [];
  const fallbackItems =
    itemsFromArray.length > 0
      ? itemsFromArray
      : [props.heading, props.text].map((item) => (item ?? "").trim()).filter(Boolean);
  return fallbackItems.map((item, idx) => ({
    id: `legacy-${idx}`,
    html: item,
    x: 8,
    y: idx * 44 + 8,
    width: 140,
    height: 36,
    rotateDeg: 0,
  }));
}

function performJump(target: string, onNavigatePage?: (pageId: string) => void) {
  const trimmed = target.trim();
  if (!trimmed || typeof window === "undefined") return;

  const pageMatch = trimmed.match(/^page:(.+)$/i);
  if (pageMatch) {
    const pageId = pageMatch[1]?.trim();
    if (pageId && onNavigatePage) {
      onNavigatePage(pageId);
      return;
    }
  }

  const anchorId = trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed;
  if (anchorId) {
    const targetElement =
      document.getElementById(anchorId) ??
      document.querySelector<HTMLElement>(`[data-block-id="${anchorId}"]`) ??
      document.querySelector<HTMLElement>(`[data-jump-target="${anchorId}"]`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
      if (trimmed.startsWith("#")) {
        window.history.replaceState(null, "", `#${anchorId}`);
      }
      return;
    }
  }

  window.location.assign(trimmed);
}

export default function ButtonBlock(props: ButtonBlockProps) {
  const cardStyle = getBackgroundStyle({
    imageUrl: props.bgImageUrl,
    fillMode: props.bgFillMode,
    position: props.bgPosition,
    color: props.bgColor,
    opacity: props.bgOpacity,
    imageOpacity: props.bgImageOpacity,
    colorOpacity: props.bgColorOpacity,
  });
  const blockWidth =
    typeof props.blockWidth === "number" && Number.isFinite(props.blockWidth)
      ? Math.max(18, Math.round(props.blockWidth))
      : undefined;
  const blockHeight =
    typeof props.blockHeight === "number" && Number.isFinite(props.blockHeight)
      ? Math.max(18, Math.round(props.blockHeight))
      : undefined;
  const viewportHeight = blockHeight ? Math.max(18, Math.round(blockHeight)) : 56;
  const sizeStyle = {
    width: blockWidth ? `${blockWidth}px` : undefined,
    height: blockHeight ? `${blockHeight}px` : undefined,
  };
  const offsetX =
    typeof props.blockOffsetX === "number" && Number.isFinite(props.blockOffsetX)
      ? Math.round(props.blockOffsetX)
      : 0;
  const offsetY =
    typeof props.blockOffsetY === "number" && Number.isFinite(props.blockOffsetY)
      ? Math.round(props.blockOffsetY)
      : 0;
  const blockLayer =
    typeof props.blockLayer === "number" && Number.isFinite(props.blockLayer)
      ? Math.max(1, Math.round(props.blockLayer))
      : 1;
  const offsetStyle = {
    position: "relative" as const,
    transform: offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : undefined,
    zIndex: blockLayer,
  };
  const borderClass = getBlockBorderClass(props.blockBorderStyle);
  const borderInlineStyle = getBlockBorderInlineStyle(props.blockBorderStyle, props.blockBorderColor);
  const boxes = normalizeButtonTextBoxes(props);
  const jumpTarget = (props.buttonJumpTarget ?? "").trim();
  const isClickable = jumpTarget.length > 0;

  return (
    <section className="max-w-6xl mx-auto px-6 py-6" style={offsetStyle}>
      <div
        className={`bg-white rounded-xl shadow-sm overflow-hidden ${borderClass} ${isClickable ? "cursor-pointer" : ""}`}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
        onClick={() => performJump(jumpTarget, props.onNavigatePage)}
        role={isClickable ? "button" : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onKeyDown={(event) => {
          if (!isClickable) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            performJump(jumpTarget, props.onNavigatePage);
          }
        }}
      >
        <div className="relative overflow-hidden" style={{ height: `${viewportHeight}px`, minHeight: `${viewportHeight}px` }}>
          {boxes.map((box) => (
            <div
              key={box.id}
              className="absolute border border-transparent"
              style={{
                left: `${box.x}px`,
                top: `${box.y}px`,
                width: `${box.width}px`,
                height: `${box.height}px`,
                transform: `rotate(${box.rotateDeg ?? 0}deg)`,
                transformOrigin: "center center",
              }}
            >
              <div
                className="w-full h-full whitespace-pre-wrap break-words overflow-hidden text-gray-700"
                dangerouslySetInnerHTML={{ __html: toRichHtml(box.html, "") }}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
