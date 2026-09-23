import test from "node:test";
import assert from "node:assert/strict";
import { handleTrafficCollect } from "./route-handler";
import { signTrafficResource, readTrafficResource } from "@/lib/accountTraffic.server";
const secret = "independent-traffic-test-secret-at-least-32";
const token = signTrafficResource({ siteId: "10000000", module: "card", objectId: "card-1", label: "名片" }, secret);
const event = { id: "10000000-0000-4000-8000-000000000001", token, action: "view", source: "direct_unknown" };
const base = { enabled: () => true, allow: () => true, verify: (value: unknown) => readTrafficResource(value, secret) };
function request(events: unknown = [event], headers: Record<string, string> = {}) {
  return new Request("https://faolla.com/api/traffic/collect", { method: "POST", headers: { origin: "https://faolla.com", "content-type": "application/json", "user-agent": "Mozilla Mobile MicroMessenger", ...headers }, body: JSON.stringify({ events }) });
}
test("collector fails closed before database access for cross-origin and invalid token/scope", async () => {
  const deps = { ...base, client: () => { throw new Error("must not touch database"); } };
  assert.equal((await handleTrafficCollect(request([event], { origin: "https://evil.test" }), deps)).status, 403);
  for (const invalid of [{ ...event, token: token + "bad" }, { ...event, id: "bad" }, { ...event, source: "private-query" }, { ...event, action: "submit_attempt" }, { ...event, medium: "email@example.com" }, { ...event, medium: null }]) {
    assert.equal((await handleTrafficCollect(request([invalid]), deps)).status, 400);
  }
  assert.equal((await handleTrafficCollect(request(Array(11).fill(event)), deps)).status, 400);
});
test("collector trusts signed owner only, writes no private payload/time and deduplicates", async () => {
  let stored: unknown; let options: unknown;
  const client = { from: (table: string) => { assert.equal(table, "account_traffic_events"); return { upsert: (rows: unknown, opts: unknown) => {
    stored = rows; options = opts; return { abortSignal: async () => ({ error: null }) };
  } }; } };
  const response = await handleTrafficCollect(request([{ ...event, siteId: "20000000", created_at: "1900-01-01", email: "private@example.com", referrer: "https://example.com/?private=1" }]), { ...base, client: () => client as never });
  assert.equal(response.status, 204);
  assert.deepEqual(options, { onConflict: "site_id,event_id", ignoreDuplicates: true });
  assert.deepEqual(stored, [{ site_id: "10000000", event_id: event.id, module: "card", object_id: "card-1", object_label: "名片", action: "view", source: "direct_unknown", medium: "unknown", campaign_id: "", campaign_label: "", browser: "wechat", device: "mobile" }]);
});

test("link medium remains independent of referral and browser", async () => {
  let stored: unknown;
  const client = { from: () => ({ upsert: (rows: unknown) => { stored = rows; return { abortSignal: async () => ({ error: null }) }; } }) };
  assert.equal((await handleTrafficCollect(request([{ ...event, medium: "qr", source: "google" }]), { ...base, client: () => client as never })).status, 204);
  assert.deepEqual(stored, [{ site_id: "10000000", event_id: event.id, module: "card", object_id: "card-1", object_label: "名片", action: "view", source: "google", medium: "qr", campaign_id: "", campaign_label: "", browser: "wechat", device: "mobile" }]);
});
test("disabled, bot and privacy signals do not write; rate limit and outages remain bounded", async () => {
  const fail = () => { throw new Error("no database"); };
  assert.equal((await handleTrafficCollect(request(), { ...base, enabled: () => false, client: fail })).status, 204);
  assert.equal((await handleTrafficCollect(request([event], { "user-agent": "Googlebot" }), { ...base, client: fail })).status, 204);
  assert.equal((await handleTrafficCollect(request([event], { "sec-gpc": "1" }), { ...base, client: fail })).status, 204);
  assert.equal((await handleTrafficCollect(request(), { ...base, allow: () => false, client: fail })).status, 429);
  assert.equal((await handleTrafficCollect(request(), { ...base, client: fail })).status, 503);
});
