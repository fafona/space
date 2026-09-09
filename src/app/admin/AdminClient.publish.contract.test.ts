import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import {
  isServerPublishConfirmed,
  readServerPublishCompletionError,
  type ServerPublishAttemptResult,
} from "../../lib/serverPublishConfirmation";

const source = readFileSync(new URL("./AdminClient.tsx", import.meta.url), "utf8");

function between(start: string, end: string) {
  const offset = source.indexOf(start);
  const limit = source.indexOf(end, offset);
  assert.ok(offset >= 0 && limit > offset, `audited source boundary ${start} exists`);
  return source.slice(offset, limit);
}

const publish = between("  async function publishToFrontend()", "  async function logout()");
const serverAttempt = between("  async function trySaveViaServerPublishApi(", "  function openAlert(");
const compiled = ts.transpileModule(`${serverAttempt}\nexports.attempt = trySaveViaServerPublishApi;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

type SyntheticResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type CapturedBody = {
  requestId: string;
  payload: { blocks: unknown[]; updated_at: string };
  merchantIds: string[];
  isPlatformEditor: boolean;
};

function createAttempt(reply: (body: CapturedBody, signal: AbortSignal) => Promise<SyntheticResponse>, platform = false) {
  const runtimeModule = { exports: {} };
  const calls: CapturedBody[] = [];
  const timers: Array<() => void> = [];
  let cleared = 0;
  // Execute only the actual source function in a synthetic VM, not React,
  // Supabase, process credentials, real timers, or a business endpoint.
  runInNewContext(compiled, {
    exports: runtimeModule.exports,
    AbortController,
    isPlatformEditor: platform,
    merchantIdsRef: { current: ["synthetic-merchant"] },
    mergePreferredMerchantIds: (preferred: string[], current: string[]) => [...new Set([...preferred, ...current])],
    isServerPublishConfirmed,
    normalizePublishApiErrorMessage: (_code: string, message: string) => message,
    window: {
      setTimeout(callback: () => void) { timers.push(callback); return timers.length; },
      clearTimeout() { cleared += 1; },
    },
    fetch: async (url: string, init: { method: string; body: string; signal: AbortSignal }) => {
      assert.equal(url, "/api/publish");
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body) as CapturedBody;
      calls.push(body);
      return reply(body, init.signal);
    },
  }, { filename: "AdminClient.publish.synthetic.cjs" });
  const api = runtimeModule.exports as {
    attempt: (payload: { blocks: unknown[]; updated_at: string }) => Promise<ServerPublishAttemptResult>;
  };
  return { api, calls, timers, cleared: () => cleared };
}

const payload = { blocks: [{ id: "synthetic-block" }], updated_at: "2026-09-09T10:00:00.000Z" };

test("AdminClient no longer contains browser pages mutation or its compatibility fallback", () => {
  assert.doesNotMatch(source, /saveBlocksToSupabaseFallback|trySaveWithResolvedMerchantIds|pagesUpdatedAtColumnSupported|isMissingUpdatedAtColumn/);
  assert.doesNotMatch(source, /supabase\s*\.from\(["']pages["']\)[\s\S]{0,120}\.\s*(?:update|upsert|insert|delete)\s*\(/);
  assert.equal((serverAttempt.match(/fetch\("\/api\/publish"/g) ?? []).length, 1);
  assert.doesNotMatch(serverAttempt, /waitBeforeRetry|for\s*\(|while\s*\(|supabase\./);
});

test("draft persistence precedes publishing, while published metadata only follows confirmed success", () => {
  const attempt = publish.indexOf("const serverPublishResult = await trySaveViaServerPublishApi");
  const guard = publish.indexOf("const error = readServerPublishCompletionError(serverPublishResult)");
  const success = publish.indexOf("recordPublishedVersion(publishedBlocks, storeScope)");
  assert.ok(publish.indexOf("saveBlocksToStorage(isPlatformEditor ? combinedBlocks : draftBlocks, storeScope)") < attempt);
  assert.ok(attempt > 0 && guard > attempt && success > guard);
  const beforeSuccess = publish.slice(0, success);
  assert.doesNotMatch(beforeSuccess, /recordPublishedVersion\(|savePublishedBlocksToStorage\(|recordRemoteContentVerifiedTimestamp\(|broadcastPublishSync\(/);
  const failure = publish.slice(publish.indexOf("if (error)", guard), success);
  assert.match(failure, /savePublishFailureSnapshot\(/);
  assert.match(failure, /success: false/);
  assert.match(failure, /return;\s*}\s*$/);
  assert.match(failure, /error\.code !== "publish_result_unconfirmed" && shouldOfferCompressionPresetForPublishError/);
  const afterSuccess = publish.slice(success, publish.indexOf("} catch (error)", success));
  for (const required of [
    "recordPublishedVersion(combinedBlocks, storeScope)",
    "savePublishedBlocksToStorage(combinedBlocks, storeScope)",
    "recordRemoteContentVerifiedTimestamp(storeScope)",
    "savePublishedBlocksToStorage(combinedBlocks, buildSiteStoreScope(siteId))",
    "broadcastPublishSync(mirrorSiteIds)", "setRemoteContentVerified(true)", "success: true",
  ]) assert.ok(afterSuccess.includes(required), required);
});

test("publish exceptions still preserve failure recovery without writing published metadata", () => {
  const failure = publish.slice(publish.lastIndexOf("} catch (error)"));
  assert.match(failure, /savePublishFailureSnapshot\(/);
  assert.match(failure, /success: false/);
  assert.doesNotMatch(failure, /recordPublishedVersion\(|savePublishedBlocksToStorage\(|recordRemoteContentVerifiedTimestamp\(|broadcastPublishSync\(/);
});

test("the actual server attempt accepts real merchant and platform ACKs after one POST", async () => {
  for (const platform of [false, true]) {
    const runtime = createAttempt(async (body) => ({
      ok: true, status: 200, json: async () => ({
        ok: true, requestId: body.requestId, updatedAt: body.payload.updated_at,
        mode: body.isPlatformEditor ? "platform" : "merchant", merchantCount: body.merchantIds.length,
        postPublishSyncScheduled: true,
      }),
    }), platform);
    const result = await runtime.api.attempt(payload);
    assert.equal(readServerPublishCompletionError(result), null);
    assert.equal(runtime.calls.length, 1);
    assert.equal(runtime.cleared(), 1);
  }
});

test("network loss and malformed success never retry or turn into confirmed publication", async () => {
  const cases: Array<(body: CapturedBody) => Promise<SyntheticResponse>> = [
    async () => { throw new Error("synthetic connection lost after possible commit"); },
    async () => ({ ok: true, status: 200, json: async () => { throw new Error("synthetic HTML response"); } }),
    async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) }),
    async (body) => ({ ok: true, status: 200, json: async () => ({
      ok: true, requestId: `${body.requestId}-wrong`, updatedAt: body.payload.updated_at, mode: "merchant", merchantCount: 1,
    }) }),
  ];
  for (const reply of cases) {
    const runtime = createAttempt(reply);
    const result = await runtime.api.attempt(payload);
    assert.equal(readServerPublishCompletionError(result)?.code, "publish_result_unconfirmed");
    assert.equal(runtime.calls.length, 1);
    assert.equal(runtime.cleared(), 1);
  }
});

test("server unavailable or rejection remains failure after one POST without browser fallback", async () => {
  for (const status of [401, 403, 404, 409, 500, 503]) {
    const runtime = createAttempt(async () => ({
      ok: false, status, json: async () => ({ code: "synthetic_failure", message: "synthetic rejection" }),
    }));
    const result = await runtime.api.attempt(payload);
    assert.equal(readServerPublishCompletionError(result)?.code, "synthetic_failure");
    assert.equal(runtime.calls.length, 1);
    assert.equal(runtime.cleared(), 1);
  }
});

test("attempt timeout remains attached while reading the response body and ends as unconfirmed", async () => {
  let reading = false;
  let notifyReading = () => {};
  const readingStarted = new Promise<void>((resolve) => { notifyReading = resolve; });
  const runtime = createAttempt(async (_body, signal) => ({
    ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => {
      reading = true;
      signal.addEventListener("abort", () => reject(new Error("synthetic aborted body")), { once: true });
      notifyReading();
    }),
  }));
  const pending = runtime.api.attempt(payload);
  await readingStarted;
  assert.equal(reading, true);
  assert.equal(runtime.cleared(), 0);
  runtime.timers[0]();
  assert.equal(readServerPublishCompletionError(await pending)?.code, "publish_result_unconfirmed");
  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.cleared(), 1);
});
