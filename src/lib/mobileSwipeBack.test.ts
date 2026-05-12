import assert from "node:assert/strict";
import test from "node:test";

import {
  getMobileSwipeBackEdgeWidth,
  isMobileSwipeBackGesture,
  normalizeMobileSwipeBackPathname,
  resolveMobileSwipeBackHref,
} from "./mobileSwipeBack";

test("normalizes mobile swipe back pathnames", () => {
  assert.equal(normalizeMobileSwipeBackPathname(""), "/");
  assert.equal(normalizeMobileSwipeBackPathname("/industry/food/"), "/industry/food");
  assert.equal(normalizeMobileSwipeBackPathname("https://faolla.com/site/10000000?x=1"), "/site/10000000");
});

test("does not resolve main mobile routes", () => {
  assert.equal(resolveMobileSwipeBackHref("/industry/food"), "");
  assert.equal(resolveMobileSwipeBackHref("/site/10000000"), "");
  assert.equal(resolveMobileSwipeBackHref("/u/10000000"), "");
  assert.equal(resolveMobileSwipeBackHref("/share/business-card?target=/abc"), "");
  assert.equal(resolveMobileSwipeBackHref("/10000000"), "");
  assert.equal(resolveMobileSwipeBackHref("/card/demo"), "");
  assert.equal(resolveMobileSwipeBackHref("/admin"), "");
  assert.equal(resolveMobileSwipeBackHref("/me"), "");
  assert.equal(resolveMobileSwipeBackHref("/login"), "");
  assert.equal(resolveMobileSwipeBackHref("/foo"), "");
});

test("resolves known child routes with visible back affordances", () => {
  assert.equal(resolveMobileSwipeBackHref("/booking-calendar"), "/me");
  assert.equal(resolveMobileSwipeBackHref("/me/tools/shuangkoujifen"), "/me?mobileTab=self&selfSection=tools");
  assert.equal(resolveMobileSwipeBackHref("/admin/tools/shuangkoujifen"), "/admin?mobileTab=self&selfSection=tools");
  assert.equal(resolveMobileSwipeBackHref("/reset-password/bridge"), "/reset-password");
  assert.equal(resolveMobileSwipeBackHref("/reset-password"), "/login");
  assert.equal(resolveMobileSwipeBackHref("/card/demo/contact"), "/card/demo");
});

test("resolves super admin and generic nested routes", () => {
  assert.equal(resolveMobileSwipeBackHref("/super-admin/editor/latest"), "/super-admin/latest");
  assert.equal(resolveMobileSwipeBackHref("/super-admin/latest"), "");
  assert.equal(resolveMobileSwipeBackHref("/foo/bar/baz"), "/foo/bar");
  assert.equal(resolveMobileSwipeBackHref("/"), "");
});

test("preserves app shell params on fallback URLs", () => {
  assert.equal(
    resolveMobileSwipeBackHref("/booking-calendar", "?uiLocale=zh-CN&appShell=faolla&ignored=1"),
    "/me?appShell=faolla&uiLocale=zh-CN",
  );
  assert.equal(
    resolveMobileSwipeBackHref("/me/tools/shuangkoujifen", "?uiLocale=zh-CN&appShell=faolla&ignored=1"),
    "/me?mobileTab=self&selfSection=tools&appShell=faolla&uiLocale=zh-CN",
  );
  assert.equal(
    resolveMobileSwipeBackHref("/", "?appShell=faolla&uiLocale=zh-CN", "https://fafona.faolla.com"),
    "https://faolla.com/?appShell=faolla&uiLocale=zh-CN",
  );
  assert.equal(resolveMobileSwipeBackHref("/", "?appShell=faolla", "https://www.faolla.com"), "");
});

test("detects intentional right swipe back gestures", () => {
  assert.equal(getMobileSwipeBackEdgeWidth(390), 101);
  assert.equal(
    isMobileSwipeBackGesture({
      startX: 24,
      startY: 320,
      endX: 130,
      endY: 334,
      viewportWidth: 390,
      elapsedMs: 220,
    }),
    true,
  );
  assert.equal(
    isMobileSwipeBackGesture({
      startX: 160,
      startY: 320,
      endX: 280,
      endY: 326,
      viewportWidth: 390,
      elapsedMs: 220,
    }),
    false,
  );
  assert.equal(
    isMobileSwipeBackGesture({
      startX: 24,
      startY: 320,
      endX: 150,
      endY: 430,
      viewportWidth: 390,
      elapsedMs: 220,
    }),
    false,
  );
  assert.equal(
    isMobileSwipeBackGesture({
      startX: 24,
      startY: 320,
      endX: 150,
      endY: 325,
      viewportWidth: 390,
      elapsedMs: 1200,
    }),
    false,
  );
});
