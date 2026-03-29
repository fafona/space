import type { ButtonProps } from "@/data/homeBlocks";

type LegacyButtonTextBox = NonNullable<ButtonProps["commonTextBoxes"]>[number];

export type ButtonJumpPage = {
  id: string;
  name?: string;
};
export const BUTTON_BLOCK_MIN_WIDTH = 18;
export const BUTTON_BLOCK_MIN_HEIGHT = 18;

export const DEFAULT_BUTTON_LABEL = "按钮";

function hasVisibleContent(value: string | undefined) {
  if (typeof value !== "string") return false;
  const normalized = value
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<\/?(div|p|span|strong|em|u|b|i)[^>]*>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return normalized.length > 0;
}

function findLegacyButtonLabel(props: ButtonProps) {
  const textBoxes = Array.isArray(props.commonTextBoxes) ? props.commonTextBoxes : [];
  const firstTextBox = textBoxes.find((item: LegacyButtonTextBox | undefined) => hasVisibleContent(item?.html));
  if (firstTextBox?.html) return firstTextBox.html;

  const commonItems = Array.isArray(props.commonItems) ? props.commonItems : [];
  const commonItem = commonItems.find((item) => hasVisibleContent(item));
  if (commonItem) return commonItem;

  if (hasVisibleContent(props.heading)) return props.heading ?? "";
  if (hasVisibleContent(props.text)) return props.text ?? "";
  return "";
}

function stripButtonJumpText(value: string | undefined) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePageMatchValue(value: string | undefined) {
  return stripButtonJumpText(value).replace(/\s+/g, "").toLowerCase();
}

function resolveOrdinalPageIndex(target: string) {
  const normalized = target.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized === "frontpage" ||
    normalized === "front-page" ||
    normalized === "front page" ||
    normalized === "homepage" ||
    normalized === "home-page" ||
    normalized === "home page"
  ) {
    return 1;
  }

  const match = normalized.match(/^page[-\s]*([0-9]{1,2})$/i) ?? normalized.match(/^p([0-9]{1,2})$/i);
  if (!match) return null;
  const index = Number(match[1]);
  if (!Number.isFinite(index) || index < 1) return null;
  return index;
}

export function resolveButtonLabel(props: ButtonProps) {
  if (hasVisibleContent(props.buttonLabel)) {
    return props.buttonLabel ?? DEFAULT_BUTTON_LABEL;
  }
  return findLegacyButtonLabel(props) || DEFAULT_BUTTON_LABEL;
}

export function resolveButtonJumpPageId(target: string, pages: ButtonJumpPage[]) {
  const trimmed = target.trim();
  if (!trimmed || !Array.isArray(pages) || pages.length === 0) return null;

  const candidate = trimmed.replace(/^page:/i, "").trim();
  if (!candidate) return null;

  const byId = pages.find((page) => page.id.trim().toLowerCase() === candidate.toLowerCase());
  if (byId) return byId.id;

  const normalizedCandidate = normalizePageMatchValue(candidate);
  if (normalizedCandidate) {
    const byName = pages.find((page) => normalizePageMatchValue(page.name) === normalizedCandidate);
    if (byName) return byName.id;
  }

  const ordinalIndex = resolveOrdinalPageIndex(candidate);
  if (!ordinalIndex || ordinalIndex > pages.length) return null;
  return pages[ordinalIndex - 1]?.id ?? null;
}

export function resolveButtonContentPadding(width?: number, height?: number) {
  const safeWidth =
    typeof width === "number" && Number.isFinite(width)
      ? Math.max(BUTTON_BLOCK_MIN_WIDTH, Math.round(width))
      : undefined;
  const safeHeight =
    typeof height === "number" && Number.isFinite(height)
      ? Math.max(BUTTON_BLOCK_MIN_HEIGHT, Math.round(height))
      : undefined;

  const horizontal =
    safeWidth == null ? 20 :
    safeWidth <= 32 ? 2 :
    safeWidth <= 48 ? 4 :
    safeWidth <= 72 ? 8 :
    safeWidth <= 108 ? 12 :
    20;

  const vertical =
    safeHeight == null ? 12 :
    safeHeight <= 24 ? 1 :
    safeHeight <= 32 ? 2 :
    safeHeight <= 44 ? 4 :
    safeHeight <= 60 ? 8 :
    12;

  return {
    paddingInline: horizontal,
    paddingBlock: vertical,
  };
}

export function buildButtonLabelPatch(buttonLabel: string): Partial<ButtonProps> {
  return {
    buttonLabel,
    commonTextBoxes: undefined,
    commonItems: undefined,
    heading: undefined,
    text: undefined,
  };
}
