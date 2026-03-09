import test from "node:test";
import assert from "node:assert/strict";
import type { Block } from "@/data/homeBlocks";
import { getInlinePublishPayloadViolation } from "@/lib/publishPayloadValidation";

test("rejects inline image publish payloads", () => {
  const blocks = [
    {
      id: "b1",
      type: "common",
      props: {
        bgImageUrl: "data:image/png;base64,abc",
      },
    },
  ] as Block[];

  assert.equal(getInlinePublishPayloadViolation(blocks), "发布请求包含未外链化资源（图片 1）");
});

test("rejects inline audio publish payloads", () => {
  const blocks = [
    {
      id: "b2",
      type: "music",
      props: {
        audioUrl: "data:audio/mp3;base64,abc",
      },
    },
  ] as Block[];

  assert.equal(getInlinePublishPayloadViolation(blocks), "发布请求包含未外链化资源（音频 1）");
});

test("allows external-url payloads", () => {
  const blocks = [
    {
      id: "b3",
      type: "gallery",
      props: {
        heading: "ok",
        images: [{ id: "img-1", url: "https://example.com/image.webp" }],
      },
    },
  ] as Block[];

  assert.equal(getInlinePublishPayloadViolation(blocks), null);
});
