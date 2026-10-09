import assert from "node:assert/strict";
import test from "node:test";
import { attendanceSchedulePublicationRpcName as name } from "./merchantAttendanceSchedulePublicationDispatch.server";

const site = "99990001", original = "faolla_attendance_schedule_v1", evidenced = "faolla_attendance_schedule_evidenced_v1";
const environment = (enabled: string | undefined = "1", sites: string | undefined = site) => ({
  FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_ENABLED: enabled,
  FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_SITE_IDS: sites,
});

test("publish stays original unless both independent controls are explicit and valid", () => {
  assert.equal(name(site, "publish", {}), original);
  for (const enabled of [undefined, "", "0", "true", "yes", "01", "1 ", " 1", "1\n"])
    assert.equal(name(site, "publish", { ...environment(), FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_ENABLED: enabled }), original);
  for (const sites of [undefined, "", "*", "99990002", "99990001,*", "99990001,", ",99990001", "99990001,,99990002", "99990001,not-a-site", "99990001\n99990002"])
    assert.equal(name(site, "publish", { ...environment(), FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_SITE_IDS: sites }), original);
});
test("only an exact publish action and exact whitelisted merchant choose the evidenced wrapper", () => {
  const env = environment("1", " 99990002, 99990001 "); assert.equal(name(site, "publish", env), evidenced);
  for (const action of [null, "cancel", "GET", "", "Publish", "publish ", "clock_in"]) assert.equal(name(site, action, env), original);
  for (const value of ["99990003", "9999000", "999900010", " 99990001", "99990001 ", "99990001\n", "*"]) assert.equal(name(value, "publish", env), original);
});
test("allowlist accepts the100-entry4096-character boundaries and closes when either is exceeded", () => {
  assert.equal(name(site, "publish", environment("1", Array(100).fill(site).join(","))), evidenced);
  assert.equal(name(site, "publish", environment("1", Array(101).fill(site).join(","))), original);
  assert.equal(name(site, "publish", environment("1", " ".repeat(4088) + site)), evidenced);
  assert.equal(name(site, "publish", environment("1", " ".repeat(4089) + site)), original);
});
test("other feature switches cannot opt in schedule publication evidence or override its malformed list", () => {
  const other = { FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED: "1", FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS: site,
    NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_ENABLED: "1" };
  assert.equal(name(site, "publish", other), original);
  assert.equal(name(site, "publish", { ...other, ...environment("1", "*") }), original);
});
test("dispatch is a pure name selection and leaves the provided environment untouched", () => {
  const env = Object.freeze(environment()); assert.equal(name(site, "publish", env), evidenced);
  assert.equal(name(site, null, env), original); assert.deepEqual(env, environment());
});
