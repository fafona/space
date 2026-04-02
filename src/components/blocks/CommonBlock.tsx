import type { BackgroundEditableProps } from "@/data/homeBlocks";
import { resolveCommonCanvasLayout } from "@/lib/commonCanvasLayout";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { toRichHtml } from "./richText";

type CommonTextBox = {
  id: string;
  html: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotateDeg?: number;
};

type CommonBlockProps = BackgroundEditableProps & {
  commonTextBoxes?: CommonTextBox[];
  commonItems?: string[];
  heading?: string;
  text?: string;
};

function normalizeCommonTextBoxes(props: CommonBlockProps): CommonTextBox[] {
  const fromBoxes = Array.isArray(props.commonTextBoxes) ? props.commonTextBoxes : [];
  if (fromBoxes.length > 0) {
    return fromBoxes
      .filter((item) => item && typeof item.id === "string")
      .map((item) => ({
        id: item.id,
        html: item.html ?? "",
        x: Number.isFinite(item.x) ? Math.round(item.x) : 0,
        y: Number.isFinite(item.y) ? Math.round(item.y) : 0,
        width: Number.isFinite(item.width) ? Math.max(80, Math.round(item.width)) : 240,
        height: Number.isFinite(item.height) ? Math.max(40, Math.round(item.height)) : 80,
        rotateDeg: Number.isFinite(item.rotateDeg) ? Number(item.rotateDeg) : 0,
      }));
  }

  const itemsFromArray = Array.isArray(props.commonItems) ? props.commonItems.map((item) => item.trim()).filter(Boolean) : [];
  return itemsFromArray.map((item, idx) => ({
    id: `legacy-${idx}`,
    html: item,
    x: 0,
    y: idx * 88,
    width: 360,
    height: 72,
    rotateDeg: 0,
  }));
}

export default function CommonBlock(props: CommonBlockProps) {
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
      ? Math.max(240, Math.round(props.blockWidth))
      : undefined;
  const blockHeight =
    typeof props.blockHeight === "number" && Number.isFinite(props.blockHeight)
      ? Math.max(120, Math.round(props.blockHeight))
      : undefined;
  const sizeStyle = {
    width: blockWidth ? `${blockWidth}px` : undefined,
    height: blockHeight ? `${blockHeight}px` : undefined,
  };
  const viewportWidth = blockWidth ? Math.max(120, Math.round(blockWidth) - 48) : undefined;
  const viewportHeight = blockHeight ? Math.max(72, Math.round(blockHeight) - 48) : undefined;
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
  const boxes = normalizeCommonTextBoxes(props);
  const canvasLayout = resolveCommonCanvasLayout(boxes, {
    availableWidth: viewportWidth,
    availableHeight: viewportHeight,
  });

  return (
    <section className="max-w-6xl mx-auto px-6 py-6" style={offsetStyle}>
      <div
        className={`bg-white rounded-xl shadow-sm p-6 overflow-hidden ${borderClass}`}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
      >
        <div
          className="relative overflow-visible"
          style={{
            minHeight: blockHeight ? undefined : `${canvasLayout.renderHeight}px`,
            width: `${canvasLayout.renderWidth}px`,
            height: `${canvasLayout.renderHeight}px`,
            maxWidth: "100%",
          }}
        >
          <div
            className="absolute left-0 top-0"
            style={{
              width: `${canvasLayout.bounds.width}px`,
              height: `${canvasLayout.bounds.height}px`,
              transform: `scale(${canvasLayout.scale})`,
              transformOrigin: "top left",
            }}
          >
            {boxes.map((box) => (
              <div
                key={box.id}
                className="absolute border border-transparent"
                style={{
                  left: `${box.x + canvasLayout.translateX}px`,
                  top: `${box.y + canvasLayout.translateY}px`,
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
      </div>
    </section>
  );
}
