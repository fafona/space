import type { Block } from "./homeBlocks";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";

const DRAFT_KEY = "merchant-space:homeBlocks:draft:v2";
const PUBLISHED_KEY = "merchant-space:homeBlocks:published:v1";
const DRAFT_STORE_EVENT = "merchant-space:blocks-draft-changed";
const PUBLISHED_STORE_EVENT = "merchant-space:blocks-published-changed";
const PUBLISH_FAILURE_SNAPSHOTS_KEY = "merchant-space:publish-failure-snapshots:v1";
const MAX_PUBLISH_FAILURE_SNAPSHOTS = 12;
const MAX_RAW_STORAGE_LENGTH = 12_000_000;

let lastDraftRaw: string | null | undefined;
let lastDraftParsed: Block[] | undefined;
let lastPublishedRaw: string | null | undefined;
let lastPublishedParsed: Block[] | undefined;

type PublishFailureSnapshot = {
  id: string;
  at: string;
  reason: string;
  bytes: number;
  blocks: Block[];
};

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
    if (sanitized.removed > 0) {
      try {
        localStorage.setItem(key, JSON.stringify(sanitized.blocks));
      } catch {
        // ignore cache rewrite errors
      }
    }
    return sanitized.blocks;
  } catch {
    return fallback;
  }
}

function saveBlocksByKey(key: string, eventName: string, blocks: Block[]) {
  if (typeof window === "undefined") return;
  try {
    const sanitized = sanitizeBlocksForRuntime(blocks);
    const raw = JSON.stringify(sanitized.blocks);
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

export function loadBlocksFromStorage(fallback: Block[]): Block[] {
  return loadBlocksByKey(DRAFT_KEY, fallback);
}

export function saveBlocksToStorage(blocks: Block[]) {
  saveBlocksByKey(DRAFT_KEY, DRAFT_STORE_EVENT, blocks);
  lastDraftRaw = typeof window === "undefined" ? null : localStorage.getItem(DRAFT_KEY);
  lastDraftParsed = sanitizeBlocksForRuntime(blocks).blocks;
}

export function loadPublishedBlocksFromStorage(fallback: Block[]): Block[] {
  return loadBlocksByKey(PUBLISHED_KEY, fallback);
}

export function savePublishedBlocksToStorage(blocks: Block[]) {
  saveBlocksByKey(PUBLISHED_KEY, PUBLISHED_STORE_EVENT, blocks);
  lastPublishedRaw = typeof window === "undefined" ? null : localStorage.getItem(PUBLISHED_KEY);
  lastPublishedParsed = sanitizeBlocksForRuntime(blocks).blocks;
}

export function clearBlocksStorage() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DRAFT_KEY);
  lastDraftRaw = null;
  lastDraftParsed = undefined;
  window.dispatchEvent(new Event(DRAFT_STORE_EVENT));
}

export function clearPublishedBlocksStorage() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PUBLISHED_KEY);
  lastPublishedRaw = null;
  lastPublishedParsed = undefined;
  window.dispatchEvent(new Event(PUBLISHED_STORE_EVENT));
}

export function subscribeBlocksStore(onChange: () => void): () => void {
  return subscribeByKey(DRAFT_KEY, DRAFT_STORE_EVENT, onChange);
}

export function subscribePublishedBlocksStore(onChange: () => void): () => void {
  return subscribeByKey(PUBLISHED_KEY, PUBLISHED_STORE_EVENT, onChange);
}

export function getBlocksSnapshot(fallback: Block[]): Block[] {
  if (typeof window === "undefined") return fallback;

  const raw = localStorage.getItem(DRAFT_KEY);
  if (raw === lastDraftRaw && lastDraftParsed) return lastDraftParsed;

  const parsed = loadBlocksFromStorage(fallback);
  lastDraftRaw = raw;
  lastDraftParsed = parsed;
  return parsed;
}

export function getPublishedBlocksSnapshot(fallback: Block[]): Block[] {
  if (typeof window === "undefined") return fallback;

  const raw = localStorage.getItem(PUBLISHED_KEY);
  if (raw === lastPublishedRaw && lastPublishedParsed) return lastPublishedParsed;

  const parsed = loadPublishedBlocksFromStorage(fallback);
  lastPublishedRaw = raw;
  lastPublishedParsed = parsed;
  return parsed;
}

export function savePublishFailureSnapshot(input: {
  reason: string;
  bytes: number;
  blocks: Block[];
}) {
  if (typeof window === "undefined") return;
  try {
    const current = readPublishFailureSnapshots();
    const sanitized = sanitizeBlocksForRuntime(input.blocks).blocks;
    const nextItem: PublishFailureSnapshot = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      reason: (input.reason || "发布失败").trim().slice(0, 280),
      bytes: Math.max(0, Math.round(input.bytes)),
      blocks: sanitized,
    };
    const next = [nextItem, ...current].slice(0, MAX_PUBLISH_FAILURE_SNAPSHOTS);
    localStorage.setItem(PUBLISH_FAILURE_SNAPSHOTS_KEY, JSON.stringify(next));
  } catch {
    // Ignore local cache write failures.
  }
}

export function readPublishFailureSnapshots(): PublishFailureSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PUBLISH_FAILURE_SNAPSHOTS_KEY);
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

export function clearPublishFailureSnapshots() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PUBLISH_FAILURE_SNAPSHOTS_KEY);
  } catch {
    // ignore storage write failures
  }
}
