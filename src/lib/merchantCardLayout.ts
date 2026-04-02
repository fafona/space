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
const DEFAULT_CHROME_GAP = 12;
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

function parseLayoutIndex(key: MerchantListLayoutKey) {
  const matched = key.match(/(\d+)$/);
  return matched ? Math.max(0, Number.parseInt(matched[1], 10) - 1) : 0;
}

function estimateAdaptiveButtonWidth(label: string) {
  const text = String(label ?? "").trim();
  if (!text) return 64;
  let width = 24;
  for (const char of text) {
    if (/\s/.test(char)) {
      width += 4;
    } else if (/[\u0000-\u00ff]/.test(char)) {
      width += /[A-Z0-9]/.test(char) ? 8 : 7;
    } else {
      width += 12;
    }
  }
  return Math.max(64, Math.min(420, Math.round(width)));
}

function entriesOverlap(a: MerchantLayoutEntry, b: MerchantLayoutEntry) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function matchesDefaultMerchantChromeLayout(
  entry: MerchantLayoutEntry | null,
  defaults: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
) {
  if (!entry) return false;
  return (
    entry.x === defaults.x &&
    entry.y === defaults.y &&
    entry.width === defaults.width &&
    entry.height === defaults.height
  );
}

function shouldFlowAdaptiveTabs(entries: MerchantLayoutEntry[], widths: number[], heights: number[], availableWidth: number) {
  const expanded = entries.map((entry, index) => ({
    ...entry,
    width: widths[index] ?? entry.width,
    height: heights[index] ?? entry.height,
  }));
  if (expanded.some((entry, index) => entry.width > entries[index].width || entry.height > entries[index].height)) {
    return true;
  }
  if (expanded.some((entry) => entry.x + entry.width > availableWidth)) return true;
  for (let index = 0; index < expanded.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < expanded.length; otherIndex += 1) {
      if (entriesOverlap(expanded[index], expanded[otherIndex])) return true;
    }
  }
  return false;
}

export function resolveAdaptiveMerchantListEntries(
  entries: MerchantLayoutEntry[],
  options: {
    availableWidth?: number;
    tabLabels?: string[];
    prevLabel?: string;
    nextLabel?: string;
  } = {},
) {
  const tabs = entries
    .filter((item) => item.kind === "tab")
    .sort((left, right) => parseLayoutIndex(left.key) - parseLayoutIndex(right.key));
  const cards = entries.filter((item) => item.kind === "card");
  const chrome = entries.filter((item) => item.kind === "prev" || item.kind === "next");
  const availableWidth = Math.max(
    160,
    Math.round(
      Number.isFinite(options.availableWidth)
        ? Number(options.availableWidth)
        : Math.max(260, ...entries.map((item) => item.x + item.width)),
    ),
  );

  const tabWidths = tabs.map((entry, index) => {
    const label = options.tabLabels?.[index] ?? entry.label;
    const desiredWidth = Math.max(entry.minWidth, entry.width, estimateAdaptiveButtonWidth(label));
    return Math.min(availableWidth, desiredWidth);
  });
  const tabHeights = tabs.map((entry, index) => {
    const desiredWidth = Math.max(entry.minWidth, entry.width, estimateAdaptiveButtonWidth(options.tabLabels?.[index] ?? entry.label));
    const currentWidth = Math.max(1, tabWidths[index] ?? entry.width);
    const lineCount = Math.max(1, Math.ceil(desiredWidth / currentWidth));
    return Math.max(entry.minHeight, entry.height, lineCount > 1 ? 18 * lineCount + 8 : entry.height);
  });
  const flowTabs = shouldFlowAdaptiveTabs(tabs, tabWidths, tabHeights, availableWidth);
  const tabsTop = tabs.length > 0 ? Math.min(...tabs.map((item) => item.y)) : 0;

  const adaptedTabs = flowTabs
    ? (() => {
        let cursorX = 0;
        let cursorY = tabsTop;
        let rowHeight = 0;
        return tabs.map((entry, index) => {
          const width = tabWidths[index] ?? entry.width;
          const height = tabHeights[index] ?? entry.height;
          if (cursorX > 0 && cursorX + width > availableWidth) {
            cursorX = 0;
            cursorY += rowHeight + DEFAULT_TAB_GAP;
            rowHeight = 0;
          }
          const nextEntry = { ...entry, x: cursorX, y: cursorY, width, height };
          cursorX += width + DEFAULT_TAB_GAP;
          rowHeight = Math.max(rowHeight, height);
          return nextEntry;
        });
      })()
    : tabs.map((entry, index) => ({
        ...entry,
        width: tabWidths[index] ?? entry.width,
        height: tabHeights[index] ?? entry.height,
      }));

  const originalTabsBottom = tabs.length > 0 ? Math.max(...tabs.map((item) => item.y + item.height)) : 0;
  const adaptedTabsBottom = adaptedTabs.length > 0 ? Math.max(...adaptedTabs.map((item) => item.y + item.height)) : 0;
  const tabsDeltaY = adaptedTabsBottom - originalTabsBottom;

  const adaptedCards = cards.map((entry) => ({
    ...entry,
    y: entry.y + tabsDeltaY,
  }));

  const baseChrome = {
    prev: chrome.find((item) => item.kind === "prev") ?? null,
    next: chrome.find((item) => item.kind === "next") ?? null,
  };
  const originalCardsBottom = cards.length > 0 ? Math.max(...cards.map((item) => item.y + item.height)) : originalTabsBottom;
  const defaultChromeY = originalCardsBottom + 14;
  const prevUsesDefaultLayout = matchesDefaultMerchantChromeLayout(baseChrome.prev, {
    x: 0,
    y: defaultChromeY,
    width: 92,
    height: 34,
  });
  const nextUsesDefaultLayout = matchesDefaultMerchantChromeLayout(baseChrome.next, {
    x: 104,
    y: defaultChromeY,
    width: 92,
    height: 34,
  });
  const cardsBottom = adaptedCards.length > 0 ? Math.max(...adaptedCards.map((item) => item.y + item.height)) : adaptedTabsBottom;
  const pagerBaseY = cardsBottom + 14;
  const prevWidth = baseChrome.prev ? Math.min(availableWidth, Math.max(baseChrome.prev.minWidth, baseChrome.prev.width, estimateAdaptiveButtonWidth(options.prevLabel ?? baseChrome.prev.label))) : 0;
  const nextWidth = baseChrome.next ? Math.min(availableWidth, Math.max(baseChrome.next.minWidth, baseChrome.next.width, estimateAdaptiveButtonWidth(options.nextLabel ?? baseChrome.next.label))) : 0;
  const prevHeight = baseChrome.prev ? Math.max(baseChrome.prev.minHeight, baseChrome.prev.height) : 0;
  const nextHeight = baseChrome.next ? Math.max(baseChrome.next.minHeight, baseChrome.next.height) : 0;
  const pagerNeedsWrap = prevWidth > 0 && nextWidth > 0 && prevWidth + DEFAULT_CHROME_GAP + nextWidth > availableWidth;

  const adaptedChrome = chrome.map((entry) => {
    if (entry.kind === "prev") {
      const width = prevWidth || entry.width;
      const height = prevHeight || entry.height;
      const preservedX = Math.max(0, Math.min(availableWidth - width, entry.x));
      return {
        ...entry,
        x: prevUsesDefaultLayout ? 0 : preservedX,
        y: prevUsesDefaultLayout ? pagerBaseY : Math.max(0, entry.y + tabsDeltaY),
        width,
        height,
      };
    }
    const width = nextWidth || entry.width;
    const height = nextHeight || entry.height;
    const nextY = pagerNeedsWrap ? pagerBaseY + Math.max(prevHeight, nextHeight) + DEFAULT_CHROME_GAP : pagerBaseY;
    const preservedX = Math.max(0, Math.min(availableWidth - width, entry.x));
    return {
      ...entry,
      x: nextUsesDefaultLayout ? (pagerNeedsWrap ? 0 : (prevWidth > 0 ? prevWidth + DEFAULT_CHROME_GAP : 0)) : preservedX,
      y: nextUsesDefaultLayout ? nextY : Math.max(0, entry.y + tabsDeltaY),
      width,
      height,
    };
  });

  return [...adaptedTabs, ...adaptedChrome, ...adaptedCards];
}
