import test from "node:test";
import assert from "node:assert/strict";
import { createDomTranslationReporter, getDomTranslationStatus, requestDomTranslationRetry, subscribeDomTranslationRetry } from "./domTranslationStatus";

test("concurrent batches cannot report completion while another batch is pending", () => {
  const reporter = createDomTranslationReporter("es-ES");
  try {
    const a = reporter.begin(["one", "shared"]), b = reporter.begin(["two", "shared"]);
    assert.equal(getDomTranslationStatus().pendingCount, 3);
    reporter.finish(a, () => true);
    assert.equal(getDomTranslationStatus().state, "pending");
    assert.equal(getDomTranslationStatus().pendingCount, 2);
    reporter.finish(b, text => text !== "two");
    assert.deepEqual(getDomTranslationStatus(), { locale: "es-ES", state: "incomplete", pendingCount: 0, failedCount: 1 });
    const retry = reporter.begin(["two"]);
    reporter.finish(retry, () => true);
    assert.equal(getDomTranslationStatus().state, "idle");
  } finally { reporter.dispose(); }
});

test("old page responses and disposal cannot overwrite a newer locale", () => {
  const old = createDomTranslationReporter("es-ES"), batch = old.begin(["old"]);
  const current = createDomTranslationReporter("zh-CN"), fresh = current.begin(["new"]);
  try {
    old.finish(batch, () => false); old.dispose();
    assert.equal(getDomTranslationStatus().locale, "zh-CN");
    assert.equal(getDomTranslationStatus().state, "pending");
    current.finish(fresh, () => true);
    assert.equal(getDomTranslationStatus().state, "idle");
  } finally { old.dispose(); current.dispose(); }
});

test("retry is explicit, current-locale only, and unavailable during a pending batch", () => {
  const reporter = createDomTranslationReporter("zh-CN"), calls: string[] = [];
  const unsubscribe = subscribeDomTranslationRetry(locale => calls.push(locale));
  try {
    const job = reporter.begin(["text"]);
    requestDomTranslationRetry("zh-CN"); assert.deepEqual(calls, []);
    reporter.finish(job, () => false);
    requestDomTranslationRetry("es-ES"); assert.deepEqual(calls, []);
    requestDomTranslationRetry("zh-CN"); assert.deepEqual(calls, ["zh-CN"]);
    reporter.resetFailures(); assert.equal(getDomTranslationStatus().state, "idle");
    requestDomTranslationRetry("zh-CN"); assert.equal(calls.length, 1);
  } finally { unsubscribe(); reporter.dispose(); }
});
