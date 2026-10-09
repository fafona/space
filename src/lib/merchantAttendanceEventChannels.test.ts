import assert from "node:assert/strict";
import test from "node:test";
import { EVENT_CHANNEL_ERRORS, EVENT_CHANNEL_MAX_BODY_BYTES, EVENT_CHANNEL_MAX_ITEMS, EVENT_CHANNEL_MAX_RESPONSE_BYTES,
  parseEventChannelsQuery, parseEventChannelsResult, type EventChannelsQuery, type EventChannelsResult } from "./merchantAttendanceEventChannels";
import { executeEventChannels, readEventChannelsJson, type EventChannelsInput } from "./merchantAttendanceEventChannels.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query: EventChannelsQuery = { siteId: "99990001", access: "self", workerId: id(1), locationId: null, eventIds: [id(3), id(2), id(4)] };
const result: EventChannelsResult = { siteId: query.siteId, access: "self", workerId: query.workerId, locationId: null, viewerEmployeeId: id(5),
  asOf: "2026-10-02T12:00:00.000123Z", accessValidUntil: null, items: [
    { eventId: id(3), action: "clock_in", occurredAt: "2026-10-02T09:00:00.000001Z", channel: "onsite_qr", terminalId: id(6) },
    { eventId: id(2), action: "break_start", occurredAt: "2026-10-02T10:00:00.000002Z", channel: "web", terminalId: null },
    { eventId: id(4), action: "break_end", occurredAt: "2026-10-02T10:30:00.000003Z", channel: "kiosk", terminalId: null },
  ] };
function service(data: unknown): AttendanceSelfRpc { return { rpc: async () => ({ data, error: null }) }; }
const input: EventChannelsInput = { query, authUserId: id(7) };
function bodyRequest(value: string | Uint8Array, headers: Record<string, string> = {}) {
  return new Request("https://www.faolla.com/api/merchant-enterprise/attendance/event-channels", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: value as BodyInit,
  });
}

test("query is exact, scope-specific and preserves caller event order without sharing its array", () => {
  const parsed = parseEventChannelsQuery(query);
  assert.deepEqual(parsed, query); assert.notEqual(parsed.eventIds, query.eventIds);
  for (const access of ["self", "owner", "manager"] as const) {
    const value = { ...query, access, locationId: access === "manager" ? id(8) : null };
    assert.deepEqual(parseEventChannelsQuery(value), value);
  }
});

test("query rejects caller authority, token/command fields, unknown keys, missing keys and invalid identifiers", () => {
  const missing = Object.fromEntries(Object.entries(query).filter(([name]) => name !== "locationId"));
  for (const invalid of [null, [], "query", missing, { ...query, authUserId: id(9) }, { ...query, employeeId: id(9) },
    { ...query, viewerEmployeeId: id(9) }, { ...query, command: {} }, { ...query, token: "private" }, { ...query, nonce: id(9) },
    { ...query, siteId: 99990001 }, { ...query, siteId: "9999" }, { ...query, access: "admin" }, { ...query, workerId: "worker" },
    { ...query, workerId: id(10).toUpperCase().replace("4000", "F000") }, { ...query, eventIds: [null] }]) {
    assert.throws(() => parseEventChannelsQuery(invalid), /attendance_invalid_request/);
  }
});

test("manager requires a canonical location; self and owner must supply explicit null", () => {
  for (const invalid of [{ ...query, locationId: id(8) }, { ...query, access: "owner", locationId: id(8) },
    { ...query, access: "manager" }, { ...query, access: "manager", locationId: "" }, { ...query, locationId: undefined }]) {
    assert.throws(() => parseEventChannelsQuery(invalid), /attendance_invalid_request/);
  }
});

test("query accepts exactly 1..202 distinct IDs and rejects sparse, duplicate, malformed or oversized batches", () => {
  assert.equal(EVENT_CHANNEL_MAX_ITEMS, 202);
  assert.equal(parseEventChannelsQuery({ ...query, eventIds: [id(1)] }).eventIds.length, 1);
  assert.equal(parseEventChannelsQuery({ ...query, eventIds: Array.from({ length: 202 }, (_, n) => id(n + 1)) }).eventIds.length, 202);
  for (const eventIds of [[], null, {}, [id(2), id(2)], ["bad"], new Array(2), Array.from({ length: 203 }, (_, n) => id(n + 1))]) {
    assert.throws(() => parseEventChannelsQuery({ ...query, eventIds }), /attendance_invalid_request/);
  }
});

test("result validates all three channel types and exact scope, timestamps and ordered coverage", () => {
  const parsed = parseEventChannelsResult(result, query);
  assert.deepEqual(parsed, result); assert.notEqual(parsed, result); assert.notEqual(parsed.items[0], result.items[0]);
  assert.equal(parsed.items[0].occurredAt, "2026-10-02T09:00:00.000001Z");
  const owner = { ...query, access: "owner" as const };
  assert.deepEqual(parseEventChannelsResult({ ...result, access: "owner", viewerEmployeeId: null }, owner), { ...result, access: "owner", viewerEmployeeId: null });
  const manager = { ...query, access: "manager" as const, locationId: id(8) };
  for (const accessValidUntil of [null, "2026-10-02T12:00:00.000124Z"]) {
    const value = { ...result, access: "manager" as const, locationId: id(8), accessValidUntil };
    assert.deepEqual(parseEventChannelsResult(value, manager), value);
  }
});

test("result normalizes existing millisecond UTC timestamps without truncating PostgreSQL microseconds", () => {
  const raw = { ...result, asOf: "2026-10-02T12:00:00.000Z", items: result.items.map(item => ({ ...item, occurredAt: "2026-10-02T09:00:00.123Z" })) };
  const parsed = parseEventChannelsResult(raw, query);
  assert.equal(parsed.asOf, "2026-10-02T12:00:00.000000Z"); assert.equal(parsed.items[0].occurredAt, "2026-10-02T09:00:00.123000Z");
});

test("result refuses wrong site/access/worker/location/viewer and missing or reordered coverage", () => {
  for (const invalid of [null, [], { ...result, siteId: "99990002" }, { ...result, access: "owner" }, { ...result, workerId: id(9) },
    { ...result, locationId: id(9) }, { ...result, viewerEmployeeId: null }, { ...result, viewerEmployeeId: "bad" },
    { ...result, items: result.items.slice(1) }, { ...result, items: [...result.items, result.items[0]] },
    { ...result, items: [...result.items].reverse() }, { ...result, items: result.items.map(() => result.items[0]) },
    { ...result, items: new Array(3) }]) assert.throws(() => parseEventChannelsResult(invalid, query), /attendance_unavailable/);
  assert.throws(() => parseEventChannelsResult({ ...result, access: "owner" }, { ...query, access: "owner" }), /attendance_unavailable/);
});

test("result rejects raw claims, tokens, actor identity and unknown nested fields rather than exposing RPC internals", () => {
  for (const field of ["token", "claims", "command", "nonce", "secretHash", "actorAuthUserId", "ok", "moduleEnabled"]) {
    assert.throws(() => parseEventChannelsResult({ ...result, [field]: "private" }, query), /attendance_unavailable/);
    assert.throws(() => parseEventChannelsResult({ ...result, items: [{ ...result.items[0], [field]: "private" }, ...result.items.slice(1)] }, query), /attendance_unavailable/);
  }
  const inherited = Object.assign(Object.create({ privateSecret: "not an own JSON field" }), result);
  assert.deepEqual(parseEventChannelsResult(inherited, query), result);
  assert.equal(JSON.stringify(parseEventChannelsResult(inherited, query)).includes("privateSecret"), false);
});

test("result rejects unknown actions/channels, invalid terminal associations, future events and invalid dates", () => {
  const first = result.items[0];
  for (const item of [{ ...first, action: "toggle" }, { ...first, action: 1 }, { ...first, channel: "onsite" },
    { ...first, channel: "kiosk" }, { ...first, channel: "web" }, { ...first, terminalId: null }, { ...first, terminalId: "bad" },
    { ...first, occurredAt: "2026-10-02T12:00:00.000124Z" }, { ...first, occurredAt: "2026-02-30T12:00:00.000000Z" },
    { ...first, occurredAt: "2026-10-02T12:00:00+00:00" }, { ...first, occurredAt: null }]) {
    assert.throws(() => parseEventChannelsResult({ ...result, items: [item, ...result.items.slice(1)] }, query), /attendance_unavailable/);
  }
  for (const asOf of [null, "bad", "2026-10-02T12:00:00Z"]) assert.throws(() => parseEventChannelsResult({ ...result, asOf }, query), /attendance_unavailable/);
});

test("only manager expiry may be non-null, and it must be strictly later than asOf", () => {
  assert.throws(() => parseEventChannelsResult({ ...result, accessValidUntil: "2026-10-02T12:01:00.000000Z" }, query), /attendance_unavailable/);
  const manager = { ...query, access: "manager" as const, locationId: id(8) };
  for (const accessValidUntil of [result.asOf, "2026-10-02T12:00:00.000122Z", "bad", undefined]) {
    assert.throws(() => parseEventChannelsResult({ ...result, access: "manager", locationId: id(8), accessValidUntil }, manager), /attendance_unavailable/);
  }
});

test("executor sends exact read-only RPC arguments with authenticated principal and parses private response", async () => {
  const client: AttendanceSelfRpc = { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_event_channels_v1");
    assert.deepEqual(args, { p_site_id: query.siteId, p_auth_user_id: id(7), p_query: {
      access: query.access, workerId: query.workerId, locationId: null, eventIds: query.eventIds,
    } });
    return { data: result, error: null };
  } };
  assert.deepEqual(await executeEventChannels(input, client), result);
  assert.deepEqual(await executeEventChannels(input, service(result)), result);
});

test("executor does not read QR signing secrets or issuance switches", async () => {
  const names = ["FAOLLA_ATTENDANCE_ONSITE_QR_SECRET", "FAOLLA_ATTENDANCE_ONSITE_QR_ENABLED", "FAOLLA_ATTENDANCE_TERMINALS_ENABLED"];
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.deepEqual(await executeEventChannels(input, service(result)), result);
    for (const name of names) process.env[name] = "disabled";
    assert.deepEqual(await executeEventChannels(input, service(result)), result);
  } finally { for (const name of names) { if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name]; } }
});

test("executor rejects malformed query or extra authority input before reaching RPC", async () => {
  let calls = 0; const client: AttendanceSelfRpc = { rpc: async () => { calls++; return { data: result, error: null }; } };
  for (const invalid of [{ ...input, authUserId: "bad" }, { ...input, token: "private" }, { ...input, query: { ...query, authUserId: id(9) } },
    { ...input, query: { ...query, eventIds: [] } }, null]) {
    await assert.rejects(executeEventChannels(invalid as EventChannelsInput, client), /attendance_invalid_request/);
  }
  assert.equal(calls, 0);
});

test("executor forwards only named errors and never exposes SQL/network messages or malformed results", async () => {
  for (const [code, status] of Object.entries(EVENT_CHANNEL_ERRORS)) {
    assert.ok([400, 403, 409, 413, 415, 429, 503].includes(status));
    await assert.rejects(executeEventChannels(input, { rpc: async () => ({ data: null, error: { message: code } }) }), { message: code });
  }
  for (const client of [null, service({ ...result, token: "private" }), service({ ...result, items: [] }),
    { rpc: async () => ({ data: null, error: { message: "SQL contains private receipt fields" } }) },
    { rpc: async () => { throw Error("private network credential"); } }]) {
    await assert.rejects(executeEventChannels(input, client), { message: "attendance_unavailable" });
  }
});

test("bounded JSON reader accepts valid UTF-8 and exact 16KiB input, rejects oversized declared or actual bytes", async () => {
  assert.deepEqual(await readEventChannelsJson(bodyRequest(JSON.stringify(query))), query);
  const full = JSON.stringify({ padding: "x".repeat(EVENT_CHANNEL_MAX_BODY_BYTES - 14) });
  assert.equal(Buffer.byteLength(full), EVENT_CHANNEL_MAX_BODY_BYTES);
  assert.equal((await readEventChannelsJson(bodyRequest(full)) as { padding: string }).padding.length, EVENT_CHANNEL_MAX_BODY_BYTES - 14);
  for (const request of [bodyRequest(full + " "), bodyRequest(JSON.stringify({ padding: "中".repeat(6_000) })),
    bodyRequest("{}", { "content-length": "16385" }), bodyRequest("{}", { "content-length": "bad" }), bodyRequest("{}", { "content-length": "-1" })]) {
    await assert.rejects(readEventChannelsJson(request), /attendance_body_too_large/);
  }
});

test("bounded JSON reader rejects missing body, bad JSON, invalid UTF-8 and wrong content types", async () => {
  for (const request of [bodyRequest("{"), bodyRequest(Uint8Array.from([0x7b, 0xc3, 0x28, 0x7d])),
    new Request("https://www.faolla.com", { method: "POST", headers: { "content-type": "application/json" } })]) {
    await assert.rejects(readEventChannelsJson(request), /attendance_invalid_request/);
  }
  for (const contentType of ["text/plain", "application/jsonp", "application/x-www-form-urlencoded"]) {
    await assert.rejects(readEventChannelsJson(bodyRequest("{}", { "content-type": contentType })), /attendance_invalid_content_type/);
  }
  assert.deepEqual(await readEventChannelsJson(bodyRequest("{}", { "content-type": "APPLICATION/JSON; charset=utf-8" })), {});
});

test("maximum legitimate response remains below the 64KiB output bound", () => {
  const eventIds = Array.from({ length: 202 }, (_, n) => id(n + 1));
  const maximum = { ...result, items: eventIds.map(eventId => ({ ...result.items[0], eventId })) };
  const parsed = parseEventChannelsResult(maximum, { ...query, eventIds });
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, ...parsed, moduleEnabled: false }), "utf8") <= EVENT_CHANNEL_MAX_RESPONSE_BYTES);
});
