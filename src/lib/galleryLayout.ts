export type GalleryLayoutPreset = "three-wide" | "two-wide" | "single-wide" | "three-square" | "mosaic" | "custom";

export type GalleryRowAlign = "left" | "center" | "right";
export type CustomGalleryFrameWidth = "1" | "1/2" | "1/3" | "2/3";
export type CustomGalleryRow = {
  height: number;
  align: GalleryRowAlign;
  frames: CustomGalleryFrameWidth[];
};
export type CustomGalleryLayout = {
  rows: [CustomGalleryRow, CustomGalleryRow, CustomGalleryRow];
};

export type GalleryCardLayout = {
  itemClass: string;
  frameStyle: {
    height?: number;
    aspectRatio?: string;
  };
};

export type GalleryRowRender = {
  key: string;
  align: GalleryRowAlign;
  items: Array<{
    index: number;
    span: number;
    height: number;
  }>;
};

export const GALLERY_LAYOUT_PRESETS: GalleryLayoutPreset[] = [
  "three-wide",
  "two-wide",
  "single-wide",
  "three-square",
  "mosaic",
  "custom",
];

export const CUSTOM_GALLERY_FRAME_WIDTHS: CustomGalleryFrameWidth[] = ["1", "1/2", "1/3", "2/3"];

export function frameWidthToSpan(width: CustomGalleryFrameWidth): number {
  if (width === "1") return 12;
  if (width === "1/2") return 6;
  if (width === "2/3") return 8;
  return 4;
}

export function spanToItemClass(span: number): string {
  return `lg:col-span-${Math.max(1, Math.min(12, Math.round(span)))}`;
}

export function createDefaultCustomGalleryLayout(): CustomGalleryLayout {
  return {
    rows: [
      { height: 220, align: "left", frames: ["1/2", "1/2"] },
      { height: 200, align: "left", frames: ["1/3", "1/3", "1/3"] },
      { height: 220, align: "left", frames: ["2/3", "1/3"] },
    ],
  };
}

export function normalizeCustomGalleryLayout(value: unknown): CustomGalleryLayout {
  const fallback = createDefaultCustomGalleryLayout();
  if (!value || typeof value !== "object") return fallback;
  const rows = (value as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length !== 3) return fallback;
  const normalizedRows = rows.map((row, idx) => {
    if (!row || typeof row !== "object") return fallback.rows[idx];
    const heightRaw = (row as { height?: unknown }).height;
    const alignRaw = (row as { align?: unknown }).align;
    const framesRaw = (row as { frames?: unknown }).frames;
    const height = typeof heightRaw === "number" && Number.isFinite(heightRaw) ? Math.max(120, Math.min(600, Math.round(heightRaw))) : fallback.rows[idx].height;
    const align: GalleryRowAlign = alignRaw === "center" || alignRaw === "right" || alignRaw === "left" ? alignRaw : fallback.rows[idx].align;
    const frames =
      Array.isArray(framesRaw)
        ? framesRaw
            .filter((item): item is CustomGalleryFrameWidth => item === "1" || item === "1/2" || item === "1/3" || item === "2/3")
            .slice(0, 8)
        : fallback.rows[idx].frames;
    return {
      height,
      align,
      frames,
    };
  }) as [CustomGalleryRow, CustomGalleryRow, CustomGalleryRow];
  return { rows: normalizedRows };
}

function getCustomTemplateLayouts(customLayout?: CustomGalleryLayout): GalleryCardLayout[] {
  const safeLayout = normalizeCustomGalleryLayout(customLayout);
  const result: GalleryCardLayout[] = [];
  for (const row of safeLayout.rows) {
    for (const width of row.frames) {
      result.push({
        itemClass: spanToItemClass(frameWidthToSpan(width)),
        frameStyle: { height: row.height },
      });
    }
  }
  return result.length > 0 ? result : [{ itemClass: "lg:col-span-12", frameStyle: { height: 220 } }];
}

export function buildCustomGalleryRows(customLayout: CustomGalleryLayout | undefined, itemCount: number): GalleryRowRender[] {
  const safeLayout = normalizeCustomGalleryLayout(customLayout);
  const total = Math.max(0, Math.floor(itemCount));
  if (total === 0) return [];

  const rows = safeLayout.rows.map((row, rowIndex) => ({
    rowIndex,
    align: row.align,
    height: row.height,
    spans: row.frames.map((frame) => frameWidthToSpan(frame)).filter((span) => span > 0),
  }));
  const hasAnyFrame = rows.some((row) => row.spans.length > 0);
  const normalizedRows = hasAnyFrame
    ? rows
    : [{ rowIndex: 0, align: "left" as GalleryRowAlign, height: safeLayout.rows[0].height, spans: [12] }];

  let cursor = 0;
  let cycle = 0;
  const output: GalleryRowRender[] = [];
  while (cursor < total) {
    for (const row of normalizedRows) {
      if (cursor >= total) break;
      if (row.spans.length === 0) continue;
      const spans = row.spans;
      const items: GalleryRowRender["items"] = [];
      for (const span of spans) {
        if (cursor >= total) break;
        items.push({
          index: cursor,
          span,
          height: row.height,
        });
        cursor += 1;
      }
      if (items.length > 0) {
        output.push({
          key: `${cycle}-${row.rowIndex}`,
          align: row.align,
          items,
        });
      }
    }
    cycle += 1;
  }
  return output;
}

export function normalizeGalleryLayoutPreset(value: unknown): GalleryLayoutPreset {
  if (
    value === "three-wide" ||
    value === "two-wide" ||
    value === "single-wide" ||
    value === "three-square" ||
    value === "mosaic" ||
    value === "custom"
  ) {
    return value;
  }
  return "three-wide";
}

export function getGalleryCardLayout(
  preset: GalleryLayoutPreset,
  index: number,
  customLayout?: CustomGalleryLayout,
): GalleryCardLayout {
  if (preset === "two-wide") return { itemClass: "lg:col-span-6", frameStyle: { height: 220 } };
  if (preset === "single-wide") return { itemClass: "lg:col-span-12", frameStyle: { height: 260 } };
  if (preset === "three-square") return { itemClass: "lg:col-span-4", frameStyle: { aspectRatio: "1 / 1" } };
  if (preset === "custom") {
    const pattern = getCustomTemplateLayouts(customLayout);
    return pattern[index % pattern.length];
  }
  if (preset === "mosaic") {
    const pattern: GalleryCardLayout[] = [
      { itemClass: "lg:col-span-8", frameStyle: { height: 230 } },
      { itemClass: "lg:col-span-4", frameStyle: { height: 230 } },
      { itemClass: "lg:col-span-4", frameStyle: { height: 200 } },
      { itemClass: "lg:col-span-8", frameStyle: { height: 200 } },
      { itemClass: "lg:col-span-6", frameStyle: { height: 210 } },
      { itemClass: "lg:col-span-6", frameStyle: { height: 210 } },
    ];
    return pattern[index % pattern.length];
  }
  return { itemClass: "lg:col-span-4", frameStyle: { height: 180 } };
}
