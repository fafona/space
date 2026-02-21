import type { BackgroundEditableProps } from "@/data/homeBlocks";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { toRichHtml } from "./richText";

type ChartBlockProps = BackgroundEditableProps & {
  heading?: string;
  text?: string;
  chartType?: "bar" | "line" | "pie";
  labels?: string[];
  values?: number[];
};

function normalizeData(labels?: string[], values?: number[]) {
  const safeLabels = Array.isArray(labels) ? labels.map((item) => item.trim()).filter(Boolean) : [];
  const safeValues = Array.isArray(values)
    ? values
        .map((item) => (typeof item === "number" && Number.isFinite(item) ? item : Number(item)))
        .filter((item) => Number.isFinite(item))
    : [];
  const size = Math.min(safeLabels.length, safeValues.length);
  return {
    labels: safeLabels.slice(0, size),
    values: safeValues.slice(0, size),
  };
}

function renderPieSegments(values: number[]) {
  const total = values.reduce((sum, item) => sum + Math.max(0, item), 0);
  if (total <= 0) return "conic-gradient(#d1d5db 0deg 360deg)";
  const palette = ["#3b82f6", "#f97316", "#10b981", "#a855f7", "#ef4444", "#14b8a6"];
  let current = 0;
  const chunks = values.map((value, idx) => {
    const ratio = Math.max(0, value) / total;
    const start = current * 360;
    current += ratio;
    const end = current * 360;
    return `${palette[idx % palette.length]} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
  });
  return `conic-gradient(${chunks.join(", ")})`;
}

export default function ChartBlock(props: ChartBlockProps) {
  const { labels, values } = normalizeData(props.labels, props.values);
  const maxValue = values.length > 0 ? Math.max(...values, 1) : 1;

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
  const chartType = props.chartType ?? "bar";

  return (
    <section className="max-w-6xl mx-auto px-6 py-6" style={offsetStyle}>
      <div
        className={`bg-white rounded-xl shadow-sm p-6 overflow-hidden ${borderClass}`}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
      >
        <h2
          className="text-xl font-bold whitespace-pre-wrap break-words"
          dangerouslySetInnerHTML={{ __html: toRichHtml(props.heading, "数据图表") }}
        />
        <div
          className="mt-2 text-gray-600 whitespace-pre-wrap break-words"
          dangerouslySetInnerHTML={{ __html: toRichHtml(props.text, "图表区块支持文字说明。") }}
        />
        {labels.length > 0 ? (
          <div className="mt-4">
            {chartType === "bar" ? (
              <div className="space-y-2">
                {values.map((value, idx) => (
                  <div key={`${labels[idx]}-${idx}`} className="grid grid-cols-[80px_1fr_48px] items-center gap-2 text-sm">
                    <div className="truncate text-gray-500">{labels[idx]}</div>
                    <div className="h-5 bg-gray-100 rounded overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${Math.max(4, (value / maxValue) * 100)}%` }} />
                    </div>
                    <div className="text-right text-gray-700">{value}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {chartType === "line" ? (
              <div className="rounded-lg border border-gray-200 p-3">
                <svg viewBox="0 0 100 40" className="w-full h-40">
                  <polyline
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="2"
                    points={values
                      .map((value, idx) => {
                        const x = values.length <= 1 ? 50 : (idx / (values.length - 1)) * 100;
                        const y = 36 - (Math.max(0, value) / maxValue) * 32;
                        return `${x.toFixed(2)},${y.toFixed(2)}`;
                      })
                      .join(" ")}
                  />
                </svg>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                  {labels.map((label, idx) => (
                    <span key={`${label}-${idx}`}>{label}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {chartType === "pie" ? (
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-44 h-44 rounded-full border border-gray-200" style={{ backgroundImage: renderPieSegments(values) }} />
                <div className="text-sm space-y-1">
                  {labels.map((label, idx) => (
                    <div key={`${label}-${idx}`} className="text-gray-600">
                      {label}：{values[idx]}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
            暂无图表数据，请在后台填写标签和数值。
          </div>
        )}
      </div>
    </section>
  );
}
