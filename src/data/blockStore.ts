import type { Block } from "./homeBlocks";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";
import { canonicalizeEditorBlocksSystemDefaults } from "@/lib/editorSystemDefaults";

const DRAFT_KEY = "merchant-space:homeBlocks:draft:v2";
const PUBLISHED_KEY = "merchant-space:homeBlocks:published:v1";
const DRAFT_STORE_EVENT = "merchant-space:blocks-draft-changed";
const PUBLISHED_STORE_EVENT = "merchant-space:blocks-published-changed";
const PUBLISHED_HISTORY_KEY = "merchant-space:homeBlocks:published-history:v1";
const LATEST_SAVED_DRAFT_SNAPSHOT_KEY = "merchant-space:latest-saved-draft-snapshot:v1";
const PUBLISH_FAILURE_SNAPSHOTS_KEY = "merchant-space:publish-failure-snapshots:v1";
const MAX_PUBLISH_FAILURE_SNAPSHOTS = 12;
const MAX_PUBLISHED_HISTORY = 2;
const MAX_RAW_STORAGE_LENGTH = 12_000_000;

export type BlocksStoreScope = string | undefined;
const DEFAULT_SCOPE = "default";
const draftCacheByKey = new Map<string, { raw: string | null | undefined; parsed: Block[] | undefined }>();
const publishedCacheByKey = new Map<string, { raw: string | null | undefined; parsed: Block[] | undefined }>();

type PublishFailureSnapshot = {
  id: string;
  at: string;
  reason: string;
  bytes: number;
  blocks: Block[];
};

type PublishedHistorySnapshot = {
  id: string;
  at: string;
  bytes: number;
  blocks: Block[];
};

type SavedDraftSnapshot = {
  id: string;
  at: string;
  blocks: Block[];
};

function scopeToken(scope?: BlocksStoreScope) {
  const normalized = (scope ?? "").trim();
  if (!normalized) return DEFAULT_SCOPE;
  return normalized.replace(/[^a-zA-Z0-9:_-]/g, "_");
}

function scopedKey(baseKey: string, scope?: BlocksStoreScope) {
  const token = scopeToken(scope);
  return token === DEFAULT_SCOPE ? baseKey : `${baseKey}:${token}`;
}

function scopedEvent(baseEvent: string, scope?: BlocksStoreScope) {
  const token = scopeToken(scope);
  return token === DEFAULT_SCOPE ? baseEvent : `${baseEvent}:${token}`;
}

function loadBlocksByKey(key: string, fallback: Block[]): Block[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    if (raw.length > MAX_RAW_STORAGE_LENGTH) {
      localStorage.removeItem(key);
      return fallback;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    if (parsed.length > 0 && !parsed[0]?.id) return fallback;
    const sanitized = sanitizeBlocksForRuntime(parsed as Block[]);
    const canonicalized = canonicalizeEditorBlocksSystemDefaults(sanitized.blocks);
    const shouldRewrite =
      sanitized.removed > 0 || JSON.stringify(canonicalized) !== JSON.stringify(sanitized.blocks);
    if (shouldRewrite) {
      try {
        localStorage.setItem(key, JSON.stringify(canonicalized));
      } catch {
        // ignore cache rewrite errors
      }
    }
    return canonicalized;
  } catch {
    return fallback;
  }
}

function saveBlocksByKey(key: string, eventName: string, blocks: Block[]) {
  if (typeof window === "undefined") return;
  try {
    const sanitized = sanitizeBlocksForRuntime(blocks);
    const canonicalized = canonicalizeEditorBlocksSystemDefaults(sanitized.blocks);
    const raw = JSON.stringify(canonicalized);
    localStorage.setItem(key, raw);
    window.dispatchEvent(new Event(eventName));
  } catch {
    // Ignore local cache write failures (e.g. quota exceeded).
  }
}

function subscribeByKey(key: string, eventName: string, onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === key) onChange();
  };
  const onCustom = () => onChange();

  window.addEventListener("storage", onStorage);
  window.addEventListener(eventName, onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(eventName, onCustom);
  };
}

export function loadBlocksFromStorage(fallback: Block[], scope?: BlocksStoreScope): Block[] {
  return loadBlocksByKey(scopedKey(DRAFT_KEY, scope), fallback);
}

export function saveBlocksToStorage(blocks: Block[], scope?: BlocksStoreScope) {
  const key = scopedKey(DRAFT_KEY, scope);
  saveBlocksByKey(key, scopedEvent(DRAFT_STORE_EVENT, scope), blocks);
  draftCacheByKey.set(key, {
    raw: typeof window === "undefined" ? null : localStorage.getItem(key),
    parsed: canonicalizeEditorBlocksSystemDefaults(sanitizeBlocksForRuntime(blocks).blocks),
  });
}

export function loadPublishedBlocksFromStorage(fallback: Block[], scope?: BlocksStoreScope): Block[] {
  return loadBlocksByKey(scopedKey(PUBLISHED_KEY, scope), fallback);
}

export function savePublishedBlocksToStorage(blocks: Block[], scope?: BlocksStoreScope) {
  const key = scopedKey(PUBLISHED_KEY, scope);
  saveBlocksByKey(key, scopedEvent(PUBLISHED_STORE_EVENT, scope), blocks);
  publishedCacheByKey.set(key, {
    raw: typeof window === "undefined" ? null : localStorage.getItem(key),
    parsed: canonicalizeEditorBlocksSystemDefaults(sanitizeBlocksForRuntime(blocks).blocks),
  });
}

function estimateUtf8Size(text: string) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return text.length;
}

function blocksStableHash(blocks: Block[]) {
  try {
    return JSON.stringify(sanitizeBlocksForRuntime(blocks).blocks);
  } catch {
    return "";
  }
}

function readPublishedHistoryRaw(scope?: BlocksStoreScope): PublishedHistorySnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(scopedKey(PUBLISHED_HISTORY_KEY, scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const items: PublishedHistorySnapshot[] = [];
    parsed.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const record = item as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.at !== "string") return;
      if (!Array.isArray(record.blocks)) return;
      const bytes = typeof record.bytes === "number" && Number.isFinite(record.bytes) ? Math.max(0, Math.round(record.bytes)) : 0;
      items.push({
        id: record.id,
        at: record.at,
        bytes,
        blocks: sanitizeBlocksForRuntime(record.blocks as Block[]).blocks,
      });
    });
    return items.slice(0, MAX_PUBLISHED_HISTORY);
  } catch {
    return [];
  }
}

function writePublishedHistoryRaw(items: PublishedHistorySnapshot[], scope?: BlocksStoreScope) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(scopedKey(PUBLISHED_HISTORY_KEY, scope), JSON.stringify(items.slice(0, MAX_PUBLISHED_HISTORY)));
  } catch {
    // ignore storage write failures
  }
}

function ensurePublishedHistorySeeded(scope?: BlocksStoreScope) {
  if (typeof window === "undefined") return;
  const currentHistory = readPublishedHistoryRaw(scope);
  if (currentHistory.length > 0) return;
  const currentPublished = loadPublishedBlocksFromStorage([], scope);
  if (!Array.isArray(currentPublished) || currentPublished.length === 0) return;
  const raw = JSON.stringify(currentPublished);
  const seed: PublishedHistorySnapshot = {
    id: `seed-${Date.now()}`,
    at: new Date().toISOString(),
    bytes: estimateUtf8Size(raw),
    blocks: currentPublished,
  };
  writePublishedHistoryRaw([seed], scope);
}

export function recordPublishedVersion(blocks: Block[], scope?: BlocksStoreScope) {
  if (typeof window === "undefined") return;
  ensurePublishedHistorySeeded(scope);
  const sanitized = sanitizeBlocksForRuntime(blocks).blocks;
  const current = readPublishedHistoryRaw(scope);
  const nextHash = blocksStableHash(sanitized);
  const latestHash = current[0] ? blocksStableHash(current[0].blocks) : "";
  if (nextHash && nextHash === latestHash) return;
  const raw = JSON.stringify(sanitized);
  const snapshot: PublishedHistorySnapshot = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    bytes: estimateUtf8Size(raw),
    blocks: sanitized,
  };
  writePublishedHistoryRaw([snapshot, ...current], scope);
}

export function rollbackToPreviousPublishedVersion(scope?: BlocksStoreScope): Block[] | null {
  if (typeof window === "undefined") return null;
  ensurePublishedHistorySeeded(scope);
  const current = readPublishedHistoryRaw(scope);
  if (current.length < 2) return null;
  const [, target] = current;
  return target.blocks;
}

export function saveLatestDraftSnapshot(blocks: Block[], scope?: BlocksStoreScope) {
  if (typeof window === "undefined") return;
  try {
    const sanitized = canonicalizeEditorBlocksSystemDefaults(sanitizeBlocksForRuntime(blocks).blocks);
    const snapshot: SavedDraftSnapshot = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      blocks: sanitized,
    };
    localStorage.setItem(scopedKey(LATEST_SAVED_DRAFT_SNAPSHOT_KEY, scope), JSON.stringify(snapshot));
  } catch {
    // Ignore local cache write failures.
  }
}

export function readLatestDraftSnapshot(scope?: BlocksStoreScope): SavedDraftSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(scopedKey(LATEST_SAVED_DRAFT_SNAPSHOT_KEY, scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.at !== "string") return null;
    if (!Array.isArray(record.blocks)) return null;
    return {
      id: record.id,
      at: record.at,
      blocks: canonicalizeEditorBlocksSystemDefaults(sanitizeBlocksForRuntime(record.blocks as Block[]).blocks),
    };
  } catch {
    return null;
  }
}

export function clearBlocksStorage(scope?: BlocksStoreScope) {
  if (typeof window === "undefined") return;
  const key = scopedKey(DRAFT_KEY, scope);
  localStorage.removeItem(key);
  draftCacheByKey.delete(key);
  window.dispatchEvent(new Event(scopedEvent(DRAFT_STORE_EVENT, scope)));
}

export function clearPublishedBlocksStorage(scope?: BlocksStoreScope) {
  if (typeof window === "undefined") return;
  const key = scopedKey(PUBLISHED_KEY, scope);
  localStorage.removeItem(key);
  publishedCacheByKey.delete(key);
  window.dispatchEvent(new Event(scopedEvent(PUBLISHED_STORE_EVENT, scope)));
}

export function subscribeBlocksStore(onChange: () => void, scope?: BlocksStoreScope): () => void {
  return subscribeByKey(scopedKey(DRAFT_KEY, scope), scopedEvent(DRAFT_STORE_EVENT, scope), onChange);
}

export function subscribePublishedBlocksStore(onChange: () => void, scope?: BlocksStoreScope): () => void {
  return subscribeByKey(scopedKey(PUBLISHED_KEY, scope), scopedEvent(PUBLISHED_STORE_EVENT, scope), onChange);
}

export function getBlocksSnapshot(fallback: Block[], scope?: BlocksStoreScope): Block[] {
  if (typeof window === "undefined") return fallback;
  const key = scopedKey(DRAFT_KEY, scope);
  const cached = draftCacheByKey.get(key);
  const raw = localStorage.getItem(key);
  if (cached && raw === cached.raw && cached.parsed) return cached.parsed;
  const parsed = loadBlocksFromStorage(fallback, scope);
  draftCacheByKey.set(key, { raw, parsed });
  return parsed;
}

export function getPublishedBlocksSnapshot(fallback: Block[], scope?: BlocksStoreScope): Block[] {
  if (typeof window === "undefined") return fallback;
  const key = scopedKey(PUBLISHED_KEY, scope);
  const cached = publishedCacheByKey.get(key);
  const raw = localStorage.getItem(key);
  if (cached && raw === cached.raw && cached.parsed) return cached.parsed;
  const parsed = loadPublishedBlocksFromStorage(fallback, scope);
  publishedCacheByKey.set(key, { raw, parsed });
  return parsed;
}

export function savePublishFailureSnapshot(input: {
  reason: string;
  bytes: number;
  blocks: Block[];
}, scope?: BlocksStoreScope) {
  if (typeof window === "undefined") return;
  try {
    const current = readPublishFailureSnapshots(scope);
    const sanitized = sanitizeBlocksForRuntime(input.blocks).blocks;
    const nextItem: PublishFailureSnapshot = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      reason: (input.reason || "发布失败").trim().slice(0, 280),
      bytes: Math.max(0, Math.round(input.bytes)),
      blocks: sanitized,
    };
    const next = [nextItem, ...current].slice(0, MAX_PUBLISH_FAILURE_SNAPSHOTS);
    localStorage.setItem(scopedKey(PUBLISH_FAILURE_SNAPSHOTS_KEY, scope), JSON.stringify(next));
  } catch {
    // Ignore local cache write failures.
  }
}

export function readPublishFailureSnapshots(scope?: BlocksStoreScope): PublishFailureSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(scopedKey(PUBLISH_FAILURE_SNAPSHOTS_KEY, scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const items: PublishFailureSnapshot[] = [];
    parsed.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const record = item as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.at !== "string") return;
      if (typeof record.reason !== "string") return;
      if (!Array.isArray(record.blocks)) return;
      const bytes = typeof record.bytes === "number" && Number.isFinite(record.bytes) ? Math.max(0, Math.round(record.bytes)) : 0;
      items.push({
        id: record.id,
        at: record.at,
        reason: record.reason,
        bytes,
        blocks: sanitizeBlocksForRuntime(record.blocks as Block[]).blocks,
      });
    });
    return items.slice(0, MAX_PUBLISH_FAILURE_SNAPSHOTS);
  } catch {
    return [];
  }
}

export function clearPublishFailureSnapshots(scope?: BlocksStoreScope) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(scopedKey(PUBLISH_FAILURE_SNAPSHOTS_KEY, scope));
  } catch {
    // ignore storage write failures
  }
}
