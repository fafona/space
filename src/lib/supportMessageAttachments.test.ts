import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSupportConversationPreview,
  isSupportShortMerchantCardLink,
  parseSupportMessageAttachmentPreview,
} from "./supportMessageAttachments";

test("parseSupportMessageAttachmentPreview parses plain image messages", () => {
  assert.deepEqual(parseSupportMessageAttachmentPreview("图片：https://faolla.com/a.webp"), {
    imageUrl: "https://faolla.com/a.webp",
    linkUrl: "",
  });
});

test("parseSupportMessageAttachmentPreview parses card image and link pairs", () => {
  assert.deepEqual(
    parseSupportMessageAttachmentPreview("https://faolla.com/card.webp\n联系卡：https://faolla.com/card/abc123"),
    {
      imageUrl: "https://faolla.com/card.webp",
      linkUrl: "https://faolla.com/card/abc123",
    },
  );
});

test("parseSupportMessageAttachmentPreview parses photo messages with file names", () => {
  assert.deepEqual(parseSupportMessageAttachmentPreview("照片：demo.jpg\nhttps://faolla.com/photo.jpg"), {
    imageUrl: "https://faolla.com/photo.jpg",
    linkUrl: "",
  });
});

test("formatSupportConversationPreview collapses attachment messages into stable labels", () => {
  assert.equal(formatSupportConversationPreview("https://faolla.com/card.webp\n联系卡：https://faolla.com/card/abc123"), "名片");
  assert.equal(formatSupportConversationPreview("照片：https://faolla.com/photo.jpg"), "图片");
  assert.equal(formatSupportConversationPreview("普通文字消息"), "普通文字消息");
});

test("isSupportShortMerchantCardLink only accepts short card routes", () => {
  assert.equal(isSupportShortMerchantCardLink("https://faolla.com/card/abc123"), true);
  assert.equal(isSupportShortMerchantCardLink("https://faolla.com/share/business-card?name=demo"), false);
});
