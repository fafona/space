import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMerchantBookingPushNotification,
  buildMerchantBookingReminderPushNotification,
  buildMerchantOrderPushNotification,
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
    title: "新消息 - ABC",
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
    title: "新预约订单",
    body: "Felix / 咨询预约 / 2026-04-10 12:30",
    url: "/10000000?mobileTab=business&businessSection=booking&appShell=faolla",
    tag: "booking:10000000",
  });
});

test("buildMerchantOrderPushNotification builds new order payload", () => {
  const payload = buildMerchantOrderPushNotification({
    siteId: "10000000",
    order: {
      id: "O10000000202604100001",
      siteId: "10000000",
      siteName: "faolla",
      blockId: "products",
      createdAt: "2026-04-10T12:30:00.000Z",
      updatedAt: "2026-04-10T12:30:00.000Z",
      status: "pending",
      customer: {
        name: "Felix",
        phone: "+34 633130577",
        email: "felix@example.com",
        note: "",
      },
      items: [
        {
          productId: "p1",
          code: "A1",
          name: "套餐",
          description: "",
          imageUrl: "",
          tag: "",
          quantity: 2,
          unitPrice: 10,
          unitPriceText: "€10.00",
          subtotal: 20,
        },
      ],
      totalQuantity: 2,
      totalAmount: 20,
      pricePrefix: "€",
      confirmedAt: null,
      completedAt: null,
      cancelledAt: null,
      printedAt: null,
      printCount: 0,
    },
  });

  assert.deepEqual(payload, {
    title: "新订单",
    body: "Felix / 套餐×2 / €20.00",
    url: "/10000000?mobileTab=business&businessSection=orders&appShell=faolla",
    tag: "order:10000000",
  });
});

test("buildMerchantBookingReminderPushNotification builds reminder payload", () => {
  const payload = buildMerchantBookingReminderPushNotification({
    siteId: "10000000",
    minutesBefore: 120,
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
      status: "confirmed",
      createdAt: "2026-04-09T10:00:00.000Z",
      updatedAt: "2026-04-09T10:00:00.000Z",
    },
  });

  assert.deepEqual(payload, {
    title: "预约提醒",
    body: "Felix / 咨询预约 / 2026-04-10 12:30 / 2 小时后",
    url: "/10000000",
    tag: "booking-reminder:10000000:100000002026040900001:120",
  });
});
