import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMerchantBookingPushNotification,
  buildMerchantPeerPushNotification,
  buildMerchantPushPreview,
  buildSuperAdminReplyPushNotification,
} from "@/lib/merchantPushEvents";

test("buildMerchantPushPreview collapses whitespace and truncates safely", () => {
  assert.equal(buildMerchantPushPreview("  hello   world  "), "hello world");
  assert.equal(buildMerchantPushPreview("a".repeat(100), 10), "aaaaaaa...");
});

test("buildMerchantPeerPushNotification builds merchant chat payload", () => {
  const payload = buildMerchantPeerPushNotification({
    recipientMerchantId: "10000000",
    senderMerchantId: "20000000",
    senderMerchantName: "ABC",
    text: "  hello   merchant  ",
  });

  assert.deepEqual(payload, {
    title: "新消息 · ABC",
    body: "hello merchant",
    url: "/10000000?support=merchant:20000000",
    tag: "peer:10000000:20000000",
  });
});

test("buildSuperAdminReplyPushNotification builds official support payload", () => {
  const payload = buildSuperAdminReplyPushNotification({
    merchantId: "10000000",
    text: "欢迎回来，我们已经处理好了。",
  });

  assert.deepEqual(payload, {
    title: "Faolla 官方回复",
    body: "欢迎回来，我们已经处理好了。",
    url: "/10000000?support=official",
    tag: "support:10000000",
  });
});

test("buildMerchantBookingPushNotification builds new-order payload", () => {
  const payload = buildMerchantBookingPushNotification({
    siteId: "10000000",
    booking: {
      id: "100000002026040900001",
      siteId: "10000000",
      siteName: "faolla",
      store: "主店",
      item: "咨询预约",
      appointmentAt: "2026-04-10T12:30",
      title: "先生",
      customerName: "Felix",
      email: "felix@example.com",
      phone: "+34 633130577",
      note: "",
      status: "active",
      createdAt: "2026-04-09T10:00:00.000Z",
      updatedAt: "2026-04-09T10:00:00.000Z",
    },
  });

  assert.deepEqual(payload, {
    title: "新订单",
    body: "Felix 路 咨询预约 路 2026-04-10 12:30",
    url: "/10000000",
    tag: "booking:10000000",
  });
});
