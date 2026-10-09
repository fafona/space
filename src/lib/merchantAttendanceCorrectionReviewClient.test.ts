import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceCorrectionReviewClient, correctionReviewDateQuery } from "./merchantAttendanceCorrectionReviewClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import type { CorrectionReviewQuery } from "./merchantAttendanceCorrectionReview";
import { correctionReviewDetail, createCorrectionReviewFixture, reviewQuery } from "../../scripts/fixtures/attendance-correction-review-model";
import { correctionSite as siteId, correctionId as id, correctionNow } from "../../scripts/fixtures/attendance-correction-model";
const list = correctionReviewDateQuery(siteId, "2026-09-01", "2026-09-30", "UTC", "all", null);
function setup(wrap?: (base: AttendanceApiFetch) => AttendanceApiFetch, timeoutMs = 2000) {
  const model = createCorrectionReviewFixture();
  return { model, client: new AttendanceCorrectionReviewClient({ siteId, apiFetch: wrap ? wrap(model.apiFetch) : model.apiFetch, timeoutMs }) };
}
const json = (body: unknown) => Response.json({ ok: true, moduleEnabled: false, ...body as object });

test("review date filters use local day bounds across DST, accept 30 days and reject reverse/long/invalid ranges", () => {
  assert.equal(correctionReviewDateQuery(siteId, "2026-10-25", "2026-10-25", "Europe/Madrid", "all", null).fromAt, "2026-10-24T22:00:00.000000Z");
  assert.equal(correctionReviewDateQuery(siteId, "2026-10-25", "2026-10-25", "Europe/Madrid", "all", null).toAt, "2026-10-25T23:00:00.000000Z");
  for (const [from, through, zone] of [["2026-09-01", "2026-10-01", "UTC"], ["2026-09-30", "2026-09-01", "UTC"],
    ["2026-02-30", "2026-02-30", "UTC"], ["2026-09-01", "2026-09-01", "Invalid/Zone"]])
    assert.throws(() => correctionReviewDateQuery(siteId, from, through, zone, "all", null));
});
test("review is initially inert and only explicit queries GET; paused attendance still allows historical read", async () => {
  const s = setup(); assert.equal(s.model.calls.length, 0); await s.client.refresh(); await s.client.first(); await s.client.next(); await s.client.detail(id(100));
  assert.equal(s.model.calls.length, 0); await s.client.load(list); assert.equal(s.client.getSnapshot().phase, "ready");
  assert.equal(s.client.getSnapshot().result?.moduleEnabled, false); await s.client.detail(id(100));
  assert.equal(s.client.getSnapshot().result?.mode, "detail"); assert.ok(s.model.calls.every(c => c.method === "GET"));
  await s.client.first(); assert.equal(s.client.getSnapshot().result?.mode, "list");
});
test("details only open a listed ID, and cross-tenant or injected invalid queries discard stale retry targets", async () => {
  const s = setup(); await s.client.load(list); const before = s.model.calls.length;
  await s.client.detail(id(999)); assert.equal(s.model.calls.length, before);
  for (const query of [{ ...reviewQuery, siteId: "99990002" }, { ...reviewQuery, approve: true }]) {
    await s.client.load(query as CorrectionReviewQuery); assert.equal(s.client.getSnapshot().phase, "blocked");
    assert.equal(s.client.getSnapshot().result, null); await s.client.first(); await s.client.refresh();
  }
  assert.equal(s.model.calls.length, before);
});
test("filter reset clears remembered queries: visibility refresh cannot resurrect old worker/date data", async () => {
  const s = setup(); await s.client.load(list); s.client.invalidate(true); const before = s.model.calls.length;
  assert.equal(s.client.getSnapshot().result, null); assert.equal(s.client.getSnapshot().query, null);
  await s.client.refresh(); await s.client.first(); await s.client.next(); assert.equal(s.model.calls.length, before);
});
test("invalidation discards late responses even if transport ignores abort", async () => {
  let release!: (r: Response) => void;
  const s = setup(() => async () => new Promise<Response>(resolve => { release = resolve; }));
  const pending = s.client.load(reviewQuery); s.client.invalidate(); release(json(correctionReviewDetail())); await pending;
  assert.equal(s.client.getSnapshot().phase, "idle"); assert.equal(s.client.getSnapshot().result, null);
});
test("newer query supersedes an older result rather than mixing request identities", async () => {
  let release!: (r: Response) => void, n = 0;
  const s = setup(base => async (path, init) => ++n === 1 ? new Promise<Response>(resolve => { release = resolve; }) : base(path, init));
  const old = s.client.load(reviewQuery); await s.client.load(list); release(json(correctionReviewDetail())); await old;
  assert.equal(s.client.getSnapshot().result?.mode, "list");
});
test("permission loss or offline refresh clears all private evidence without an automatic retry", async () => {
  for (const mode of ["denied", "offline"]) {
    const s = setup(); await s.client.load(reviewQuery); assert.equal(s.client.getSnapshot().phase, "ready");
    s.model.mode(mode); await s.client.refresh(); assert.equal(s.client.getSnapshot().phase, "blocked");
    assert.equal(s.client.getSnapshot().result, null); assert.equal(s.model.calls.length, 2);
  }
});
test("body deadline includes unfinished body and cancels the stream", async () => {
  let cancelled = false;
  const s = setup(() => async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":')); }, cancel() { cancelled = true; } }),
    { headers: { "content-type": "application/json" } }), 50);
  await s.client.load(reviewQuery); assert.equal(s.client.getSnapshot().phase, "blocked"); assert.equal(cancelled, true);
});
test("oversized, malformed, mismatched, or approval-bearing responses fail closed", async () => {
  for (const body of [{ ...correctionReviewDetail(), approvalAvailable: true }, { ...correctionReviewDetail(), siteId: "99990002" },
    { ...correctionReviewDetail(), privatePayload: "x".repeat(262144) }, { ...correctionReviewDetail(), moduleEnabled: undefined }]) {
    const s = setup(() => async () => json(body)); await s.client.load(reviewQuery);
    assert.equal(s.client.getSnapshot().phase, "blocked"); assert.equal(s.client.getSnapshot().result, null);
  }
});
test("empty filtered batch uses scanned cursor and stable cutoff; returning to first resets the snapshot", async () => {
  const requests: URLSearchParams[] = [], cursor = { recordedAt: "2026-09-29T12:00:00.123456Z", requestId: id(50) };
  const s = setup(() => async path => { const q = new URL(path, "https://synthetic.invalid").searchParams; requests.push(q);
    return json({ siteId, mode: "list", asOf: q.get("asOf") ?? correctionNow, approvalAvailable: false, rulesEnforced:true,decisionsAvailable:true,items: [],
      scanned: q.has("cursorId") ? 0 : 50, nextCursor: q.has("cursorId") ? null : cursor }); });
  await s.client.load({ ...list, status: "withdrawn" }); await s.client.next();
  assert.equal(requests[1].get("asOf"), correctionNow); assert.equal(requests[1].get("cursorAt"), cursor.recordedAt);
  assert.equal(requests[1].get("cursorId"), cursor.requestId); await s.client.next(); assert.equal(requests.length, 2);
  await s.client.first(); assert.equal(requests[2].get("asOf"), null); assert.equal(requests[2].get("cursorId"), null);
  assert.equal(requests[2].get("status"), "withdrawn");
});
test("GET read requests use no-store and cancellation, never write or schedule polling", async () => {
  const methods: string[] = []; const s = setup(base => async (path, init) => {
    methods.push(init?.method ?? "GET"); assert.equal(init?.cache, "no-store"); assert.ok(init?.signal); return base(path, init);
  });
  await s.client.load(list); await s.client.detail(id(100)); s.client.invalidate(); await s.client.refresh();
  assert.deepEqual(methods, ["GET", "GET", "GET"]);
});
