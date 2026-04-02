export type CommonCanvasLayoutBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CommonCanvasLayoutOptions = {
  availableWidth?: number;
  availableHeight?: number;
  minCanvasWidth?: number;
  minCanvasHeight?: number;
};

export type CommonCanvasLayoutMetrics = {
  bounds: {
    minX: number;
    minY: number;
    width: number;
    height: number;
  };
  translateX: number;
  translateY: number;
  scale: number;
  renderWidth: number;
  renderHeight: number;
};

const DEFAULT_MIN_CANVAS_WIDTH = 280;
const DEFAULT_MIN_CANVAS_HEIGHT = 240;

function normalizeFloorSize(value: number | undefined, fallback: number) {
  return Math.max(1, Math.round(Number.isFinite(value) ? Number(value) : fallback));
}

function normalizeAvailableSize(value: number | undefined) {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(1, Math.round(Number(value)));
}

export function resolveCommonCanvasLayout(
  boxes: CommonCanvasLayoutBox[],
  options: CommonCanvasLayoutOptions = {},
): CommonCanvasLayoutMetrics {
  const minCanvasWidth = normalizeFloorSize(options.minCanvasWidth, DEFAULT_MIN_CANVAS_WIDTH);
  const minCanvasHeight = normalizeFloorSize(options.minCanvasHeight, DEFAULT_MIN_CANVAS_HEIGHT);
  const availableWidth = normalizeAvailableSize(options.availableWidth);
  const availableHeight = normalizeAvailableSize(options.availableHeight);

  let minX = 0;
  let minY = 0;
  let maxX = minCanvasWidth;
  let maxY = minCanvasHeight;

  for (const box of boxes) {
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.width) || !Number.isFinite(box.height)) {
      continue;
    }
    const x = Math.round(box.x);
    const y = Math.round(box.y);
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  const width = Math.max(minCanvasWidth, maxX - minX);
  const height = Math.max(minCanvasHeight, maxY - minY);
  const scaleCandidates = [1];
  if (availableWidth) scaleCandidates.push(availableWidth / width);
  if (availableHeight) scaleCandidates.push(availableHeight / height);
  const scale = Math.max(0.05, Math.min(...scaleCandidates));

  return {
    bounds: {
      minX,
      minY,
      width,
      height,
    },
    translateX: -minX,
    translateY: -minY,
    scale,
    renderWidth: Math.round(width * scale * 1000) / 1000,
    renderHeight: Math.round(height * scale * 1000) / 1000,
  };
}
