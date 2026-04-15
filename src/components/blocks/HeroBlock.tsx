import type { BackgroundEditableProps } from "@/data/homeBlocks";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { resolveMobileFitCardClass, resolveMobileFitSectionClass } from "./mobileFrame";
import { toRichHtml } from "./richText";

type HeroBlockProps = BackgroundEditableProps & {
  title?: string;
  subtitle?: string;
};

export default function HeroBlock(props: HeroBlockProps) {
  const mobileFitScreenWidth = props.mobileFitScreenWidth === true;
  const sectionStyle = getBackgroundStyle({
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
    <section
      className={resolveMobileFitCardClass(
        resolveMobileFitSectionClass(`bg-white mx-auto rounded-xl overflow-hidden ${borderClass}`, mobileFitScreenWidth),
        mobileFitScreenWidth,
      )}
      style={{ ...sectionStyle, ...sizeStyle, ...offsetStyle, ...borderInlineStyle }}
    >
      <div className={`max-w-6xl mx-auto py-10 ${mobileFitScreenWidth ? "px-4 md:px-6" : "px-6"}`}>
        <div className="p-6">
          <h1 className="text-3xl font-bold whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: toRichHtml(props.title, "我的商家主页") }} />
          <div
            className="mt-3 text-gray-600 whitespace-pre-wrap break-words"
            dangerouslySetInnerHTML={{ __html: toRichHtml(props.subtitle, "欢迎来到我的官方网站，这里展示我的产品和服务。") }}
          />
        </div>
      </div>
    </section>
  );
}
