import test from "node:test";
import assert from "node:assert/strict";
import { trafficEnvironment, trafficSource, isTrafficAction } from "./accountTraffic";
import { readTrafficResource, signTrafficResource, readTrafficJson, allowTrafficRequest } from "./accountTraffic.server";
import { resolveTrafficResources } from "./accountTrafficResources.server";
import type { Block } from "@/data/homeBlocks";
import { buildMerchantVisitsByMerchantId } from "@/app/api/super-admin/merchant-accounts/route-handler";

const secret = "traffic-test-independent-secret-32-bytes";
const resource = { siteId: "10000000", module: "card" as const, objectId: "stable-card-id", label: "公开名片" };
test("traffic signatures bind owner, module, stable ID and label, and expire", () => {
  const token = signTrafficResource(resource, secret, 100000);
  assert.deepEqual(readTrafficResource(token, secret, 100001), resource);
  assert.equal(readTrafficResource(token, secret, 3700000), null);
  assert.equal(readTrafficResource(token, secret + "x", 100001), null);
  assert.equal(readTrafficResource(token + ".extra", secret, 100001), null);
  const [body, sig] = token.split(".");
  const changed = JSON.parse(Buffer.from(body, "base64url").toString());
  changed.siteId = "20000000";
  assert.equal(readTrafficResource(`${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${sig}`, secret, 100001), null);
  assert.equal(signTrafficResource(resource, "short"), "");
  assert.equal(readTrafficResource(signTrafficResource({ ...resource, module: "__proto__" as never }, secret), secret), null);
});
test("source does not infer scanning/sharing from missing referrers or WeChat UA", () => {
  assert.equal(trafficSource("", "https://faolla.com"), "direct_unknown");
  assert.equal(trafficSource("https://google.com.evil.test/path", "https://faolla.com"), "other_referral");
  assert.equal(trafficSource("https://www.google.es/search?q=private", "https://faolla.com"), "google");
  assert.equal(trafficSource("https://faolla.com/private?email=test", "https://faolla.com"), "internal");
  assert.equal(trafficSource("javascript:evil", "https://faolla.com"), "direct_unknown");
  assert.equal(trafficEnvironment("Mozilla iPhone Mobile MicroMessenger").browser, "wechat");
  assert.equal(trafficEnvironment("Googlebot/2.1").bot, true);
  assert.equal(isTrafficAction("booking", "booking_success"), false);
  assert.equal(isTrafficAction("website", "phone_click"), false);
});
test("body size is checked while streaming, not just by content-length", async () => {
  const request = new Request("https://faolla.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: "x".repeat(3000) }) });
  await assert.rejects(readTrafficJson(request, 1024), /body_too_large/);
});
test("IP limiter expires and distinguishes context/collect budgets", () => {
  const request = new Request("https://faolla.com", { headers: { "x-real-ip": "test-address" } });
  for (let i = 0; i < 30; i++) assert.equal(allowTrafficRequest(request, "context", 1000), true);
  assert.equal(allowTrafficRequest(request, "context", 1000), false);
  assert.equal(allowTrafficRequest(request, "collect", 1000), true);
  assert.equal(allowTrafficRequest(request, "context", 61001), true);
});
test("resource resolver signs only an existing page in the active published plan", () => {
  const products = Array.from({ length: 550 }, (_, i) => ({ id: `p${i}`, name: `商品 ${i}` }));
  const block = { id: "products", type: "product", props: { heading: "产品", products } };
  const blocks = [{ ...block, props: { ...block.props, pagePlanConfig: { activePlanId: "plan-1", plans: [
    { id: "plan-1", pages: [{ id: "page-1", name: "首页", blocks: [block] }], activePageId: "page-1", blocks: [block] },
    { id: "plan-2", pages: [{ id: "draft", name: "未发布页面", blocks: [block] }], activePageId: "draft", blocks: [block] },
  ] } } }] as unknown as Block[];
  const scope = { siteId: "10000000", blocks, pageId: "page-1", viewport: "desktop" as const, catalog: null };
  assert.equal(resolveTrafficResources({ ...scope, pageId: "draft" }).length, 0);
  const resources = resolveTrafficResources(scope);
  assert.equal(resources.length, 553);
  assert.equal(resources.at(-1)?.objectId, "products/p549");
  assert.equal(resources.every((item) => item.siteId === scope.siteId), true);
  assert.equal(resolveTrafficResources({ ...scope, blocks: [] }).length, 0);
});
test("legacy totals are SQL totals, not a recount of truncated rows", () => {
  assert.deepEqual(buildMerchantVisitsByMerchantId([{ site_id: "10000000", today: 1200, day7: 2300, day30: 4400, total: 100000 }]).get("10000000"), { today: 1200, day7: 2300, day30: 4400, total: 100000 });
  assert.equal(buildMerchantVisitsByMerchantId([{ site_id: "bad", today: 1 }]).size, 0);
});

test("coupon/poll/membership resources use published identifiers, never questionnaire answers", () => {
  const blocks = [
    { id: "coupon-block", type: "coupon", props: { heading: "优惠券" } },
    { id: "poll-block", type: "poll", props: { heading: "意见投票", pollId: "poll-fixed", questions: [] } },
  ] as unknown as Block[];
  const resources = resolveTrafficResources({ siteId: "10000000", blocks, pageId: "page-1", viewport: "desktop", catalog: null });
  assert.ok(resources.some((item) => item.module === "coupon" && item.objectId === "coupon-block"));
  assert.ok(resources.some((item) => item.module === "poll" && item.objectId === "poll-block/poll-fixed"));
  assert.ok(resources.some((item) => item.module === "membership" && item.objectId === "membership-entry"));
  assert.equal(isTrafficAction("poll", "submit_attempt"), true);
  assert.equal(isTrafficAction("coupon", "claim_success"), false);
  assert.equal(isTrafficAction("membership", "join_attempt"), true);
  assert.equal(signTrafficResource({ ...resource, objectId: "a".repeat(241) }, secret), "");
});
