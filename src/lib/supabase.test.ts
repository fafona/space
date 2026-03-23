import assert from "node:assert/strict";
import test from "node:test";
import { resolveBrowserSupabaseProxyUrl } from "./supabase";

test("resolveBrowserSupabaseProxyUrl uses same-origin proxy for http portal to upstream IP", () => {
  assert.equal(
    resolveBrowserSupabaseProxyUrl("http://faolla.com", "http://101.44.37.126:8000"),
    "http://faolla.com/api/supabase-proxy",
  );
});

test("resolveBrowserSupabaseProxyUrl uses same-origin proxy for https portal to http upstream", () => {
  assert.equal(
    resolveBrowserSupabaseProxyUrl("https://faolla.com", "http://101.44.37.126:8000"),
    "https://faolla.com/api/supabase-proxy",
  );
});

test("resolveBrowserSupabaseProxyUrl skips proxy when origin already matches", () => {
  assert.equal(resolveBrowserSupabaseProxyUrl("https://faolla.com", "https://faolla.com"), "");
});

test("resolveBrowserSupabaseProxyUrl skips proxy for invalid input", () => {
  assert.equal(resolveBrowserSupabaseProxyUrl("", "http://101.44.37.126:8000"), "");
  assert.equal(resolveBrowserSupabaseProxyUrl("https://faolla.com", ""), "");
  assert.equal(resolveBrowserSupabaseProxyUrl("not-a-url", "http://101.44.37.126:8000"), "");
});
