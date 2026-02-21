import type { Block } from "@/data/homeBlocks";

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

export function sanitizeBlocksForRuntime(blocks: Block[]): { blocks: Block[]; removed: number } {
  const next = sanitizeUnknown(blocks);
  return {
    blocks: next.value as Block[],
    removed: next.removed,
  };
}
