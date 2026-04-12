import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultBookingStoreOptions,
  buildMerchantBookingId,
  formatMerchantBookingIdDate,
  getMerchantBookingTimeAvailabilityIssue,
  getMerchantBookingStatusLabel,
  joinMerchantBookingDateTime,
  MERCHANT_BOOKING_CUSTOMER_NAME_MAX_BYTES,
  MERCHANT_BOOKING_NOTE_MAX_BYTES,
  normalizeBookingOptionList,
  normalizeMerchantBookingCustomerNameInput,
  normalizeMerchantBookingNoteInput,
  normalizeMerchantBookingTimeRangeOptions,
  sanitizeMerchantBookingEditableInput,
  isMerchantBookingTimeAllowed,
  shouldSendMerchantBookingConfirmationEmail,
  splitMerchantBookingDateTime,
  validateMerchantBookingInput,
  withoutMerchantBookingToken,
} from "./merchantBookings";

test("normalizeBookingOptionList trims blanks and removes duplicates", () => {
  assert.deepEqual(
    normalizeBookingOptionList([" \u4e3b\u5e97 ", "", "\u5206\u5e97A", "\u4e3b\u5e97", "\u5206\u5e97A "]),
    ["\u4e3b\u5e97", "\u5206\u5e97A"],
  );

  assert.deepEqual(
    normalizeBookingOptionList("\u4e3b\u5e97\n\n\u5206\u5e97A\n\u4e3b\u5e97"),
    ["\u4e3b\u5e97", "\u5206\u5e97A"],
  );
});

test("buildDefaultBookingStoreOptions falls back to 主店", () => {
  assert.deepEqual(buildDefaultBookingStoreOptions(""), ["\u4e3b\u5e97"]);
  assert.deepEqual(buildDefaultBookingStoreOptions("Faolla"), ["Faolla"]);
});

test("sanitizeMerchantBookingEditableInput normalizes email and note", () => {
  const sanitized = sanitizeMerchantBookingEditableInput({
    store: " \u4e3b\u5e97 ",
    item: " \u54a8\u8be2\u9884\u7ea6 ",
    appointmentAt: " 2026-03-19T10:30 ",
    title: " \u5148\u751f ",
    customerName: " Felix ",
    email: " TEST@EXAMPLE.COM ",
    phone: " 123456 ",
    note: " \u7b2c\u4e00\u884c\r\n\u7b2c\u4e8c\u884c ",
  });

  assert.deepEqual(sanitized, {
    store: "\u4e3b\u5e97",
    item: "\u54a8\u8be2\u9884\u7ea6",
    appointmentAt: "2026-03-19T10:30",
    title: "\u5148\u751f",
    customerName: "Felix",
    email: "test@example.com",
    phone: "123456",
    note: "\u7b2c\u4e00\u884c\n\u7b2c\u4e8c\u884c",
  });
});

test("booking byte-limit helpers truncate customer name and note safely", () => {
  assert.equal(
    normalizeMerchantBookingCustomerNameInput(`${"a".repeat(MERCHANT_BOOKING_CUSTOMER_NAME_MAX_BYTES - 1)}张`),
    "a".repeat(MERCHANT_BOOKING_CUSTOMER_NAME_MAX_BYTES - 1),
  );
  assert.equal(
    normalizeMerchantBookingNoteInput(`${"b".repeat(MERCHANT_BOOKING_NOTE_MAX_BYTES - 1)}张`),
    "b".repeat(MERCHANT_BOOKING_NOTE_MAX_BYTES - 1),
  );
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

test("normalizeMerchantBookingTimeRangeOptions normalizes exact times and ranges", () => {
  assert.deepEqual(
    normalizeMerchantBookingTimeRangeOptions("9:00-12:00\n14:00 ～ 18:00\n09:30\n09:30\nbad"),
    ["09:00-12:00", "14:00-18:00", "09:30"],
  );
});

test("isMerchantBookingTimeAllowed respects configured booking time ranges", () => {
  const ranges = ["09:00-12:00", "14:00-18:00", "19:30"];
  assert.equal(isMerchantBookingTimeAllowed("09:00", ranges), true);
  assert.equal(isMerchantBookingTimeAllowed("11:45", ranges), true);
  assert.equal(isMerchantBookingTimeAllowed("19:30", ranges), true);
  assert.equal(isMerchantBookingTimeAllowed("12:30", ranges), false);
  assert.equal(isMerchantBookingTimeAllowed("19:00", ranges), false);
});

test("getMerchantBookingTimeAvailabilityIssue only warns for complete disallowed times", () => {
  const ranges = ["09:00-12:00", "14:00-18:00"];
  assert.equal(getMerchantBookingTimeAvailabilityIssue("", ranges), "");
  assert.equal(getMerchantBookingTimeAvailabilityIssue("09", ranges), "");
  assert.equal(getMerchantBookingTimeAvailabilityIssue("09:30", ranges), "");
  assert.equal(getMerchantBookingTimeAvailabilityIssue("12:30", ranges), "预约时间需在可预约时段内");
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
    "\u8bf7\u9009\u62e9\u9884\u7ea6\u5e97\u94fa",
    "\u8bf7\u9009\u62e9\u9884\u7ea6\u9879\u76ee",
    "\u9884\u7ea6\u65e5\u671f\u65f6\u95f4\u683c\u5f0f\u65e0\u6548",
    "\u8bf7\u9009\u62e9\u79f0\u8c13",
    "\u8bf7\u586b\u5199\u79f0\u8c13\u6216\u59d3\u540d",
    "\u90ae\u7bb1\u683c\u5f0f\u65e0\u6548",
    "\u8bf7\u586b\u5199\u7535\u8bdd",
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

  assert.deepEqual(issues, ["\u9884\u7ea6\u65e5\u671f\u65f6\u95f4\u683c\u5f0f\u65e0\u6548"]);
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

  assert.deepEqual(issues, ["\u9884\u7ea6\u65e5\u671f\u65f6\u95f4\u683c\u5f0f\u65e0\u6548"]);
});

test("validateMerchantBookingInput rejects appointment times outside configured ranges", () => {
  const issues = validateMerchantBookingInput(
    {
      store: "Main",
      item: "Consultation",
      appointmentAt: "2026-03-19T12:30",
      title: "Mr",
      customerName: "Felix",
      email: "test@example.com",
      phone: "123456",
      note: "",
    },
    { availableTimeRanges: ["09:00-12:00", "14:00-18:00"] },
  );

  assert.deepEqual(issues, ["预约时间需在可预约时段内"]);
});

test("validateMerchantBookingInput rejects customer name and note beyond byte limits", () => {
  const issues = validateMerchantBookingInput({
    store: "Main",
    item: "Consultation",
    appointmentAt: "2026-03-19T10:30",
    title: "Mr",
    customerName: "a".repeat(MERCHANT_BOOKING_CUSTOMER_NAME_MAX_BYTES + 1),
    email: "test@example.com",
    phone: "123456",
    note: "b".repeat(MERCHANT_BOOKING_NOTE_MAX_BYTES + 1),
  });

  assert.deepEqual(issues, [
    `\u59d3\u540d\u6700\u591a ${MERCHANT_BOOKING_CUSTOMER_NAME_MAX_BYTES} \u5b57\u8282`,
    `\u5907\u6ce8\u6700\u591a ${MERCHANT_BOOKING_NOTE_MAX_BYTES} \u5b57\u8282`,
  ]);
});

test("buildMerchantBookingId uses R + merchant id + date + 4-digit sequence", () => {
  const createdAt = "2026-03-19T10:30:00.000Z";
  assert.equal(formatMerchantBookingIdDate(createdAt), "20260319");
  assert.equal(
    buildMerchantBookingId("10000000", createdAt, [
      "R10000000202603190001",
      "R10000000202603190002",
      "R10000001202603190001",
    ]),
    "R10000000202603190003",
  );
});

test("shouldSendMerchantBookingConfirmationEmail only allows the first transition to confirmed", () => {
  assert.equal(
    shouldSendMerchantBookingConfirmationEmail({
      currentStatus: "active",
      nextStatus: "confirmed",
      confirmationEmailLastAttemptAt: "",
    }),
    true,
  );
  assert.equal(
    shouldSendMerchantBookingConfirmationEmail({
      currentStatus: "confirmed",
      nextStatus: "confirmed",
      confirmationEmailLastAttemptAt: "",
    }),
    false,
  );
  assert.equal(
    shouldSendMerchantBookingConfirmationEmail({
      currentStatus: "cancelled",
      nextStatus: "confirmed",
      confirmationEmailLastAttemptAt: "2026-03-19T10:31:00.000Z",
    }),
    false,
  );
});

test("withoutMerchantBookingToken removes internal email delivery metadata", () => {
  const publicRecord = withoutMerchantBookingToken({
    id: "R10000000202603190001",
    siteId: "10000000",
    siteName: "Faolla",
    store: "Main",
    item: "Consultation",
    appointmentAt: "2026-03-19T10:30",
    title: "Mr",
    customerName: "Felix",
    email: "test@example.com",
    phone: "123456",
    note: "",
    status: "confirmed",
    createdAt: "2026-03-19T10:00:00.000Z",
    updatedAt: "2026-03-19T10:30:00.000Z",
    editToken: "secret",
    confirmationEmailLastAttemptAt: "2026-03-19T10:31:00.000Z",
    confirmationEmailStatus: "sent",
    confirmationEmailSentAt: "2026-03-19T10:31:00.000Z",
    confirmationEmailMessageId: "email-id-1",
    confirmationEmailError: "failed",
  });

  assert.deepEqual(publicRecord, {
    id: "R10000000202603190001",
    siteId: "10000000",
    siteName: "Faolla",
    store: "Main",
    item: "Consultation",
    appointmentAt: "2026-03-19T10:30",
    title: "Mr",
    customerName: "Felix",
    email: "test@example.com",
    phone: "123456",
    note: "",
    status: "confirmed",
    createdAt: "2026-03-19T10:00:00.000Z",
    updatedAt: "2026-03-19T10:30:00.000Z",
  });
});

test("getMerchantBookingStatusLabel returns readable labels", () => {
  assert.equal(getMerchantBookingStatusLabel("active"), "\u5f85\u786e\u8ba4");
  assert.equal(getMerchantBookingStatusLabel("confirmed"), "\u5df2\u786e\u8ba4");
  assert.equal(getMerchantBookingStatusLabel("completed"), "\u5df2\u5b8c\u6210");
  assert.equal(getMerchantBookingStatusLabel("cancelled"), "\u5df2\u53d6\u6d88");
});
