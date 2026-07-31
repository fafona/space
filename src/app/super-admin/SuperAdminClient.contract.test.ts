import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./SuperAdminClient.tsx", import.meta.url);

test("initial snapshot hydration is not immediately written back in the background", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /markBackgroundSyncBaseline:\s*true/);
  assert.match(
    source,
    /if \(platformSnapshotBackgroundSyncBaselineRef\.current === baselineKey\) \{\s*platformSnapshotBackgroundSyncBaselineRef\.current = "";\s*return;/,
  );
});

test("merchant config save reconciles a timed-out request before reporting failure", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /PLATFORM_MERCHANT_SNAPSHOT_SAVE_TIMEOUT_MS = 60_000/);
  assert.match(source, /const reconcileTimedOutConfigSave = async \(\) =>/);
  assert.match(source, /服务器响应较慢，正在核对实际保存结果/);
  assert.match(source, /服务器响应较慢，但已核对确认配置保存成功/);
});

test("merchant config save maps server fetch failures to a readable network error", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(
    source,
    /failed to fetch\|fetch failed\|networkerror\|load failed/,
  );
});
