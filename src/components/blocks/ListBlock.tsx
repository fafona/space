import type { BackgroundEditableProps } from "@/data/homeBlocks";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { toRichHtml } from "./richText";

type ListBlockProps = BackgroundEditableProps & {
  heading?: string;
  items?: string[];
};

export default function ListBlock(props: ListBlockProps) {
  const items = Array.isArray(props.items) ? props.items.map((item) => item.trim()).filter(Boolean) : [];

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
    overflow: blockHeight ? ("auto" as const) : undefined,
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

  return (
    <section className="max-w-6xl mx-auto px-6 py-6" style={offsetStyle}>
      <div
        className={`bg-white rounded-xl shadow-sm p-6 overflow-hidden ${borderClass}`}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
      >
        <h2 className="text-xl font-bold whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: toRichHtml(props.heading, "") }} />
        {items.length > 0 ? (
          <ul className="mt-3 list-disc pl-6 text-gray-700 space-y-1">
            {items.map((it, idx) => (
              <li key={idx} dangerouslySetInnerHTML={{ __html: toRichHtml(it, "") }} />
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}






