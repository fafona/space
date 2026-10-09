import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { afterEach, beforeEach } from "node:test";
import { ONSITE_QR_ERRORS, parseOnsiteClaims, parseOnsiteClockBody, parseOnsiteClockQuery, parseOnsiteClockResult,
  type OnsiteClaims, type OnsiteClockResult, type OnsiteCommand } from "./merchantAttendanceOnsiteQr";
import { executeOnsiteClock, executeOnsiteIssue, signOnsiteToken, verifyOnsiteToken, type OnsiteClockInput } from "./merchantAttendanceOnsiteQr.server";
import { terminalHash } from "./merchantAttendanceTerminal.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = "12".repeat(32);
const priorKey = process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
beforeEach(() => { process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET = key; });
afterEach(() => {
  if (priorKey === undefined) delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
  else process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET = priorKey;
});
const claims: OnsiteClaims = { v: 1, purpose: "faolla.attendance.onsite", siteId: "99990001", terminalId: id(1), locationId: id(2),
  pairedAtMs: 1_790_769_500_000, issuedAtMs: 1_790_769_600_000, expiresAtMs: 1_790_769_645_000, nonce: id(3) };
const command: OnsiteCommand = { expectedWorkerId: id(4), expectedEmployeeId: id(5), operationId: id(6), locationId: id(2), action: "clock_in", expectedSequence: 0 };
const receipt = { id: id(7), siteId: claims.siteId, workerId: id(4), operationId: id(6), locationId: id(2), action: "clock_in" as const,
  breakPaid: null, sequence: 1, occurredAt: "2026-09-30T12:00:00.000Z", timeZone: "UTC" };
const result: OnsiteClockResult = { workerId: id(4), employeeId: id(5), locationId: id(2),
  state: { sequence: 1, status: "working", lastEvent: receipt }, receipt, replayed: false };
const issued = { siteId: claims.siteId, terminalId: claims.terminalId, locationId: claims.locationId,
  pairedAtMs: claims.pairedAtMs, issuedAtMs: claims.issuedAtMs, expiresAtMs: claims.expiresAtMs };
const issueInput = { siteId: claims.siteId, terminalId: claims.terminalId, secret: Buffer.alloc(32, 17).toString("base64url") };
function input(patch: Partial<OnsiteClockInput> = {}): OnsiteClockInput {
  return { siteId: claims.siteId, authUserId: id(8), token: signOnsiteToken(claims), command, operationId: null, allowNew: false, ...patch };
}
function service(data: unknown): AttendanceSelfRpc { return { rpc: async () => ({ data, error: null }) }; }
function signedSerialized(serialized: string, domain = "faolla.attendance.onsite.v1\0"): string {
  const encoded = Buffer.from(serialized, "utf8").toString("base64url");
  const signature = createHmac("sha256", Buffer.from(key, "hex")).update(`${domain}aq1.${encoded}`).digest("base64url");
  return `aq1.${encoded}.${signature}`;
}

test("onsite token signs and verifies exact canonical claims with real crypto", () => {
  const token = signOnsiteToken(claims);
  assert.match(token, /^aq1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.ok(Buffer.byteLength(token, "utf8") <= 1_400);
  assert.deepEqual(verifyOnsiteToken(token), claims);
  assert.equal(token, signedSerialized(JSON.stringify(claims)));
  assert.equal(Buffer.from(token.split(".")[1], "base64url").toString("utf8"), JSON.stringify(claims));
});

test("claims reject extra/missing fields, other purposes, versions, identifier forms and unsafe dates", () => {
  const missing = Object.fromEntries(Object.entries(claims).filter(([field]) => field !== "nonce"));
  const changes: unknown[] = [null, [], missing, { ...claims, secret: "never" }, { ...claims, v: "1" }, { ...claims, v: 2 },
    { ...claims, purpose: "faolla.attendance.pin" }, { ...claims, siteId: 99990001 }, { ...claims, siteId: "9999000" },
    { ...claims, terminalId: "00000000-0000-4000-8000-00000000000A" }, { ...claims, locationId: "other" }, { ...claims, nonce: "other" },
    { ...claims, pairedAtMs: claims.issuedAtMs + 1 }, { ...claims, expiresAtMs: claims.expiresAtMs + 1 },
    { ...claims, issuedAtMs: String(claims.issuedAtMs) }, { ...claims, pairedAtMs: -1 }, { ...claims, pairedAtMs: -0 },
    { ...claims, issuedAtMs: 0.5 }, { ...claims, pairedAtMs: null }, { ...claims, expiresAtMs: Infinity },
    { ...claims, issuedAtMs: Number.MAX_SAFE_INTEGER }, { ...claims, expiresAtMs: 8_640_000_000_000_001 }];
  for (const value of changes) assert.throws(() => parseOnsiteClaims(value), /attendance_qr_invalid/);
});

test("authentic but noncanonical JSON, duplicate fields and noncanonical base64url are rejected", () => {
  const serialized = JSON.stringify(claims);
  const noncanonical = [JSON.stringify(claims, null, 1), JSON.stringify(Object.fromEntries(Object.entries(claims).reverse())),
    serialized.replace('"v":1,', '"v":1,"v":1,'), serialized.replace('"v":1,', '"v":1.0,'),
    serialized.replace('"siteId":"99990001"', '"siteId":"\\u003999990001"'),
    JSON.stringify({ ...claims, extra: true }), JSON.stringify({ ...claims, expiresAtMs: claims.expiresAtMs + 10 })];
  for (const value of noncanonical) assert.throws(() => verifyOnsiteToken(signedSerialized(value)), /attendance_qr_invalid/);
  const token = signOnsiteToken(claims), parts = token.split(".");
  assert.throws(() => verifyOnsiteToken(`aq1.${parts[1]}=.${parts[2]}`), /attendance_qr_invalid/);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(parts[2].at(-1)!);
  const aliased = parts[2].slice(0, -1) + alphabet[last + 1];
  assert.deepEqual(Buffer.from(aliased, "base64url"), Buffer.from(parts[2], "base64url"));
  assert.throws(() => verifyOnsiteToken(`aq1.${parts[1]}.${aliased}`), /attendance_qr_invalid/);
});

test("wrong MAC domain, signatures, prefix and tampered valid claims are rejected", () => {
  const token = signOnsiteToken(claims), parts = token.split(".");
  const changedPayload = Buffer.from(JSON.stringify({ ...claims, locationId: id(9) })).toString("base64url");
  for (const value of [signedSerialized(JSON.stringify(claims), ""), signedSerialized(JSON.stringify(claims), "faolla.attendance.pin.v1\0"),
    `aq1.${changedPayload}.${parts[2]}`, `aq1.${parts[1]}.${"A".repeat(43)}`, token.replace("aq1.", "aq2."), `${token}.x`,
    `${token} `, `aq1.${"a".repeat(1_400)}.${parts[2]}`, ""]) assert.throws(() => verifyOnsiteToken(value), /attendance_qr_invalid/);
  process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET = "34".repeat(32);
  assert.throws(() => verifyOnsiteToken(token), /attendance_qr_invalid/);
});

test("verification intentionally leaves current freshness to the post-lock database clock", () => {
  const ancient = { ...claims, pairedAtMs: 0, issuedAtMs: 1, expiresAtMs: 45_001 };
  const future = { ...claims, pairedAtMs: 8_000_000_000_000_000, issuedAtMs: 8_000_000_000_000_001, expiresAtMs: 8_000_000_000_045_001 };
  assert.deepEqual(verifyOnsiteToken(signOnsiteToken(ancient)), ancient);
  assert.deepEqual(verifyOnsiteToken(signOnsiteToken(future)), future);
});

test("dedicated signing key is mandatory and canonical; no other environment key substitutes", async () => {
  const token = signOnsiteToken(claims);
  let called = false;
  const client: AttendanceSelfRpc = { rpc: async () => { called = true; return { data: issued, error: null }; } };
  const otherNames = ["FAOLLA_ATTENDANCE_PIN_SECRET", "FAOLLA_ATTENDANCE_TERMINAL_SECRET", "NEXTAUTH_SECRET"];
  const prior = Object.fromEntries(otherNames.map(name => [name, process.env[name]]));
  try {
    for (const name of otherNames) process.env[name] = key;
    for (const invalid of [undefined, "", "12".repeat(31), "AB".repeat(32), `${key}\n`, "zz".repeat(32)]) {
      if (invalid === undefined) delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
      else process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET = invalid;
      assert.throws(() => signOnsiteToken(claims), /attendance_unavailable/);
      assert.throws(() => verifyOnsiteToken(token), /attendance_unavailable/);
      await assert.rejects(executeOnsiteIssue(issueInput, client), /attendance_unavailable/);
    }
  } finally {
    for (const name of otherNames) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
  assert.equal(called, false);
});

test("POST requires the exact envelope and six-key employee-bound command", () => {
  const body = { siteId: claims.siteId, token: signOnsiteToken(claims), command };
  assert.deepEqual(parseOnsiteClockBody(body), body);
  const missingEmployee = Object.fromEntries(Object.entries(command).filter(([field]) => field !== "expectedEmployeeId"));
  for (const value of [{ ...body, extra: 1 }, { ...body, command: null }, { ...body, command: missingEmployee },
    { ...body, command: { ...command, workerId: id(4) } }, { ...body, command: { ...command, expectedEmployeeId: "invalid" } },
    { ...body, command: { ...command, expectedSequence: Number.MAX_SAFE_INTEGER } }, { ...body, command: { ...command, action: "toggle" } }]) {
    assert.throws(() => parseOnsiteClockBody(value), /attendance_invalid_request/);
  }
  for (const token of [null, "", "https://example.test/qr", "a".repeat(1_401)]) {
    assert.throws(() => parseOnsiteClockBody({ ...body, token }), /attendance_qr_invalid/);
  }
});

test("GET only permits site and optional operation; tokens and duplicate parameters never enter URLs", () => {
  assert.deepEqual(parseOnsiteClockQuery(`https://example.test/?siteId=${claims.siteId}&operationId=${id(6)}`), { siteId: claims.siteId, operationId: id(6) });
  assert.deepEqual(parseOnsiteClockQuery(`https://example.test/?siteId=${claims.siteId}`), { siteId: claims.siteId, operationId: null });
  for (const query of [`siteId=${claims.siteId}&token=abc`, `siteId=${claims.siteId}&siteId=${claims.siteId}`,
    `siteId=${claims.siteId}&operationId=${id(6)}&operationId=${id(6)}`, `siteId=${claims.siteId}&terminalId=${id(1)}`]) {
    assert.throws(() => parseOnsiteClockQuery(`https://example.test/?${query}`), /attendance_invalid_request/);
  }
});

test("issue hashes terminal credential, strictly validates SQL issue fields and signs fresh random nonce", async () => {
  const client: AttendanceSelfRpc = { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_onsite_issue_v1");
    assert.deepEqual(args, { p_site: claims.siteId, p_terminal: claims.terminalId, p_secret_hash: terminalHash(issueInput.secret) });
    assert.equal(JSON.stringify(args).includes(issueInput.secret), false);
    return { data: issued, error: null };
  } };
  const first = await executeOnsiteIssue(issueInput, client), second = await executeOnsiteIssue(issueInput, client);
  assert.deepEqual(Object.keys(first), ["siteId", "terminalId", "locationId", "issuedAtMs", "expiresAtMs", "token"]);
  const verified = verifyOnsiteToken(first.token);
  assert.deepEqual({ ...verified, nonce: claims.nonce }, claims);
  assert.notEqual(verified.nonce, verifyOnsiteToken(second.token).nonce);
  for (const bad of [{ ...issued, siteId: "99990002" }, { ...issued, terminalId: id(9) }, { ...issued, issuedAtMs: "1790769600000" },
    { ...issued, expiresAtMs: issued.expiresAtMs + 1 }, { ...issued, internalSecret: "never leak" }]) {
    await assert.rejects(executeOnsiteIssue(issueInput, service(bad)), /attendance_unavailable/);
  }
});

test("clock sends verified claims and explicit false gate, not token or signing secret", async () => {
  const request = input();
  const client: AttendanceSelfRpc = { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_onsite_clock_v1");
    assert.deepEqual(args, { p_site: claims.siteId, p_auth: id(8), p_claims: claims, p_command: command, p_operation: null, p_allow_new: false });
    assert.equal(JSON.stringify(args).includes(request.token!), false);
    assert.equal(JSON.stringify(args).includes(key), false);
    return { data: result, error: null };
  } };
  assert.deepEqual(await executeOnsiteClock(request, client), result);
  assert.deepEqual(await executeOnsiteClock(input({ allowNew: true }), service({ ...result, replayed: true })), { ...result, replayed: true });
});

test("clock rejects cross-site, cross-location, extra service fields and mixed read/write shape before RPC", async () => {
  let called = false;
  const client: AttendanceSelfRpc = { rpc: async () => { called = true; return { data: result, error: null }; } };
  for (const request of [input({ siteId: "99990002" }), input({ command: { ...command, locationId: id(9) } }), input({ token: null })]) {
    await assert.rejects(executeOnsiteClock(request, client), /attendance_qr_invalid/);
  }
  for (const request of [input({ operationId: id(6) }), input({ command: null }), { ...input(), extra: true },
    { ...input(), allowNew: "true" }, { ...input(), authUserId: "other" }]) {
    await assert.rejects(executeOnsiteClock(request as OnsiteClockInput, client), /attendance_invalid_request/);
  }
  assert.equal(called, false);
});

test("tokenless GET receipt/status works without the signing key and still supplies current account context", async () => {
  const request = input({ command: null, token: null, operationId: command.operationId });
  delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
  const client: AttendanceSelfRpc = { rpc: async (_name, args) => {
    assert.deepEqual(args, { p_site: claims.siteId, p_auth: id(8), p_claims: null, p_command: null, p_operation: command.operationId, p_allow_new: false });
    return { data: result, error: null };
  } };
  assert.deepEqual(await executeOnsiteClock(request, client), result);
  assert.deepEqual(await executeOnsiteClock({ ...request, operationId: null }, service({ ...result, receipt: null })), { ...result, receipt: null });
});

test("clock result projects private data away and enforces exact expected employee, worker and receipt identity", () => {
  const expected = { siteId: claims.siteId, command, operationId: null };
  const privateEvent = { ...receipt, secret: "private" };
  const raw = { ...result, terminalSecret: "private", employeePhone: "private", receipt: privateEvent,
    state: { ...result.state, privateValue: "private", lastEvent: privateEvent } };
  assert.deepEqual(parseOnsiteClockResult(raw, expected), result);
  for (const bad of [{ ...result, employeeId: id(9) }, { ...result, employeeId: "bad" }, { ...result, employeeId: undefined },
    { ...result, workerId: id(9) }, { ...result, receipt: { ...receipt, operationId: id(9) } },
    { ...result, receipt: { ...receipt, locationId: id(9) } }, { ...result, state: { ...result.state, status: "off" } }]) {
    assert.throws(() => parseOnsiteClockResult(bad, expected), /attendance_unavailable/);
  }
});

test("only named onsite/attendance errors cross the service boundary; raw RPC failures stay private", async () => {
  assert.equal(ONSITE_QR_ERRORS.attendance_qr_invalid, 400);
  assert.equal(ONSITE_QR_ERRORS.attendance_qr_expired, 409);
  assert.equal(ONSITE_QR_ERRORS.attendance_qr_used, 409);
  assert.equal(ONSITE_QR_ERRORS.attendance_terminal_denied, 403);
  assert.equal(ONSITE_QR_ERRORS.attendance_settings_required, 409);
  for (const code of ["attendance_qr_expired", "attendance_qr_used", "attendance_terminal_denied", "attendance_worker_changed", "attendance_platform_paused", "attendance_settings_required"]) {
    await assert.rejects(executeOnsiteClock(input(), { rpc: async () => ({ data: null, error: { message: code } }) }), { message: code });
  }
  for (const client of [null, { rpc: async () => ({ data: null, error: { message: "secret postgres failure", code: "42P01" } }) },
    { rpc: async () => { throw Error("private network failure"); } }, service({ ...result, employeeId: id(9) })]) {
    await assert.rejects(executeOnsiteClock(input(), client), { message: "attendance_unavailable" });
  }
  await assert.rejects(executeOnsiteIssue(issueInput, { rpc: async () => ({ data: null, error: { message: "private failure" } }) }), { message: "attendance_unavailable" });
});
