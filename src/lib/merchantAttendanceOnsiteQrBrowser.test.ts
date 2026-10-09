import assert from "node:assert/strict";
import test from "node:test";
import { buildOnsiteScanUrl, decodeOnsiteToken, parseOnsiteRecoveryLocation, parseOnsiteScanUrl, onsiteScanOrigin } from "./merchantAttendanceOnsiteQrBrowser";
const id = "00000000-0000-4000-8000-000000000001", origin = "https://www.faolla.com";
const claims = { v: 1, purpose: "faolla.attendance.onsite", siteId: "99990001", terminalId: id, locationId: id, pairedAtMs: 0, issuedAtMs: 1, expiresAtMs: 45001, nonce: id };
const token = "aq1." + Buffer.from(JSON.stringify(claims)).toString("base64url") + "." + "A".repeat(43);
test("browser decoding is structural only and scan links carry QR solely in fragment", () => {
  assert.deepEqual(decodeOnsiteToken(token), claims);
  const target = buildOnsiteScanUrl(origin, token), url = new URL(target);
  assert.equal(url.pathname, "/enterprise/attendance-scan"); assert.equal(url.search, "?siteId=99990001");
  assert.equal(url.hash, "#qr=" + token); assert.deepEqual(parseOnsiteScanUrl(target, origin), { siteId: claims.siteId, token, claims });
  assert.equal(parseOnsiteRecoveryLocation(target.split("#")[0], origin), claims.siteId);
  assert.equal(parseOnsiteRecoveryLocation(origin + "/enterprise/attendance-scan", origin), null);
});
test("client refuses foreign links, untrusted origins, aliases, duplicate params and credential fields", () => {
  const valid = buildOnsiteScanUrl(origin, token);
  for (const value of ["http://www.faolla.com", origin + "/", origin + "?next=a", "https://user@www.faolla.com", "javascript:alert(1)", origin + "/enterprise"]) assert.throws(() => onsiteScanOrigin(value));
  for (const value of [valid.replace("www.faolla.com", "other.invalid"), valid.replace("siteId=99990001", "siteId=99990002"), valid.replace("#qr=", "&token="),
    valid.replace("#qr=", "&siteId=99990001#qr="), valid + "&next=/admin", valid.replace("/attendance-scan", "/attendance-scan/"), valid.replace("#qr=", "#qr=%61"), " " + valid])
    assert.throws(() => parseOnsiteScanUrl(value, origin));
  assert.throws(() => parseOnsiteRecoveryLocation(valid, origin)); assert.throws(() => parseOnsiteRecoveryLocation(origin + "/enterprise/attendance-scan?token=bad", origin));
});
test("client rejects noncanonical payload/signature encoding and overlong tokens", () => {
  for (const value of [token + "=", token.slice(0, -1) + "B", token.replace("aq1", "aq2"), "x".repeat(1401),
    "aq1." + Buffer.from(JSON.stringify({ ...claims, authUserId: id })).toString("base64url") + "." + "A".repeat(43)]) assert.throws(() => decodeOnsiteToken(value));
});
