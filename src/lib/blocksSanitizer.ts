import type { Block } from "../data/homeBlocks";
import { BLOCKS_SCHEMA_VERSION } from "./blocksSchema";

const MAX_INLINE_IMAGE_URL_LENGTH = 6_000_000;
const MAX_INLINE_AUDIO_URL_LENGTH = 4_000_000;

function sanitizeInlineDataUrl(value: string): { value: string; removed: number } {
  if (/^data:image\//i.test(value) && value.length > MAX_INLINE_IMAGE_URL_LENGTH) {
    return { value: "", removed: 1 };
  }
  if (/^data:audio\//i.test(value) && value.length > MAX_INLINE_AUDIO_URL_LENGTH) {
    return { value: "", removed: 1 };
  }
  return { value, removed: 0 };
}

function sanitizeUnknown(input: unknown): { value: unknown; removed: number } {
  if (typeof input === "string") {
    return sanitizeInlineDataUrl(input);
  }

  if (Array.isArray(input)) {
    let removed = 0;
    const value = input.map((item) => {
      const next = sanitizeUnknown(item);
      removed += next.removed;
      return next.value;
    });
    return { value, removed };
  }

  if (input && typeof input === "object") {
    let removed = 0;
    const record = input as Record<string, unknown>;
    const nextRecord: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === "blockGroup") {
        removed += 1;
        continue;
      }
      const next = sanitizeUnknown(value);
      removed += next.removed;
      nextRecord[key] = next.value;
    }
    return { value: nextRecord, removed };
  }

  return { value: input, removed: 0 };
}

function normalizeSchemaVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : null;
}

function migrateBlocksSchemaVersion(blocks: Block[]): { blocks: Block[]; migrated: number } {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { blocks, migrated: 0 };
  }

  const first = blocks[0];
  if (!first || !first.props || typeof first.props !== "object") {
    return { blocks, migrated: 0 };
  }

  const currentVersion = normalizeSchemaVersion((first.props as Record<string, unknown>).schemaVersion);
  if (currentVersion === BLOCKS_SCHEMA_VERSION) {
    return { blocks, migrated: 0 };
  }

  const next = [...blocks];
  next[0] = {
    ...first,
    props: {
      ...first.props,
      schemaVersion: BLOCKS_SCHEMA_VERSION,
    } as never,
  } as Block;
  return { blocks: next, migrated: 1 };
}

export function sanitizeBlocksForRuntime(blocks: Block[]): { blocks: Block[]; removed: number } {
  const next = sanitizeUnknown(blocks);
  const sanitizedBlocks = Array.isArray(next.value) ? (next.value as Block[]) : [];
  const migrated = migrateBlocksSchemaVersion(sanitizedBlocks);
  return {
    blocks: migrated.blocks,
    removed: next.removed + migrated.migrated,
  };
}
