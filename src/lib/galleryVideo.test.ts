import assert from "node:assert/strict";
import test from "node:test";
import { galleryVideoSettings, publicGalleryVideoUrl } from "./galleryVideo";
import { sanitizeBlocksForRuntime } from "./blocksSanitizer";
import { getLeisureRole } from "./leisurePresentation";
import type { Block } from "../data/homeBlocks";

test("video mode is explicit; existing image galleries and props are unchanged", () => {
  assert.deepEqual(galleryVideoSettings({}, "/cover.jpg"), { media: "images", url: "", mobileUrl: "", poster: "/cover.jpg", position: "50% 50%" });
  assert.equal(galleryVideoSettings({ galleryVideoUrl: "https://assets.example/clip.mp4" }).media, "images");
});
test("native video accepts bounded HTTPS/rooted MP4 or WebM, not embeds, scripts or inline payloads", () => {
  for (const input of ["https://assets.example/clip.mp4?version=1", "/storage/v1/object/public/assets/clip.webm"]) assert.equal(publicGalleryVideoUrl(input), input);
  for (const input of [null, {}, "", "//other.example/clip.mp4", "http://other.example/clip.mp4", "javascript:alert(1)", "data:video/mp4;base64,AAAA", "blob:https://faolla.com/a.mp4", "https://youtube.com/embed/video", "https://example.test/image.jpg", "x".repeat(5000)]) assert.equal(publicGalleryVideoUrl(input), "", String(input));
});
test("video framing accepts percentages only and poster falls back to the preserved gallery image", () => {
  assert.equal(galleryVideoSettings({ galleryVideoPosition: "50% 55%" }).position, "50% 55%");
  for (const input of ["101% 50%", "url(x)", "50% -5%", "50% 50%;position:fixed"]) assert.equal(galleryVideoSettings({ galleryVideoPosition: input }).position, "50% 50%");
  assert.equal(galleryVideoSettings({ galleryVideoPosterUrl: "javascript:alert(1)" }, "/existing.jpg").poster, "/existing.jpg");
  assert.equal(publicGalleryVideoUrl("https://user:pass@assets.example/clip.mp4"), "");
});
test("background and player configuration survives native sanitization without a new module or schema", () => {
  for (const mode of ["background-video", "video"] as const) {
    const block: Block = { id: "synthetic-video", type: "gallery", props: { schemaVersion: 3, heading: "Synthetic", images: [], galleryMedia: mode, galleryVideoUrl: "/clip.mp4", galleryVideoPosterUrl: "/poster.jpg", galleryVideoPosition: "50% 55%", galleryControls: "none", leisureRole: "video-one" } };
    assert.deepEqual(sanitizeBlocksForRuntime([block]).blocks, [block]);
    assert.equal(getLeisureRole(block), "video-one");
  }
});
