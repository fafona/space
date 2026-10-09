import { createHash, createHmac, scrypt, timingSafeEqual } from "node:crypto";
import { attendancePin } from "./merchantAttendancePin";
import { attendancePinPepper, PIN_SCRYPT_OPTIONS, withAttendancePinKdf } from "./merchantAttendancePin.server";
import { captureBrowserExact, captureBrowserUuid } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { operationalRuleLedgerEncode } from "./merchantAttendanceOperationalRuleLedger";

/** Credential mathematics only. The caller must authenticate the owner/device,
 * reserve the existing shared device attempt budget and verify the saved
 * independent subject before calling this module. This grants no clock lease. */
export const INDEPENDENT_PIN_KDF_DOMAIN = "faolla-attendance-independent-pin-v1";
export const INDEPENDENT_PIN_SALT_DOMAIN = "faolla-attendance-independent-pin-salt-v1";
export type IndependentPinKdfBinding = Readonly<{
  siteId: string; workerId: string; subjectId: string; generation: number; credentialRevision: number;
}>;
function invalid(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
function binding(raw: IndependentPinKdfBinding): IndependentPinKdfBinding {
  try {
    const v = captureBrowserExact(raw, ["siteId", "workerId", "subjectId", "generation", "credentialRevision"]);
    if (typeof v.siteId !== "string" || v.siteId.length !== 8 || !/^[0-9]{8}$/.test(v.siteId)
      || typeof v.workerId !== "string" || v.workerId.length !== 36 || typeof v.subjectId !== "string" || v.subjectId.length !== 36
      || typeof v.generation !== "number" || !Number.isSafeInteger(v.generation) || Object.is(v.generation, -0) || v.generation < 0 || v.generation > 9007199254740990
      || typeof v.credentialRevision !== "number" || !Number.isSafeInteger(v.credentialRevision) || Object.is(v.credentialRevision, -0) || v.credentialRevision < 1 || v.credentialRevision > 9007199254740990) invalid();
    return Object.freeze({ siteId: v.siteId, workerId: captureBrowserUuid(v.workerId), subjectId: captureBrowserUuid(v.subjectId),
      generation: v.generation, credentialRevision: v.credentialRevision });
  } catch { return invalid(); }
}
function input(pin: string, salt: string, raw: IndependentPinKdfBinding, key: string) {
  attendancePin(pin);
  if (typeof salt !== "string" || salt.length !== 32 || !/^[0-9a-f]{32}$/.test(salt) || typeof key !== "string" || !key) invalid();
  return { pin, salt, binding: binding(raw), key };
}
async function derive(i: ReturnType<typeof input>): Promise<Buffer> {
  const b = i.binding, secret = createHmac("sha256", i.key).update(JSON.stringify([
    INDEPENDENT_PIN_KDF_DOMAIN, b.siteId, b.workerId, b.subjectId, b.generation, b.credentialRevision, i.pin,
  ])).digest();
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(secret, Buffer.from(i.salt, "hex"), 32, PIN_SCRYPT_OPTIONS,
      (error, bytes) => error ? reject(error) : resolve(bytes)));
  } finally { secret.fill(0); }
}
/** Shares the exact process-wide zero-queue gate and cost with member PINs.
 * Return the verifier only to the authenticated service; never to the browser. */
export async function createIndependentPinVerifier(pin: string, salt: string, raw: IndependentPinKdfBinding, key = attendancePinPepper()): Promise<string> {
  const snapshot = input(pin, salt, raw, key);
  return withAttendancePinKdf(async () => {
    const bytes = await derive(snapshot);
    try { return bytes.toString("hex"); } finally { bytes.fill(0); }
  });
}
/** A boolean is not an authenticated subject or a reusable successful lease.
 * Nonexistent/denied subjects must still use a synthetic verifier through this
 * same cost path; the caller separately keeps the final result denied. */
export async function checkIndependentPinVerifier(pin: string, salt: string, raw: IndependentPinKdfBinding, verifier: string, key = attendancePinPepper()): Promise<boolean> {
  const snapshot = input(pin, salt, raw, key);
  if (typeof verifier !== "string" || verifier.length !== 64 || !/^[0-9a-f]{64}$/.test(verifier)) invalid();
  return withAttendancePinKdf(async () => {
    const expected = Buffer.from(verifier, "hex"), actual = await derive(snapshot);
    try { return timingSafeEqual(actual, expected); } finally { actual.fill(0); expected.fill(0); }
  });
}
function operation(raw: string): string {
  if (typeof raw !== "string" || raw.length !== 36) invalid();
  try { return captureBrowserUuid(raw); } catch { return invalid(); }
}
/** Stable private salt for exact issue retries; no PIN enters this commitment.
 * The pepper is the already configured service secret, never a browser key. */
export function independentAttendanceIssueSalt(raw: IndependentPinKdfBinding, operationId: string, key = attendancePinPepper()): string {
  const b = binding(raw), op = operation(operationId);
  if (typeof key !== "string" || !key) invalid();
  const bytes = createHmac("sha256", key).update(operationalRuleLedgerEncode([
    INDEPENDENT_PIN_SALT_DOMAIN, b.siteId, b.workerId, b.subjectId, b.generation, b.credentialRevision, op,
  ])).digest();
  try { return bytes.subarray(0, 16).toString("hex"); } finally { bytes.fill(0); }
}
/** Private-only SQL-matching material SHA; not a public command fingerprint. */
export function independentAttendanceMaterialCommitment(raw: IndependentPinKdfBinding, operationId: string, salt: string, verifier: string): string {
  const b = binding(raw), op = operation(operationId);
  if (typeof salt !== "string" || salt.length !== 32 || !/^[0-9a-f]{32}$/.test(salt)
    || typeof verifier !== "string" || verifier.length !== 64 || !/^[0-9a-f]{64}$/.test(verifier)) invalid();
  return createHash("sha256").update(operationalRuleLedgerEncode([
    "attendance-independent-pin-material-v1", b.siteId, b.workerId, b.subjectId, b.generation, b.credentialRevision, op, salt, verifier,
  ])).digest("hex");
}
/** Exactly one shared zero-queue KDF acquisition; callers must not nest it. */
export async function deriveIndependentAttendanceIssuePin(pin: string, key: string, raw: IndependentPinKdfBinding, operationId: string): Promise<Readonly<{ salt: string; verifier: string; commitment: string }>> {
  const b = binding(raw), op = operation(operationId), salt = independentAttendanceIssueSalt(b, op, key), snapshot = input(pin, salt, b, key);
  return withAttendancePinKdf(async () => {
    const bytes = await derive(snapshot);
    try {
      const verifier = bytes.toString("hex");
      return Object.freeze({ salt, verifier, commitment: independentAttendanceMaterialCommitment(b, op, salt, verifier) });
    } finally { bytes.fill(0); }
  });
}
