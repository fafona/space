import assert from "node:assert/strict";
import test from "node:test";

import { areBackgroundJobsPaused } from "./backgroundJobsPause";

test("background jobs preserve the default and exact zero behavior", () => {
  assert.equal(areBackgroundJobsPaused({}), false);
  assert.equal(areBackgroundJobsPaused({ FAOLLA_BACKGROUND_JOBS_PAUSED: "0" }), false);
});

test("exact one pauses background jobs", () => {
  assert.equal(areBackgroundJobsPaused({ FAOLLA_BACKGROUND_JOBS_PAUSED: "1" }), true);
});

test("explicit malformed pause values fail closed rather than enabling work", () => {
  for (const value of ["", " ", "false", "true", "01", "00", "2", "-1", "0 ", " 0", "off", "null"]) {
    assert.equal(areBackgroundJobsPaused({ FAOLLA_BACKGROUND_JOBS_PAUSED: value }), true, JSON.stringify(value));
  }
});

test("unrelated flags and caller environment are not changed", () => {
  const environment = Object.freeze({ OTHER_FLAG: "1", FAOLLA_BACKGROUND_JOBS_PAUSED: "0" });
  assert.equal(areBackgroundJobsPaused(environment), false);
  assert.deepEqual(environment, { OTHER_FLAG: "1", FAOLLA_BACKGROUND_JOBS_PAUSED: "0" });
});
