import type { ButtonProps } from "@/data/homeBlocks";
import {
  resolveButtonContentPadding,
  resolveButtonJumpPageId,
  resolveButtonLabel,
  type ButtonJumpPage,
} from "@/lib/buttonBlock";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { toRichHtml } from "./richText";
import { getTypographyStyle } from "./typographyStyle";

type ButtonBlockRuntimeProps = ButtonProps & {
  onNavigatePage?: (pageId: string) => void;
  availablePages?: ButtonJumpPage[];
};

function performJump(
  target: string,
  onNavigatePage?: (pageId: string) => void,
  availablePages: ButtonJumpPage[] = [],
) {
  const trimmed = target.trim();
  if (!trimmed || typeof window === "undefined") return;

  const pageId = resolveButtonJumpPageId(trimmed, availablePages);
  if (pageId && onNavigatePage) {
    onNavigatePage(pageId);
    return;
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

export default function ButtonBlock(props: ButtonBlockRuntimeProps) {
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
  const sizeStyle = {
    width: blockWidth ? `${blockWidth}px` : undefined,
    height: blockHeight ? `${blockHeight}px` : undefined,
    minHeight: blockHeight ? undefined : "44px",
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
  const typographyStyle = getTypographyStyle(props);
  const jumpTarget = (props.buttonJumpTarget ?? "").trim();
  const isClickable = jumpTarget.length > 0;
  const labelHtml = toRichHtml(resolveButtonLabel(props), "按钮");

  return (
    <section className="max-w-6xl mx-auto px-6 py-6" style={offsetStyle}>
      <div
        className={`relative overflow-hidden rounded-xl shadow-sm ${borderClass}`}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
      >
        {isClickable ? (
          <button
            type="button"
            className="relative h-full min-h-0 w-full appearance-none border-0 bg-transparent p-0 text-center transition hover:brightness-[0.98]"
            onClick={() => performJump(jumpTarget, props.onNavigatePage, props.availablePages)}
          >
            <div className="absolute inset-0 box-border flex min-h-0 min-w-0 items-center justify-center overflow-hidden text-center" style={resolveButtonContentPadding(blockWidth, blockHeight)}>
              <div
                className="min-h-0 min-w-0 w-full overflow-hidden break-words whitespace-pre-wrap"
                style={typographyStyle}
                dangerouslySetInnerHTML={{ __html: labelHtml }}
              />
            </div>
          </button>
        ) : (
          <div className="relative h-full min-h-0 w-full">
            <div className="absolute inset-0 box-border flex min-h-0 min-w-0 items-center justify-center overflow-hidden text-center" style={resolveButtonContentPadding(blockWidth, blockHeight)}>
              <div
                className="min-h-0 min-w-0 w-full overflow-hidden break-words whitespace-pre-wrap"
                style={typographyStyle}
                dangerouslySetInnerHTML={{ __html: labelHtml }}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
