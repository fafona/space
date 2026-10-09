import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac, scryptSync } from "node:crypto";
import { createIndependentPinVerifier, checkIndependentPinVerifier, INDEPENDENT_PIN_KDF_DOMAIN, INDEPENDENT_PIN_SALT_DOMAIN, independentAttendanceIssueSalt, independentAttendanceMaterialCommitment, deriveIndependentAttendanceIssuePin, type IndependentPinKdfBinding } from "./merchantAttendanceIndependentPinKdf.server";
import { deriveAttendancePin, PIN_SCRYPT_OPTIONS, withAttendancePinKdf } from "./merchantAttendancePin.server";

const frame: IndependentPinKdfBinding = { siteId: "99990196", workerId: "19600000-0000-4000-8000-000000000001", subjectId: "19600000-0000-4000-8000-000000000002", generation: 0, credentialRevision: 1 };
const pin = "0123456789", salt = "17".repeat(16), key = "synthetic-test-only-independent-pin";
test("independent verifier uses its exact subject/generation/revision domain and verifies without a member identity", async () => {
  const secret = createHmac("sha256", key).update(JSON.stringify([INDEPENDENT_PIN_KDF_DOMAIN, frame.siteId, frame.workerId, frame.subjectId, 0, 1, pin])).digest();
  const expected = scryptSync(secret, Buffer.from(salt, "hex"), 32, PIN_SCRYPT_OPTIONS).toString("hex"); secret.fill(0);
  const actual = await createIndependentPinVerifier(pin, salt, frame, key);
  assert.equal(actual, expected); assert(await checkIndependentPinVerifier(pin, salt, frame, actual, key));
  assert.equal(await checkIndependentPinVerifier(pin, salt, { ...frame, credentialRevision: 2 }, actual, key), false);
  assert.notEqual(actual, await deriveAttendancePin(pin, salt, { siteId: frame.siteId, workerId: frame.workerId, employeeId: frame.subjectId }, key));
});
test("independent and member derivations share one zero-queue gate", async () => {
  await withAttendancePinKdf(async () => {
    await assert.rejects(createIndependentPinVerifier(pin, salt, frame, key), { code: "attendance_pin_busy" });
    await assert.rejects(checkIndependentPinVerifier(pin, salt, frame, "0".repeat(64), key), { code: "attendance_pin_busy" });
  });
  const pending = createIndependentPinVerifier(pin, salt, frame, key);
  await assert.rejects(withAttendancePinKdf(async () => "member-path"), { code: "attendance_pin_busy" });
  await pending;
});
test("malformed or ambiguous subject input is rejected before a derivation and never invokes getters", async () => {
  for (const patch of [{ employeeId: frame.subjectId }, { subjectId: null }, { generation: -0 }, { generation: -1 }, { credentialRevision: 0 }, { credentialRevision: Number.MAX_SAFE_INTEGER }, { siteId: "196" }])
    await assert.rejects(createIndependentPinVerifier(pin, salt, { ...frame, ...patch } as IndependentPinKdfBinding, key), { code: "attendance_invalid_request" });
  let calls = 0; const bad = { ...frame }; Object.defineProperty(bad, "subjectId", { enumerable: true, get() { calls++; return frame.subjectId; } });
  await assert.rejects(createIndependentPinVerifier(pin, salt, bad, key), { code: "attendance_invalid_request" }); assert.equal(calls, 0);
  await assert.rejects(checkIndependentPinVerifier(pin, salt, frame, "bad", key), { code: "attendance_invalid_request" });
});
test("issue salt and private material commitment are deterministic, exact tuple separated and require no KDF", () => {
  const op = "19600000-0000-4000-8000-000000000003", tuple = (v: unknown[]): string => `[${v.map(x => JSON.stringify(x)).join(", ")}]`;
  const expectedSalt = createHmac("sha256", key).update(tuple([INDEPENDENT_PIN_SALT_DOMAIN, frame.siteId, frame.workerId, frame.subjectId, 0, 1, op])).digest("hex").slice(0, 32);
  assert.equal(independentAttendanceIssueSalt(frame, op, key), expectedSalt);
  assert.notEqual(independentAttendanceIssueSalt({ ...frame, generation: 1 }, op, key), expectedSalt);
  assert.notEqual(independentAttendanceIssueSalt(frame, frame.workerId, key), expectedSalt);
  const verifier = "01".repeat(32), expectedCommitment = createHash("sha256").update(tuple(["attendance-independent-pin-material-v1", frame.siteId, frame.workerId, frame.subjectId, 0, 1, op, expectedSalt, verifier])).digest("hex");
  assert.equal(independentAttendanceMaterialCommitment(frame, op, expectedSalt, verifier), expectedCommitment);
  for (const value of [op + "\n", op.replace("19600000", "1960000A"), "bad"]) assert.throws(() => independentAttendanceIssueSalt(frame, value, key), { code: "attendance_invalid_request" });
  assert.throws(() => independentAttendanceIssueSalt({ ...frame, siteId: frame.siteId + "\n" }, op, key));
  assert.throws(() => independentAttendanceMaterialCommitment(frame, op, expectedSalt, verifier + "\n"));
});
test("issue KDF reserves only the existing shared gate and same intent material is stable", async () => {
  const op = "19600000-0000-4000-8000-000000000003";
  await withAttendancePinKdf(async () => { await assert.rejects(deriveIndependentAttendanceIssuePin(pin, key, frame, op), { code: "attendance_pin_busy" }); });
  const first = await deriveIndependentAttendanceIssuePin(pin, key, frame, op), retry = await deriveIndependentAttendanceIssuePin(pin, key, frame, op);
  assert.deepEqual(first, retry);
  assert.equal(first.commitment, independentAttendanceMaterialCommitment(frame, op, first.salt, first.verifier));
});
