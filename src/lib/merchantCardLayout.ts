export type MerchantCardLayoutKey = `card${number}`;
export type MerchantTabLayoutKey = `tab${number}`;
export type MerchantListLayoutKey = MerchantCardLayoutKey | MerchantTabLayoutKey | "prev" | "next";

export type MerchantCardLayoutConfig = Partial<
  Record<
    string,
    {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }
  >
>;

export type MerchantLayoutEntry = {
  key: MerchantListLayoutKey;
  label: string;
  kind: "card" | "tab" | "prev" | "next";
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
};

const DEFAULT_CARD_WIDTH = 320;
const DEFAULT_CARD_HEIGHT = 190;
const DEFAULT_CARD_GAP = 14;
const DEFAULT_CARD_COLUMNS = 3;
const MIN_CARD_WIDTH = 160;
const MIN_CARD_HEIGHT = 30;
const DEFAULT_TOP_OFFSET = 52;
const DEFAULT_TAB_WIDTH = 108;
const DEFAULT_TAB_HEIGHT = 34;
const DEFAULT_TAB_GAP = 8;
const DEFAULT_TAB_COLUMNS = 6;
const MIN_CARD_COUNT = 1;
const MAX_CARD_COUNT = 24;
const MIN_TAB_COUNT = 0;
const MAX_TAB_COUNT = 24;

export function clampMerchantCardLayoutValue(value: unknown, fallback: number, min = 0) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.round(value)) : fallback;
}

export function normalizeMerchantCardCount(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return MIN_CARD_COUNT;
  return Math.max(MIN_CARD_COUNT, Math.min(MAX_CARD_COUNT, Math.round(value)));
}

export function normalizeMerchantTabCount(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return MIN_TAB_COUNT;
  return Math.max(MIN_TAB_COUNT, Math.min(MAX_TAB_COUNT, Math.round(value)));
}

export function getMerchantCardKey(index: number): MerchantCardLayoutKey {
  const safeIndex = Math.max(0, Math.floor(index));
  return `card${safeIndex + 1}`;
}

export function getMerchantTabKey(index: number): MerchantTabLayoutKey {
  const safeIndex = Math.max(0, Math.floor(index));
  return `tab${safeIndex + 1}`;
}

function resolveMerchantTabLayoutEntries(
  layout: MerchantCardLayoutConfig | undefined,
  tabCount: number,
): MerchantLayoutEntry[] {
  const safeLayout = layout ?? {};
  const count = normalizeMerchantTabCount(tabCount);
  if (count <= 0) return [];
  const columns = Math.min(DEFAULT_TAB_COLUMNS, Math.max(1, count));
  const legacyTabs = safeLayout.tabs ?? {};
  const legacyX = clampMerchantCardLayoutValue(legacyTabs.x, 0);
  const legacyY = clampMerchantCardLayoutValue(legacyTabs.y, 0);
  const legacyWidth = clampMerchantCardLayoutValue(legacyTabs.width, DEFAULT_TAB_WIDTH * columns + DEFAULT_TAB_GAP * (columns - 1), 64);
  const derivedTabWidth = Math.max(
    64,
    Math.floor((legacyWidth - DEFAULT_TAB_GAP * (columns - 1)) / columns),
  );

  return Array.from({ length: count }, (_, index) => {
    const key = getMerchantTabKey(index);
    const col = index % columns;
    const row = Math.floor(index / columns);
    const defaultX = legacyX + col * (derivedTabWidth + DEFAULT_TAB_GAP);
    const defaultY = legacyY + row * (DEFAULT_TAB_HEIGHT + DEFAULT_TAB_GAP);
    const saved = safeLayout[key] ?? {};
    return {
      key,
      label: `标签${index + 1}`,
      kind: "tab" as const,
      x: clampMerchantCardLayoutValue(saved.x, defaultX),
      y: clampMerchantCardLayoutValue(saved.y, defaultY),
      width: clampMerchantCardLayoutValue(saved.width, derivedTabWidth, 64),
      height: clampMerchantCardLayoutValue(saved.height, DEFAULT_TAB_HEIGHT, 28),
      minWidth: 64,
      minHeight: 28,
    };
  });
}

function resolveMerchantCardLayoutEntries(
  layout: MerchantCardLayoutConfig | undefined,
  count: number,
  topOffset: number,
): MerchantLayoutEntry[] {
  const safeLayout = layout ?? {};
  const cardCount = normalizeMerchantCardCount(count);
  const columns = Math.min(DEFAULT_CARD_COLUMNS, cardCount);

  return Array.from({ length: cardCount }, (_, index) => {
    const key = getMerchantCardKey(index);
    const col = index % columns;
    const row = Math.floor(index / columns);
    const defaultX = col * (DEFAULT_CARD_WIDTH + DEFAULT_CARD_GAP);
    const defaultY = topOffset + row * (DEFAULT_CARD_HEIGHT + DEFAULT_CARD_GAP);
    const saved = safeLayout[key] ?? {};
    return {
      key,
      label: `商户框${index + 1}`,
      kind: "card" as const,
      x: clampMerchantCardLayoutValue(saved.x, defaultX),
      y: clampMerchantCardLayoutValue(saved.y, defaultY),
      width: clampMerchantCardLayoutValue(saved.width, DEFAULT_CARD_WIDTH, MIN_CARD_WIDTH),
      height: clampMerchantCardLayoutValue(saved.height, DEFAULT_CARD_HEIGHT, MIN_CARD_HEIGHT),
      minWidth: MIN_CARD_WIDTH,
      minHeight: MIN_CARD_HEIGHT,
    };
  });
}

function resolveMerchantChromeLayoutEntries(
  layout: MerchantCardLayoutConfig | undefined,
  cardEntries: MerchantLayoutEntry[],
): MerchantLayoutEntry[] {
  const safeLayout = layout ?? {};
  const cardsBottom = cardEntries.length > 0 ? Math.max(...cardEntries.map((item) => item.y + item.height)) : DEFAULT_TOP_OFFSET;

  const prev = safeLayout.prev ?? {};
  const next = safeLayout.next ?? {};

  return [
    {
      key: "prev",
      label: "上一页按钮",
      kind: "prev",
      x: clampMerchantCardLayoutValue(prev.x, 0),
      y: clampMerchantCardLayoutValue(prev.y, cardsBottom + 14),
      width: clampMerchantCardLayoutValue(prev.width, 92, 64),
      height: clampMerchantCardLayoutValue(prev.height, 34, 28),
      minWidth: 64,
      minHeight: 28,
    },
    {
      key: "next",
      label: "下一页按钮",
      kind: "next",
      x: clampMerchantCardLayoutValue(next.x, 104),
      y: clampMerchantCardLayoutValue(next.y, cardsBottom + 14),
      width: clampMerchantCardLayoutValue(next.width, 92, 64),
      height: clampMerchantCardLayoutValue(next.height, 34, 28),
      minWidth: 64,
      minHeight: 28,
    },
  ];
}

export function resolveMerchantListLayoutEntries(
  layout: MerchantCardLayoutConfig | undefined,
  cardCount: number,
  tabCount: number,
): MerchantLayoutEntry[] {
  const tabs = resolveMerchantTabLayoutEntries(layout, tabCount);
  const tabsBottom = tabs.length > 0 ? Math.max(...tabs.map((item) => item.y + item.height)) : 0;
  const cardsTop = tabs.length > 0 ? tabsBottom + 14 : DEFAULT_TOP_OFFSET;
  const cards = resolveMerchantCardLayoutEntries(layout, cardCount, cardsTop);
  const chrome = resolveMerchantChromeLayoutEntries(layout, cards);
  return [...tabs, ...chrome, ...cards];
}

export function getMerchantLayoutCanvasWidth(entries: MerchantLayoutEntry[]) {
  return Math.max(260, ...entries.map((item) => item.x + item.width));
}

export function getMerchantLayoutCanvasHeight(entries: MerchantLayoutEntry[]) {
  return Math.max(140, ...entries.map((item) => item.y + item.height));
}

export function getMerchantLayoutContainerHeight(entries: MerchantLayoutEntry[]) {
  return getMerchantLayoutCanvasHeight(entries);
}

export function buildMerchantCardPlacement(entries: MerchantLayoutEntry[], index: number) {
  const cards = entries.filter((item) => item.kind === "card");
  const safeIndex = Math.max(0, Math.floor(index));
  const fallback = cards[cards.length - 1] ?? {
    x: 0,
    y: DEFAULT_TOP_OFFSET,
    width: DEFAULT_CARD_WIDTH,
    height: DEFAULT_CARD_HEIGHT,
  };
  const entry = cards[safeIndex] ?? fallback;
  return {
    x: entry.x,
    y: entry.y,
    width: entry.width,
    height: entry.height,
  };
}
