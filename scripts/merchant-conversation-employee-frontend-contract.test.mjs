import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL(
    "../src/components/enterprise/MerchantEmployeeConversationPanel.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("employee conversation UI uses only the injected business API client", () => {
  assert.match(source, /apiClient\(path, init\)/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
});

test("employee conversation UI exposes only the authorized text workflow", () => {
  assert.match(source, /access\.view/);
  assert.match(source, /access\.search/);
  assert.match(source, /access\.start/);
  assert.match(source, /access\.send/);
  assert.match(source, /action:\s*"lookup"/);
  assert.match(source, /action:\s*"ensure_contact"/);
  assert.match(source, /action:\s*"send"/);
  assert.doesNotMatch(source, /support-messages|attachment|upload|FormData/);
});
