import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultBookingStoreOptions,
  buildMerchantBookingId,
  formatMerchantBookingIdDate,
  getMerchantBookingStatusLabel,
  joinMerchantBookingDateTime,
  normalizeBookingOptionList,
  sanitizeMerchantBookingEditableInput,
  splitMerchantBookingDateTime,
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

test("split and join merchant booking date time keeps stable values", () => {
  assert.deepEqual(splitMerchantBookingDateTime("2026-03-19T10:30"), {
    date: "2026-03-19",
    time: "10:30",
  });
  assert.equal(joinMerchantBookingDateTime("2026-03-19", "10:30"), "2026-03-19T10:30");
  assert.equal(joinMerchantBookingDateTime("2026-03-19", ""), "2026-03-19");
  assert.equal(joinMerchantBookingDateTime("", "10:30"), "10:30");
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

test("validateMerchantBookingInput rejects partial appointment values", () => {
  const issues = validateMerchantBookingInput({
    store: "Main",
    item: "Consultation",
    appointmentAt: "2026-03-07T12",
    title: "Mr",
    customerName: "Felix",
    email: "test@example.com",
    phone: "123456",
    note: "",
  });

  assert.deepEqual(issues, ["预约日期时间格式无效"]);
});

test("validateMerchantBookingInput rejects impossible calendar dates", () => {
  const issues = validateMerchantBookingInput({
    store: "Main",
    item: "Consultation",
    appointmentAt: "2026-02-31T10:00",
    title: "Mr",
    customerName: "Felix",
    email: "test@example.com",
    phone: "123456",
    note: "",
  });

  assert.deepEqual(issues, ["预约日期时间格式无效"]);
});

test("buildMerchantBookingId uses merchant id + date + 5-digit sequence", () => {
  const createdAt = "2026-03-19T10:30:00.000Z";
  assert.equal(formatMerchantBookingIdDate(createdAt), "20260319");
  assert.equal(
    buildMerchantBookingId("10000000", createdAt, [
      "100000002026031900001",
      "100000002026031900002",
      "100000012026031900001",
    ]),
    "100000002026031900003",
  );
});

test("getMerchantBookingStatusLabel returns readable labels", () => {
  assert.equal(getMerchantBookingStatusLabel("active"), "待确认");
  assert.equal(getMerchantBookingStatusLabel("confirmed"), "已确认");
  assert.equal(getMerchantBookingStatusLabel("completed"), "已完成");
  assert.equal(getMerchantBookingStatusLabel("cancelled"), "已取消");
});
