import test from "node:test";
import assert from "node:assert/strict";
import { countInlineAssets } from "./inlineAssetStats";

test("counts nested inline images and audio data urls", () => {
  const stats = countInlineAssets({
    image: "data:image/png;base64,abc",
    items: [
      { audio: "data:audio/mp3;base64,def" },
      { nested: { image: "data:image/webp;base64,ghi" } },
      "https://example.com/file.webp",
    ],
  });

  assert.deepEqual(stats, {
    imageCount: 2,
    audioCount: 1,
    totalCount: 3,
  });
});

test("ignores normal urls and plain strings", () => {
  const stats = countInlineAssets({
    image: "https://example.com/image.png",
    audio: "/audio/demo.mp3",
    text: "hello",
  });

  assert.deepEqual(stats, {
    imageCount: 0,
    audioCount: 0,
    totalCount: 0,
  });
});
