import { strict as assert } from "node:assert";
import test from "node:test";
import {
  FALLBACK_FAOLLA_WEB_BUILD_ID,
  resolveFaollaWebBuildId,
  resolveFaollaWebReleasedAt,
} from "./faollaWebBuild";

test("resolves the public web build id first", () => {
  assert.equal(
    resolveFaollaWebBuildId({
      NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID: "public-sha",
      FAOLLA_WEB_BUILD_ID: "server-sha",
      GITHUB_SHA: "github-sha",
    }),
    "public-sha",
  );
});

test("falls back through server and github build ids", () => {
  assert.equal(resolveFaollaWebBuildId({ FAOLLA_WEB_BUILD_ID: "server-sha" }), "server-sha");
  assert.equal(resolveFaollaWebBuildId({ GITHUB_SHA: "github-sha" }), "github-sha");
});

test("uses a stable local fallback when no build id is available", () => {
  assert.equal(resolveFaollaWebBuildId({}), FALLBACK_FAOLLA_WEB_BUILD_ID);
});

test("resolves the optional release timestamp", () => {
  assert.equal(resolveFaollaWebReleasedAt({ FAOLLA_WEB_RELEASED_AT: "2026-05-04T08:45:00Z" }), "2026-05-04T08:45:00Z");
  assert.equal(resolveFaollaWebReleasedAt({}), "");
});
