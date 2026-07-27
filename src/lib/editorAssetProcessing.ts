import type { Block } from "@/data/homeBlocks";
import {
  countInlineAssets,
  hasInlineAssets,
  type InlineAssetStats,
} from "@/lib/inlineAssetStats";
import {
  runWithMerchantOperationContext,
  type MerchantOperationContext,
} from "@/lib/merchantOperationContext";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";

const MAX_ORIGINAL_IMAGE_DATA_URL_LENGTH = 6_000_000;
const MAX_AUDIO_DATA_URL_LENGTH = 4_000_000;
const MAX_IMAGE_FILE_BYTES = 10_000_000;
const MAX_CHAT_FILE_BYTES = 12_000_000;
const DEFAULT_IMAGE_COMPRESSION_OPTIONS = { maxSide: 3200, quality: 0.92 } as const;
const EXTERNALIZE_MIN_IMAGE_BYTES = 300_000;
const PUBLISH_AUTO_COMPRESSION_OPTIONS = [
  { id: "high", label: "高质量", maxSide: 3200, quality: 0.92 },
  { id: "balanced", label: "平衡", maxSide: 2600, quality: 0.88 },
  { id: "compact", label: "压缩优先", maxSide: 2000, quality: 0.8 },
  { id: "auto-tight", label: "自动强压缩", maxSide: 1600, quality: 0.72 },
  { id: "auto-min", label: "自动极限压缩", maxSide: 1200, quality: 0.64 },
] as const;

export type BrowserImageCompressionOptions = {
  maxSide: number;
  quality: number;
};

export type UploadedAssetMetadata = {
  url: string;
  thumbnailUrl?: string;
  posterUrl?: string;
  bucket?: string;
  objectPath?: string;
  thumbnailObjectPath?: string;
  posterObjectPath?: string;
};

export type PublishUploadCompressionPreset = "high" | "balanced" | "compact";

export type ProductThumbnailBackfillStats = {
  visited: number;
  generated: number;
  failed: number;
  skipped: number;
  limited: number;
};

export type PublishOptimizationResult = {
  blocks: Block[];
  optimized: boolean;
  summary: string | null;
};

export type PublishSizeBreakdown = {
  largeFields: Array<{ path: string; bytes: number }>;
  blockTotals: Array<{ path: string; bytes: number }>;
};

export type PublishDiffSummary = {
  changedCount: number;
  addedCount: number;
  removedCount: number;
  changedPaths: string[];
};

export type PublishPreflightResult = {
  errors: string[];
  warnings: string[];
};

export async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("图片读取失败，请重新选择图片后重试"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择图片后重试"));
    reader.readAsDataURL(file);
  });
}

export async function fileToChatFileDataUrl(file: File): Promise<string> {
  if (file.size > MAX_CHAT_FILE_BYTES) {
    throw new Error("文件过大，请选择 12MB 以内文件");
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("文件读取失败，请重新选择后重试"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("文件读取失败，请重新选择后重试"));
    reader.readAsDataURL(file);
  });
}

async function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解析失败，请更换图片"));
    image.src = dataUrl;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择图片后重试"));
    reader.readAsDataURL(blob);
  });
}

function estimateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  if (!base64) {
    return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(dataUrl).length : dataUrl.length;
  }
  return Math.max(0, Math.floor((base64.length * 3) / 4));
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function dataUrlToBrowserBlob(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(",");
  const header = separatorIndex >= 0 ? dataUrl.slice(0, separatorIndex) : "";
  const encoded = separatorIndex >= 0 ? dataUrl.slice(separatorIndex + 1) : "";
  const mime = header.match(/^data:([^;,]+)/i)?.[1] ?? "application/octet-stream";
  if (!encoded || !/;base64$/i.test(header)) return null;
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await loadImageFromDataUrl(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function compressImageDataUrl(
  dataUrl: string,
  options: BrowserImageCompressionOptions,
): Promise<string> {
  const image = await loadImageFromDataUrl(dataUrl);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) {
    throw new Error("图片尺寸异常，请更换图片");
  }

  const scale = Math.min(1, options.maxSide / Math.max(naturalWidth, naturalHeight));
  const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("图片处理失败，请重试");

  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL("image/webp", options.quality);
}

export function buildInitialImageCompressionPlan(sourceBytes: number, limitBytes: number) {
  const ratio = clamp(limitBytes / Math.max(sourceBytes, 1), 0.05, 1);
  if (ratio >= 0.72) {
    return {
      scale: 1,
      quality: clamp(ratio * 0.96, 0.68, 0.92),
    };
  }
  return {
    scale: clamp(Math.sqrt(ratio / 0.84) * 0.99, 0.16, 1),
    quality: 0.84,
  };
}

export function refineImageCompressionPlan(
  previous: { scale: number; quality: number },
  candidateBytes: number,
  limitBytes: number,
) {
  const ratio = clamp(limitBytes / Math.max(candidateBytes, 1), 0.05, 1);
  return {
    scale: clamp(previous.scale * Math.sqrt(ratio) * 0.98, 0.12, 1),
    quality: clamp(Math.min(previous.quality * ratio * 1.04, previous.quality), 0.42, 0.92),
  };
}

async function renderCompressedImageCandidate(
  image: HTMLImageElement,
  scale: number,
  quality: number,
) {
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("读取图片失败");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const blob = await canvasToBlob(canvas, "image/webp", quality);
  if (blob) return { blob, dataUrl: "", bytes: blob.size };
  const dataUrl = canvas.toDataURL("image/webp", quality);
  return { blob: null, dataUrl, bytes: estimateDataUrlBytes(dataUrl) };
}

export async function compressPageBackgroundImageFile(
  file: File,
  options: BrowserImageCompressionOptions,
  limitBytes: number,
) {
  assertValidImageFile(file);
  const image = await loadImageFromBlob(file);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const longestSide = Math.max(naturalWidth, naturalHeight);
  if (!naturalWidth || !naturalHeight || !longestSide) {
    throw new Error("图片尺寸异常，请更换图片");
  }

  const maxScale = Math.min(1, options.maxSide / longestSide);
  let plan = { scale: maxScale, quality: options.quality };
  let bestCandidate: { blob: Blob | null; dataUrl: string; bytes: number } | null = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await yieldToBrowser();
    const candidate = await renderCompressedImageCandidate(image, plan.scale, plan.quality);
    if (!bestCandidate || candidate.bytes < bestCandidate.bytes) bestCandidate = candidate;
    if (candidate.bytes <= limitBytes) {
      const blob = candidate.blob ?? dataUrlToBrowserBlob(candidate.dataUrl);
      if (blob) return { blob, bytes: candidate.bytes };
    }
    const refined = refineImageCompressionPlan(plan, candidate.bytes, limitBytes);
    plan = {
      scale: Math.min(maxScale, refined.scale),
      quality: refined.quality,
    };
  }

  if (bestCandidate && bestCandidate.bytes <= limitBytes) {
    const blob = bestCandidate.blob ?? dataUrlToBrowserBlob(bestCandidate.dataUrl);
    if (blob) return { blob, bytes: bestCandidate.bytes };
  }
  throw new Error(`图片已自动压缩，但仍超过当前上传上限 ${Math.ceil(limitBytes / 1024)}KB`);
}

export function createPageBackgroundUploadFile(blob: Blob, sourceFileName: string) {
  const baseName =
    sourceFileName
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "page-background";
  return new File([blob], `${baseName}.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
}

async function finalizeCompressedImageCandidate(candidate: {
  blob: Blob | null;
  dataUrl: string;
  bytes: number;
}) {
  return {
    dataUrl: candidate.blob ? await blobToDataUrl(candidate.blob) : candidate.dataUrl,
    bytes: candidate.bytes,
  };
}

export async function compressImageFileWithinLimit(
  file: File,
  limitBytes: number,
  options: BrowserImageCompressionOptions = DEFAULT_IMAGE_COMPRESSION_OPTIONS,
) {
  assertValidImageFile(file);
  const originalBytes = file.size || 0;
  if (originalBytes > 0 && originalBytes <= limitBytes) {
    const dataUrl = await fileToOriginalImageDataUrl(file, options);
    return {
      dataUrl,
      compressed: false,
      bytes: originalBytes || estimateDataUrlBytes(dataUrl),
    };
  }

  const image = await loadImageFromBlob(file);
  let plan = buildInitialImageCompressionPlan(originalBytes || limitBytes + 1, limitBytes);
  let bestCandidate: { blob: Blob | null; dataUrl: string; bytes: number } | null = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await yieldToBrowser();
    const candidate = await renderCompressedImageCandidate(image, plan.scale, plan.quality);
    if (!bestCandidate || candidate.bytes < bestCandidate.bytes) bestCandidate = candidate;
    if (candidate.bytes <= limitBytes) {
      const finalized = await finalizeCompressedImageCandidate(candidate);
      return {
        dataUrl: finalized.dataUrl,
        compressed: true,
        bytes: finalized.bytes,
      };
    }
    plan = refineImageCompressionPlan(plan, candidate.bytes, limitBytes);
  }

  if (bestCandidate) {
    const finalized = await finalizeCompressedImageCandidate(bestCandidate);
    return {
      dataUrl: finalized.dataUrl,
      compressed: true,
      bytes: finalized.bytes,
    };
  }

  const originalDataUrl = await fileToOriginalImageDataUrl(file, options);
  return {
    dataUrl: originalDataUrl,
    compressed: false,
    bytes: originalBytes || estimateDataUrlBytes(originalDataUrl),
  };
}

const SUPPORT_SELF_AVATAR_MAX_BYTES = 40 * 1024;
const SUPPORT_SELF_AVATAR_COMPRESSION_STEPS = [
  { maxSide: 384, quality: 0.9 },
  { maxSide: 320, quality: 0.86 },
  { maxSide: 288, quality: 0.82 },
  { maxSide: 256, quality: 0.78 },
  { maxSide: 224, quality: 0.72 },
  { maxSide: 192, quality: 0.66 },
  { maxSide: 160, quality: 0.6 },
  { maxSide: 128, quality: 0.52 },
] as const;

export async function compressSupportSelfAvatarFile(file: File) {
  if (file.size > 0 && file.size <= SUPPORT_SELF_AVATAR_MAX_BYTES) {
    return {
      dataUrl: await fileToDataUrl(file),
      bytes: file.size,
    };
  }

  const image = await loadImageFromBlob(file);
  const longestSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height, 1);
  let bestCandidate: { dataUrl: string; bytes: number } | null = null;
  for (const step of SUPPORT_SELF_AVATAR_COMPRESSION_STEPS) {
    await yieldToBrowser();
    const scale = Math.min(1, step.maxSide / longestSide);
    const finalized = await finalizeCompressedImageCandidate(
      await renderCompressedImageCandidate(image, scale, step.quality),
    );
    if (!bestCandidate || finalized.bytes < bestCandidate.bytes) {
      bestCandidate = finalized;
    }
    if (finalized.bytes <= SUPPORT_SELF_AVATAR_MAX_BYTES) {
      return finalized;
    }
  }

  const genericCompressed = await compressImageFileWithinLimit(file, SUPPORT_SELF_AVATAR_MAX_BYTES, {
    maxSide: SUPPORT_SELF_AVATAR_COMPRESSION_STEPS[0].maxSide,
    quality: SUPPORT_SELF_AVATAR_COMPRESSION_STEPS[0].quality,
  });
  if (genericCompressed.bytes <= SUPPORT_SELF_AVATAR_MAX_BYTES) {
    return {
      dataUrl: genericCompressed.dataUrl,
      bytes: genericCompressed.bytes,
    };
  }

  throw new Error(
    bestCandidate
      ? `头像已自动压缩到 ${Math.ceil(bestCandidate.bytes / 1024)}KB，但仍超过当前上传上限`
      : "头像自动压缩失败，请稍后重试",
  );
}

export async function fileToOriginalImageDataUrl(
  file: File,
  options: BrowserImageCompressionOptions = DEFAULT_IMAGE_COMPRESSION_OPTIONS,
): Promise<string> {
  assertValidImageFile(file);
  const dataUrl = await fileToDataUrl(file);
  if (dataUrl.length <= MAX_ORIGINAL_IMAGE_DATA_URL_LENGTH) return dataUrl;

  const compressedDataUrl = await compressImageDataUrl(dataUrl, options);
  if (compressedDataUrl.length > MAX_ORIGINAL_IMAGE_DATA_URL_LENGTH) {
    throw new Error("图片自动压缩后仍超过当前处理上限");
  }
  return compressedDataUrl;
}

export async function fileToOptimizedImageDataUrl(
  file: File,
  options: BrowserImageCompressionOptions,
): Promise<string> {
  assertValidImageFile(file);
  const originalDataUrl = await fileToDataUrl(file);
  const compressedDataUrl = await compressImageDataUrl(originalDataUrl, options);
  const candidate =
    compressedDataUrl.length > 0 && compressedDataUrl.length < originalDataUrl.length
      ? compressedDataUrl
      : originalDataUrl;
  if (candidate.length > MAX_ORIGINAL_IMAGE_DATA_URL_LENGTH) {
    throw new Error("图片自动压缩后仍超过当前处理上限");
  }
  return candidate;
}

export async function fileToAudioDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("audio/")) {
    throw new Error("请选择音频文件");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("音频读取失败，请重试"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("音频读取失败，请重试"));
    reader.readAsDataURL(file);
  });
  if (dataUrl.length > MAX_AUDIO_DATA_URL_LENGTH) {
    throw new Error("音频文件过大，请选择较小文件");
  }
  return dataUrl;
}

export async function uploadSourceUrlViaServerApiWithMetadata(
  sourceUrl: string,
  merchantHint = "public",
  folder = "merchant-assets",
  usage = "product-image",
  operation?: MerchantOperationContext,
): Promise<UploadedAssetMetadata | null> {
  try {
    const response = await runWithMerchantOperationContext(operation, () =>
      fetch("/api/assets/upload", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          sourceUrl,
          merchantHint,
          folder,
          usage,
        }),
      }),
    );
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as {
      url?: unknown;
      thumbnailUrl?: unknown;
      bucket?: unknown;
      thumbnailObjectPath?: unknown;
    } | null;
    const url = normalizePayloadText(payload?.url);
    const thumbnailUrl = normalizePayloadText(payload?.thumbnailUrl);
    if (!url && !thumbnailUrl) return null;
    return {
      url,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...optionalMetadataFields(payload),
    };
  } catch {
    return null;
  }
}

export async function uploadImageDataUrlToSupabase(
  dataUrl: string,
  merchantHint = "public",
  usage = "generic-image",
  operation?: MerchantOperationContext,
): Promise<string | null> {
  return (
    await uploadDataUrlViaServerApiWithMetadata(
      dataUrl,
      merchantHint,
      "merchant-assets",
      usage,
      operation,
    )
  )?.url ?? null;
}

export async function uploadImageDataUrlToSupabaseWithMetadata(
  dataUrl: string,
  merchantHint = "public",
  usage = "generic-image",
  operation?: MerchantOperationContext,
): Promise<UploadedAssetMetadata | null> {
  return uploadDataUrlViaServerApiWithMetadata(
    dataUrl,
    merchantHint,
    "merchant-assets",
    usage,
    operation,
  );
}

export async function uploadAudioDataUrlToSupabase(
  dataUrl: string,
  merchantHint = "public",
  operation?: MerchantOperationContext,
): Promise<string | null> {
  return (
    await uploadDataUrlViaServerApiWithMetadata(
      dataUrl,
      merchantHint,
      "merchant-audio",
      "audio",
      operation,
    )
  )?.url ?? null;
}

async function uploadDataUrlViaServerApiWithMetadata(
  dataUrl: string,
  merchantHint: string,
  folder: string,
  usage: string,
  operation?: MerchantOperationContext,
): Promise<UploadedAssetMetadata | null> {
  if (!/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) return null;
  try {
    const response = await runWithMerchantOperationContext(operation, () =>
      fetch("/api/assets/upload", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          dataUrl,
          merchantHint,
          folder,
          usage,
        }),
      }),
    );
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as {
      url?: unknown;
      thumbnailUrl?: unknown;
      posterUrl?: unknown;
      bucket?: unknown;
      objectPath?: unknown;
      thumbnailObjectPath?: unknown;
      posterObjectPath?: unknown;
    } | null;
    const url = normalizePayloadText(payload?.url);
    if (!url) return null;
    const thumbnailUrl = normalizePayloadText(payload?.thumbnailUrl);
    const posterUrl = normalizePayloadText(payload?.posterUrl);
    return {
      url,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(posterUrl ? { posterUrl } : {}),
      ...optionalMetadataFields(payload),
    };
  } catch {
    return null;
  }
}

function optionalMetadataFields(payload: {
  bucket?: unknown;
  objectPath?: unknown;
  thumbnailObjectPath?: unknown;
  posterObjectPath?: unknown;
} | null) {
  const bucket = normalizePayloadText(payload?.bucket);
  const objectPath = normalizePayloadText(payload?.objectPath);
  const thumbnailObjectPath = normalizePayloadText(payload?.thumbnailObjectPath);
  const posterObjectPath = normalizePayloadText(payload?.posterObjectPath);
  return {
    ...(bucket ? { bucket } : {}),
    ...(objectPath ? { objectPath } : {}),
    ...(thumbnailObjectPath ? { thumbnailObjectPath } : {}),
    ...(posterObjectPath ? { posterObjectPath } : {}),
  };
}

function normalizePayloadText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type RecompressStats = {
  visited: number;
  changed: number;
  failed: number;
  beforeBytes: number;
  afterBytes: number;
};

type ExternalizeStats = {
  visited: number;
  replaced: number;
  failed: number;
  beforeBytes: number;
  afterBytes: number;
};

type ProductThumbnailBackfillContext = {
  merchantHint: string;
  operation: MerchantOperationContext;
  stats: ProductThumbnailBackfillStats;
  cache: Map<string, string | null>;
  startedAt: number;
  maxGenerated: number;
  maxDurationMs: number;
};

function estimateUtf8Size(value: string) {
  return new TextEncoder().encode(value).length;
}

function formatAssetBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function collectLargeStringFields(
  value: unknown,
  path: string,
  output: Array<{ path: string; bytes: number }>,
  minBytes = 50 * 1024,
) {
  if (typeof value === "string") {
    const bytes = estimateUtf8Size(value);
    if (bytes >= minBytes) output.push({ path, bytes });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectLargeStringFields(item, `${path}[${index}]`, output, minBytes);
    });
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      collectLargeStringFields(child, `${path}.${key}`, output, minBytes);
    });
  }
}

export function getPublishSizeBreakdown(blocks: Block[]): PublishSizeBreakdown {
  const largeFields: PublishSizeBreakdown["largeFields"] = [];
  const blockTotals = blocks.map((block, index) => {
    const blockPath = `blocks[${index}](${block.type}:${block.id})`;
    collectLargeStringFields(block, blockPath, largeFields);
    return {
      path: blockPath,
      bytes: estimateUtf8Size(JSON.stringify(block)),
    };
  });

  largeFields.sort((a, b) => b.bytes - a.bytes);
  blockTotals.sort((a, b) => b.bytes - a.bytes);
  return {
    largeFields: largeFields.slice(0, 12),
    blockTotals: blockTotals.slice(0, 8),
  };
}

export function computePublishDiffSummary(
  nextBlocks: Block[],
  previousBlocks: Block[],
): PublishDiffSummary {
  const toKey = (block: Block) => `${block.type}:${block.id}`;
  const previousMap = new Map(previousBlocks.map((block) => [toKey(block), JSON.stringify(block)]));
  const nextMap = new Map(nextBlocks.map((block) => [toKey(block), JSON.stringify(block)]));
  let changedCount = 0;
  let addedCount = 0;
  let removedCount = 0;
  const changedPaths: string[] = [];

  nextBlocks.forEach((block, index) => {
    const key = toKey(block);
    const before = previousMap.get(key);
    if (!before) {
      addedCount += 1;
      changedPaths.push(`blocks[${index}](${key})`);
      return;
    }
    if (before !== nextMap.get(key)) {
      changedCount += 1;
      changedPaths.push(`blocks[${index}](${key})`);
    }
  });

  previousBlocks.forEach((block) => {
    if (!nextMap.has(toKey(block))) removedCount += 1;
  });

  return { changedCount, addedCount, removedCount, changedPaths: changedPaths.slice(0, 8) };
}

export function runPublishPreflight(
  blocks: Block[],
  payloadBytes: number,
  maxPayloadBytes = 30_000_000,
): PublishPreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (payloadBytes > maxPayloadBytes) {
    warnings.push(
      `发布体积接近或超过上限：${formatAssetBytes(payloadBytes)} / ${formatAssetBytes(maxPayloadBytes)}`,
    );
  }

  const inlineAssets = countInlineAssets(blocks);
  let maybeBrokenLinkCount = 0;

  blocks.forEach((block) => {
    if (block.type === "gallery" && (!Array.isArray(block.props.images) || block.props.images.length === 0)) {
      warnings.push(`相册区块为空：${block.id}`);
    }
    if (block.type === "music" && !((block.props.audioUrl ?? "").trim())) {
      warnings.push(`音乐区块未设置音频：${block.id}`);
    }
    if (block.type === "chart" && (block.props.labels?.length ?? 0) !== (block.props.values?.length ?? 0)) {
      warnings.push(`图表标签和值数量不一致：${block.id}`);
    }
    if (block.type === "contact") {
      const email = (block.props.email ?? "").trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) maybeBrokenLinkCount += 1;
      const socialLinks = [
        block.props.instagram,
        block.props.tiktok,
        block.props.twitter,
        block.props.telegram,
        block.props.linkedin,
      ];
      socialLinks.forEach((value) => {
        if (typeof value === "string" && /\s/.test(value.trim())) maybeBrokenLinkCount += 1;
      });
    }
  });

  if (inlineAssets.imageCount >= 24) warnings.push(`内嵌图片较多：${inlineAssets.imageCount} 张，建议外链或批量压缩`);
  if (inlineAssets.audioCount >= 2) warnings.push(`内嵌音频较多：${inlineAssets.audioCount} 个，建议外链`);
  if (maybeBrokenLinkCount > 0) warnings.push(`检测到 ${maybeBrokenLinkCount} 条联系方式可能无法跳转`);

  return { errors, warnings };
}

export function formatInlineAssetStatsText(stats: InlineAssetStats) {
  const parts: string[] = [];
  if (stats.imageCount > 0) parts.push(`图片 ${stats.imageCount}`);
  if (stats.audioCount > 0) parts.push(`音频 ${stats.audioCount}`);
  return parts.join("，") || "未知资源";
}

export function buildInlineAssetsRecoveryMessage(stats: InlineAssetStats) {
  const assetText = formatInlineAssetStatsText(stats);
  return [
    `发布没有完成：系统已自动尝试多档压缩和外链化，但仍有未上传成功的资源（${assetText}）。`,
    "",
    "可操作处理方法：",
    "1. 先重新点击发布。若只是网络或后端临时不稳定，第二次通常会自动上传成功。",
    "2. 若仍失败，找到最近新增或替换的图片/音频，重新上传一次，再发布；系统会自动选择合适压缩档。",
    "3. 管理员需要检查上传接口 /api/assets/upload、Supabase Storage 的 page-assets 存储桶和服务端密钥配置。",
  ].join("\n");
}

function areSameBlockSnapshots(left: Block[], right: Block[]) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function isRecordValue(input: unknown): input is Record<string, unknown> {
  return Boolean(input && typeof input === "object" && !Array.isArray(input));
}

function isPotentialPublicStorageProductImageUrl(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || /^(data|blob):/i.test(trimmed)) return false;
  try {
    const url = new URL(trimmed, typeof window === "undefined" ? "https://faolla.com" : window.location.origin);
    const hostname = url.hostname.toLowerCase();
    const allowedHost =
      hostname === "faolla.com" ||
      hostname.endsWith(".faolla.com") ||
      hostname.endsWith(".supabase.co") ||
      hostname === "localhost" ||
      hostname === "127.0.0.1";
    return allowedHost && url.pathname.startsWith("/storage/v1/object/public/");
  } catch {
    return false;
  }
}

async function generateProductThumbnailForExistingImage(
  imageUrl: string,
  context: ProductThumbnailBackfillContext,
) {
  const sourceUrl = normalizePublicAssetUrl(String(imageUrl ?? "").trim());
  if (!isPotentialPublicStorageProductImageUrl(sourceUrl)) {
    return null;
  }
  if (context.cache.has(sourceUrl)) {
    return context.cache.get(sourceUrl) ?? null;
  }
  const uploaded = await uploadSourceUrlViaServerApiWithMetadata(
    sourceUrl,
    context.merchantHint || "public",
    "merchant-assets",
    "product-image",
    context.operation,
  );
  const thumbnailUrl = String(uploaded?.thumbnailUrl ?? "").trim();
  context.cache.set(sourceUrl, thumbnailUrl || null);
  return thumbnailUrl || null;
}

async function backfillProductThumbnailsInProductList(
  products: unknown[],
  context: ProductThumbnailBackfillContext,
) {
  let changed = false;
  const nextProducts: unknown[] = [];

  for (const product of products) {
    if (!isRecordValue(product)) {
      nextProducts.push(product);
      continue;
    }

    const imageUrl = String(product.imageUrl ?? "").trim();
    const thumbnailUrl = String(product.thumbnailUrl ?? "").trim();
    if (!imageUrl || thumbnailUrl) {
      nextProducts.push(product);
      continue;
    }

    context.stats.visited += 1;
    if (!isPotentialPublicStorageProductImageUrl(normalizePublicAssetUrl(imageUrl))) {
      context.stats.skipped += 1;
      nextProducts.push(product);
      continue;
    }
    if (context.stats.generated >= context.maxGenerated || Date.now() - context.startedAt > context.maxDurationMs) {
      context.stats.limited += 1;
      nextProducts.push(product);
      continue;
    }

    try {
      const generatedThumbnailUrl = await generateProductThumbnailForExistingImage(imageUrl, context);
      if (generatedThumbnailUrl) {
        context.stats.generated += 1;
        changed = true;
        nextProducts.push({
          ...product,
          thumbnailUrl: generatedThumbnailUrl,
        });
      } else {
        context.stats.failed += 1;
        nextProducts.push(product);
      }
    } catch {
      context.stats.failed += 1;
      nextProducts.push(product);
    }
  }

  return { products: changed ? nextProducts : products, changed };
}

async function backfillProductThumbnailsUnknown(
  input: unknown,
  context: ProductThumbnailBackfillContext,
): Promise<{ value: unknown; changed: boolean }> {
  if (Array.isArray(input)) {
    let changed = false;
    const value: unknown[] = [];
    for (const item of input) {
      const next = await backfillProductThumbnailsUnknown(item, context);
      changed ||= next.changed;
      value.push(next.value);
    }
    return { value: changed ? value : input, changed };
  }

  if (!isRecordValue(input)) return { value: input, changed: false };

  let changed = false;
  let nextRecord: Record<string, unknown> = input;
  if (input.type === "product" && isRecordValue(input.props) && Array.isArray(input.props.products)) {
    const nextProducts = await backfillProductThumbnailsInProductList(input.props.products, context);
    if (nextProducts.changed) {
      changed = true;
      nextRecord = {
        ...nextRecord,
        props: {
          ...input.props,
          products: nextProducts.products,
        },
      };
    }
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(nextRecord)) {
    const next = await backfillProductThumbnailsUnknown(value, context);
    changed ||= next.changed;
    output[key] = next.value;
  }

  return { value: changed ? output : input, changed };
}

export async function backfillProductThumbnailsInBlocks(
  blocks: Block[],
  merchantHint: string,
  cache: Map<string, string | null>,
) {
  const operation = {
    operationModule: "网站编辑 > 发布",
    operationAction: "补齐产品缩略图",
    operationSummary: "发布网站时为旧产品图片生成缩略图",
  };
  const context: ProductThumbnailBackfillContext = {
    merchantHint,
    operation,
    stats: {
      visited: 0,
      generated: 0,
      failed: 0,
      skipped: 0,
      limited: 0,
    },
    cache,
    startedAt: Date.now(),
    maxGenerated: 12,
    maxDurationMs: 6_000,
  };
  const next = await backfillProductThumbnailsUnknown(blocks, context);
  return {
    blocks: (Array.isArray(next.value) ? next.value : blocks) as Block[],
    changed: next.changed,
    stats: context.stats,
  };
}

async function recompressInlineImagesUnknown(
  input: unknown,
  options: BrowserImageCompressionOptions,
  stats: RecompressStats,
): Promise<unknown> {
  if (typeof input === "string") {
    if (!/^data:image\//i.test(input)) return input;
    stats.visited += 1;
    const beforeBytes = estimateUtf8Size(input);
    stats.beforeBytes += beforeBytes;
    try {
      const compressed = await compressImageDataUrl(input, options);
      const output = compressed.length > 0 ? compressed : input;
      const afterBytes = estimateUtf8Size(output);
      stats.afterBytes += afterBytes;
      if (output !== input) stats.changed += 1;
      return output;
    } catch {
      stats.failed += 1;
      stats.afterBytes += beforeBytes;
      return input;
    }
  }

  if (Array.isArray(input)) {
    const next: unknown[] = [];
    for (const item of input) {
      next.push(await recompressInlineImagesUnknown(item, options, stats));
    }
    return next;
  }

  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const nextRecord: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      nextRecord[key] = await recompressInlineImagesUnknown(value, options, stats);
    }
    return nextRecord;
  }

  return input;
}

async function recompressInlineImagesInBlocks(
  blocks: Block[],
  options: BrowserImageCompressionOptions,
): Promise<{ blocks: Block[]; stats: RecompressStats }> {
  const stats: RecompressStats = {
    visited: 0,
    changed: 0,
    failed: 0,
    beforeBytes: 0,
    afterBytes: 0,
  };
  const next = (await recompressInlineImagesUnknown(blocks, options, stats)) as Block[];
  return { blocks: next, stats };
}

async function externalizeInlineImagesUnknown(
  input: unknown,
  merchantHint: string,
  stats: ExternalizeStats,
  minBytes: number,
  operation: MerchantOperationContext | undefined,
): Promise<unknown> {
  if (typeof input === "string") {
    if (!/^data:image\//i.test(input)) return input;
    const bytes = estimateUtf8Size(input);
    if (bytes < minBytes) return input;
    stats.visited += 1;
    stats.beforeBytes += bytes;
    try {
      const url = await uploadImageDataUrlToSupabase(input, merchantHint, "generic-image", operation);
      if (!url) {
        stats.failed += 1;
        stats.afterBytes += bytes;
        return input;
      }
      stats.replaced += 1;
      stats.afterBytes += estimateUtf8Size(url);
      return url;
    } catch {
      stats.failed += 1;
      stats.afterBytes += bytes;
      return input;
    }
  }
  if (Array.isArray(input)) {
    const next: unknown[] = [];
    for (const item of input) {
      next.push(await externalizeInlineImagesUnknown(item, merchantHint, stats, minBytes, operation));
    }
    return next;
  }
  if (input && typeof input === "object") {
    const nextRecord: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      nextRecord[key] = await externalizeInlineImagesUnknown(value, merchantHint, stats, minBytes, operation);
    }
    return nextRecord;
  }
  return input;
}

async function externalizeInlineImagesInBlocks(
  blocks: Block[],
  merchantHint: string,
  minBytes = EXTERNALIZE_MIN_IMAGE_BYTES,
  operation?: MerchantOperationContext,
) {
  const stats: ExternalizeStats = {
    visited: 0,
    replaced: 0,
    failed: 0,
    beforeBytes: 0,
    afterBytes: 0,
  };
  const next = (await externalizeInlineImagesUnknown(blocks, merchantHint, stats, minBytes, operation)) as Block[];
  return { blocks: next, stats };
}

async function externalizeInlineAudioUnknown(
  input: unknown,
  merchantHint: string,
  stats: ExternalizeStats,
  operation: MerchantOperationContext | undefined,
): Promise<unknown> {
  if (typeof input === "string") {
    if (!/^data:audio\//i.test(input)) return input;
    const bytes = estimateUtf8Size(input);
    stats.visited += 1;
    stats.beforeBytes += bytes;
    try {
      const url = await uploadAudioDataUrlToSupabase(input, merchantHint, operation);
      if (!url) {
        stats.failed += 1;
        stats.afterBytes += bytes;
        return input;
      }
      stats.replaced += 1;
      stats.afterBytes += estimateUtf8Size(url);
      return url;
    } catch {
      stats.failed += 1;
      stats.afterBytes += bytes;
      return input;
    }
  }

  if (Array.isArray(input)) {
    const next: unknown[] = [];
    for (const item of input) {
      next.push(await externalizeInlineAudioUnknown(item, merchantHint, stats, operation));
    }
    return next;
  }

  if (input && typeof input === "object") {
    const nextRecord: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      nextRecord[key] = await externalizeInlineAudioUnknown(value, merchantHint, stats, operation);
    }
    return nextRecord;
  }

  return input;
}

async function externalizeInlineAudioInBlocks(
  blocks: Block[],
  merchantHint: string,
  operation?: MerchantOperationContext,
) {
  const stats: ExternalizeStats = {
    visited: 0,
    replaced: 0,
    failed: 0,
    beforeBytes: 0,
    afterBytes: 0,
  };
  const next = (await externalizeInlineAudioUnknown(blocks, merchantHint, stats, operation)) as Block[];
  return { blocks: next, stats };
}

function getPublishCompressionSequence(startPreset: PublishUploadCompressionPreset) {
  const startIndex = PUBLISH_AUTO_COMPRESSION_OPTIONS.findIndex((item) => item.id === startPreset);
  return PUBLISH_AUTO_COMPRESSION_OPTIONS.slice(Math.max(0, startIndex));
}

export async function optimizeBlocksForPublishIfNeeded(
  blocks: Block[],
  options: {
    merchantHint: string;
    uploadCompressionPreset: PublishUploadCompressionPreset;
    targetPayloadBytes?: number | null;
  },
): Promise<PublishOptimizationResult> {
  const originalBytes = estimateUtf8Size(JSON.stringify(blocks));
  if (!hasInlineAssets(blocks)) {
    return {
      blocks,
      optimized: false,
      summary: null,
    };
  }

  const targetPayloadBytes =
    typeof options.targetPayloadBytes === "number" && Number.isFinite(options.targetPayloadBytes)
      ? Math.max(1, Math.floor(options.targetPayloadBytes))
      : null;
  const compressionSequence = getPublishCompressionSequence(options.uploadCompressionPreset);
  let bestBlocks = blocks;
  let bestBytes = originalBytes;
  let bestInlineAssets = countInlineAssets(blocks);
  let bestLabel = "";
  let bestSummary = "";

  for (const compressionOption of compressionSequence) {
    const recompressed = await recompressInlineImagesInBlocks(blocks, compressionOption);
    const publishUploadOperation = {
      operationModule: "网站编辑 > 发布",
      operationAction: "上传发布资源",
      operationSummary: "发布网站时上传页面内联图片或音频资源",
    };
    const externalized = await externalizeInlineImagesInBlocks(
      recompressed.blocks,
      options.merchantHint || "public",
      1,
      publishUploadOperation,
    );
    const audioExternalized = await externalizeInlineAudioInBlocks(
      externalized.blocks,
      options.merchantHint || "public",
      publishUploadOperation,
    );
    const nextBlocks = audioExternalized.blocks;
    const nextBytes = estimateUtf8Size(JSON.stringify(nextBlocks));
    const nextInlineAssets = countInlineAssets(nextBlocks);
    const isBetter =
      nextInlineAssets.totalCount < bestInlineAssets.totalCount ||
      (nextInlineAssets.totalCount === bestInlineAssets.totalCount && nextBytes < bestBytes);
    if (isBetter) {
      bestBlocks = nextBlocks;
      bestBytes = nextBytes;
      bestInlineAssets = nextInlineAssets;
      bestLabel = compressionOption.label;
      bestSummary = `压缩图片 ${recompressed.stats.changed}/${recompressed.stats.visited}，外链图片 ${externalized.stats.replaced}/${externalized.stats.visited}，外链音频 ${audioExternalized.stats.replaced}/${audioExternalized.stats.visited}`;
    }
    if (nextInlineAssets.totalCount === 0 && (!targetPayloadBytes || nextBytes <= targetPayloadBytes)) {
      bestBlocks = nextBlocks;
      bestBytes = nextBytes;
      bestInlineAssets = nextInlineAssets;
      bestLabel = compressionOption.label;
      bestSummary = `压缩图片 ${recompressed.stats.changed}/${recompressed.stats.visited}，外链图片 ${externalized.stats.replaced}/${externalized.stats.visited}，外链音频 ${audioExternalized.stats.replaced}/${audioExternalized.stats.visited}`;
      break;
    }
  }

  const optimized = !areSameBlockSnapshots(bestBlocks, blocks);

  return {
    blocks: bestBlocks,
    optimized,
    summary: optimized
      ? `发布前已自动优化资源：${formatAssetBytes(originalBytes)} -> ${formatAssetBytes(bestBytes)}${bestLabel ? `（${bestLabel}，${bestSummary}）` : ""}`
      : null,
  };
}

function assertValidImageFile(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error("图片文件过大，请选择 10MB 以内图片");
  }
}
