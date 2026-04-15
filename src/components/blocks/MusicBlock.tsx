import type { BackgroundEditableProps } from "@/data/homeBlocks";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { resolveMobileFitCardClass, resolveMobileFitSectionClass } from "./mobileFrame";
import { toRichHtml } from "./richText";

type MusicBlockProps = BackgroundEditableProps & {
  heading?: string;
  audioUrl?: string;
  musicPlayerStyle?: "classic" | "minimal" | "card" | "hidden";
};

function getPlayerWrapClass(style: MusicBlockProps["musicPlayerStyle"]) {
  if (style === "minimal") return "rounded-md border border-gray-200 bg-white/70 p-3";
  if (style === "card") return "rounded-xl border border-gray-300 bg-gradient-to-r from-gray-50 to-white p-4 shadow-sm";
  return "";
}

export default function MusicBlock(props: MusicBlockProps) {
  const mobileFitScreenWidth = props.mobileFitScreenWidth === true;
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
  const style = props.musicPlayerStyle ?? "classic";
  const audioUrl = props.audioUrl?.trim() ?? "";

  return (
    <section className={resolveMobileFitSectionClass("max-w-6xl mx-auto px-6 py-6", mobileFitScreenWidth)} style={offsetStyle}>
      <div
        className={resolveMobileFitCardClass(`bg-white rounded-xl shadow-sm p-6 overflow-hidden ${borderClass}`, mobileFitScreenWidth)}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
      >
        <h2
          className="text-xl font-bold whitespace-pre-wrap break-words"
          dangerouslySetInnerHTML={{ __html: toRichHtml(props.heading, "音乐播放器") }}
        />
        {style === "hidden" ? (
          <div className="mt-4 text-sm text-gray-500">播放器已隐藏</div>
        ) : audioUrl ? (
          <div className={`mt-4 ${getPlayerWrapClass(style)}`}>
            <audio controls className="w-full" src={audioUrl} preload="metadata" />
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
            暂无音乐，请在后台上传音频。
          </div>
        )}
      </div>
    </section>
  );
}
