import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultBookingStoreOptions,
  normalizeBookingOptionList,
  sanitizeMerchantBookingEditableInput,
  validateMerchantBookingInput,
} from "./merchantBookings";

test("normalizeBookingOptionList trims blanks and removes duplicates", () => {
  assert.deepEqual(
    normalizeBookingOptionList([" 主店 ", "", "分店A", "主店", "分店A "]),
    ["主店", "分店A"],
  );

  assert.deepEqual(
    normalizeBookingOptionList("主店\n\n分店A\n主店"),
    ["主店", "分店A"],
  );
});

test("buildDefaultBookingStoreOptions falls back to 主店", () => {
  assert.deepEqual(buildDefaultBookingStoreOptions(""), ["主店"]);
  assert.deepEqual(buildDefaultBookingStoreOptions("Faolla"), ["Faolla"]);
});

test("sanitizeMerchantBookingEditableInput normalizes email and note", () => {
  const sanitized = sanitizeMerchantBookingEditableInput({
    store: " 主店 ",
    item: " 咨询预约 ",
    appointmentAt: " 2026-03-19T10:30 ",
    title: " 先生 ",
    customerName: " Felix ",
    email: " TEST@EXAMPLE.COM ",
    phone: " 123456 ",
    note: " 第一行\r\n第二行 ",
  });

  assert.deepEqual(sanitized, {
    store: "主店",
    item: "咨询预约",
    appointmentAt: "2026-03-19T10:30",
    title: "先生",
    customerName: "Felix",
    email: "test@example.com",
    phone: "123456",
    note: "第一行\n第二行",
  });
});

test("validateMerchantBookingInput returns friendly issues", () => {
  const issues = validateMerchantBookingInput({
    store: "",
    item: "",
    appointmentAt: "bad-date",
    title: "",
    customerName: "",
    email: "bad-email",
    phone: "",
    note: "",
  });

  assert.deepEqual(issues, [
    "请选择预约店铺",
    "请选择预约项目",
    "预约日期时间格式无效",
    "请选择称谓",
    "请填写称谓或姓名",
    "邮箱格式无效",
    "请填写电话",
  ]);
});
