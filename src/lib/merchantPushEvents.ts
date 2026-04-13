import { formatMerchantBookingDateTime, type MerchantBookingRecord } from "@/lib/merchantBookings";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSingleLine(value: unknown) {
  return trimText(value).replace(/\s+/g, " ").trim();
}

export function buildMerchantPushPreview(text: string, maxLength = 88) {
  const normalized = normalizeSingleLine(text);
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

export function buildMerchantPeerPushNotification(input: {
  recipientMerchantId: string;
  senderMerchantId: string;
  senderMerchantName: string;
  text: string;
}) {
  const senderName = trimText(input.senderMerchantName) || trimText(input.senderMerchantId) || "商户";
  return {
    title: `新消息 - ${senderName}`,
    body: buildMerchantPushPreview(input.text),
    url: `/${trimText(input.recipientMerchantId)}?support=merchant:${trimText(input.senderMerchantId)}`,
    tag: `peer:${trimText(input.recipientMerchantId)}:${trimText(input.senderMerchantId)}`,
  };
}

export function buildSuperAdminReplyPushNotification(input: {
  merchantId: string;
  text: string;
}) {
  const merchantId = trimText(input.merchantId);
  return {
    title: "Faolla 官方回复",
    body: buildMerchantPushPreview(input.text),
    url: `/${merchantId}?support=official`,
    tag: `support:${merchantId}`,
  };
}

export function buildMerchantBookingPushNotification(input: {
  siteId: string;
  booking: MerchantBookingRecord;
}) {
  const merchantId = trimText(input.siteId) || trimText(input.booking.siteId);
  const customerName = trimText(input.booking.customerName) || "新客户";
  const item = trimText(input.booking.item) || trimText(input.booking.store) || "预约";
  const appointmentAt = formatMerchantBookingDateTime(input.booking.appointmentAt);
  const previewSource = [customerName, item, appointmentAt].filter(Boolean).join(" / ");

  return {
    title: "新预约订单",
    body: buildMerchantPushPreview(previewSource || "您有一笔新的预约订单"),
    url: `/${merchantId}`,
    tag: `booking:${merchantId}`,
  };
}

export function buildMerchantBookingReminderPushNotification(input: {
  siteId: string;
  booking: MerchantBookingRecord;
  minutesBefore: number;
}) {
  const merchantId = trimText(input.siteId) || trimText(input.booking.siteId);
  const customerName = trimText(input.booking.customerName) || "客户";
  const item = trimText(input.booking.item) || trimText(input.booking.store) || "预约";
  const appointmentAt = formatMerchantBookingDateTime(input.booking.appointmentAt);
  const offsetLabel =
    input.minutesBefore % (60 * 24) === 0
      ? `${input.minutesBefore / (60 * 24)} 天后`
      : input.minutesBefore % 60 === 0
        ? `${input.minutesBefore / 60} 小时后`
        : `${input.minutesBefore} 分钟后`;

  return {
    title: "预约提醒",
    body: buildMerchantPushPreview(`${customerName} / ${item} / ${appointmentAt} / ${offsetLabel}`),
    url: `/${merchantId}`,
    tag: `booking-reminder:${merchantId}:${input.booking.id}:${input.minutesBefore}`,
  };
}
