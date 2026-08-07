import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(
  path.join(process.cwd(), "src", "app", "admin", "AdminClient.tsx"),
  "utf8",
);

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertOrdered(section, markers) {
  let cursor = -1;
  for (const marker of markers) {
    const index = section.indexOf(marker, cursor + 1);
    assert.notEqual(index, -1, `missing ordered source marker: ${marker}`);
    assert.ok(index > cursor, `source marker is out of order: ${marker}`);
    cursor = index;
  }
}

test("draft restore drains queued edits before history capture and snapshot application", () => {
  const restore = sourceBetween(
    "function restoreLatestSavedDraft()",
    "async function resolveFirstMerchantHint()",
  );

  assertOrdered(restore, [
    "readLatestDraftSnapshot(storeScope)",
    "flushPendingEditorChanges();",
    "pushUndoSnapshot(createSnapshot());",
    "applyPersistedBlocksToEditor(latestDraftSnapshot.blocks, { resetHistory: false });",
  ]);
});

test("published rollback follows the same pending-edit barrier as draft restore", () => {
  const rollback = sourceBetween(
    "function rollbackToLastSuccessfulPublished()",
    "function restoreLatestSavedDraft()",
  );

  assertOrdered(rollback, [
    "rollbackToPreviousPublishedVersion(storeScope)",
    "flushPendingEditorChanges();",
    "pushUndoSnapshot(createSnapshot());",
    "applyPersistedBlocksToEditor(previousPublished, { resetHistory: false });",
  ]);
});

test("pending editor flush commits text, patches, nudges, and plan sync in order", () => {
  const flush = sourceBetween(
    "function flushPendingEditorChanges()",
    "flushPendingEditorChangesRef.current = flushPendingEditorChanges;",
  );

  assertOrdered(flush, [
    "flushBufferedEditorTextCommits();",
    "flushPendingBlockPatches();",
    "flushPendingBlockNudges();",
    "flushPendingPlanSync();",
  ]);
});

test("persisted snapshot replaces live refs before React state or storage can observe it", () => {
  const applyPersisted = sourceBetween(
    "function applyPersistedBlocksToEditor(",
    "function copySelectedBlockStyleToViewport(",
  );

  assertOrdered(applyPersisted, [
    "const target = previewViewport === \"desktop\"",
    "const nextPlanConfig = clonePlanConfig(target.planConfig);",
    "const nextBlocks = cloneBlocks(target.blocks);",
    "const nextSelectedId = target.selectedId || \"\";",
    "planConfigRef.current = nextPlanConfig;",
    "editingPlanIdRef.current = target.editingPlanId;",
    "editingPageIdRef.current = target.editingPageId;",
    "blocksRef.current = nextBlocks;",
    "selectedIdRef.current = nextSelectedId;",
    "setPlanConfig(nextPlanConfig);",
    "setBlocks(nextBlocks);",
    "saveBlocksToStorage(combinedLoaded, storeScope);",
  ]);
});

test("manual draft save reports success only after both working copy and recovery point persist", () => {
  const saveDraft = sourceBetween(
    "function saveDraft()",
    "async function runPublishPreflightDialog(",
  );

  assertOrdered(saveDraft, [
    "flushPendingEditorChanges();",
    "const draftSaved = saveBlocksToStorage(combinedDraft, storeScope);",
    "const recoveryPointSaved = saveLatestDraftSnapshot(combinedDraft, storeScope);",
    "if (!draftSaved || !recoveryPointSaved)",
    "草稿未完整保存",
    "return;",
    'showSavePublishTip("草稿已保存");',
  ]);
});

test("remote draft hydration is tagged so it cannot replace a manual recovery point", () => {
  const hydration = sourceBetween(
    "const remoteDraftScopes = getRemoteDraftSyncScopes([remoteDraft.siteId, ...resolvedMerchantIds]);",
    "markRemoteDraftApplied(remoteDraft.updatedAt, remoteDraftScopes);",
  );

  assert.match(hydration, /saveLatestDraftSnapshot\(combinedLoaded, storeScope, \{[\s\S]*source: "remote",[\s\S]*sourceUpdatedAt: remoteDraft\.updatedAt/);
  assert.match(hydration, /saveLatestDraftSnapshot\(combinedLoaded, scope, \{[\s\S]*source: "remote",[\s\S]*sourceUpdatedAt: remoteDraft\.updatedAt/);
});
