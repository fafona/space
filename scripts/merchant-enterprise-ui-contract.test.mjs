import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const managerPath = path.join(
  process.cwd(),
  "src",
  "components",
  "admin",
  "MerchantEnterpriseManager.tsx",
);
const source = readFileSync(managerPath, "utf8");

function sliceBetween(startPattern, endPattern, label) {
  const startMatch = startPattern.exec(source);
  assert.ok(startMatch, `${label} start marker is missing`);
  const start = startMatch.index;
  const endMatch = endPattern.exec(source.slice(start + startMatch[0].length));
  assert.ok(endMatch, `${label} end marker is missing`);
  const end = start + startMatch[0].length + endMatch.index;
  return source.slice(start, end);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("enterprise task dates use one non-translated YYYY-MM-DD field in create and edit flows", () => {
  const dateFieldSource = sliceBetween(
    /(?:function\s+EnterpriseDateField\b|const\s+EnterpriseDateField\s*=)/,
    /function\s+TaskEditor\b/,
    "EnterpriseDateField",
  );
  const inputTags = [...dateFieldSource.matchAll(/<input\b[\s\S]*?\/>/g)].map(
    (match) => match[0],
  );
  const visibleInput = inputTags.find((tag) => /type=["']text["']/.test(tag));
  const nativePicker = inputTags.find((tag) => /type=["']date["']/.test(tag));

  assert.ok(visibleInput, "EnterpriseDateField must expose a text input");
  assert.match(visibleInput, /placeholder=["']YYYY-MM-DD["']/);
  assert.match(visibleInput, /translate=["']no["']/);
  assert.match(visibleInput, /inputMode=["']numeric["']/);

  assert.ok(nativePicker, "EnterpriseDateField must retain a native date picker");
  assert.match(nativePicker, /aria-hidden=["']true["']/);
  assert.match(nativePicker, /tabIndex=\{-1\}/);
  assert.match(nativePicker, /(?:opacity-0|\bhidden\b)/);

  const nativeDateInputs = source.match(/type=["']date["']/g) ?? [];
  assert.equal(
    nativeDateInputs.length,
    1,
    "raw date inputs must stay inside EnterpriseDateField so browser-localized placeholders are never visible",
  );

  const usages = [...source.matchAll(/<EnterpriseDateField\b[\s\S]*?\/>/g)].map(
    (match) => match[0],
  );
  assert.ok(
    usages.some((usage) => /\btaskDueAt\b/.test(usage)),
    "the create-task due date must use EnterpriseDateField",
  );
  assert.ok(
    usages.some((usage) => /\bdueAt\b/.test(usage) && !/\btaskDueAt\b/.test(usage)),
    "the task editor due date must use EnterpriseDateField",
  );
});

test("a successful mutation returns its payload even when the overview refresh fails", () => {
  const mutateSource = sliceBetween(
    /const\s+mutate\s*=\s*useCallback\b/,
    /async\s+function\s+bootstrap\b/,
    "mutate callback",
  );

  assert.match(
    mutateSource,
    /const\s+reloaded\s*=\s*await\s+loadOverview\(\{\s*preserveData:\s*true\s*\}\)/,
  );
  assert.match(
    mutateSource,
    /if\s*\(\s*!reloaded\s*\)\s*\{[\s\S]{0,800}已保存，但列表刷新失败，请手动刷新页面确认。/,
    "refresh failure must be distinguished from write failure",
  );
  assert.doesNotMatch(
    mutateSource,
    /if\s*\(\s*!reloaded\s*\)\s*(?:\{\s*)?return\s+null\s*;/,
    "a completed write must not be reported to callers as a failed mutation",
  );

  const refreshIndex = mutateSource.indexOf("const reloaded");
  const fallbackIndex = mutateSource.indexOf(
    "已保存，但列表刷新失败，请手动刷新页面确认。",
  );
  const payloadReturnIndex = mutateSource.lastIndexOf("return payload");
  assert.ok(refreshIndex >= 0 && refreshIndex < fallbackIndex);
  assert.ok(
    fallbackIndex < payloadReturnIndex,
    "mutate must return the successful response payload after handling refresh failure",
  );
});

test("create-task retries reuse an operation id only while the form fingerprint is unchanged", () => {
  const reusableRefMatch = source.match(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*useRef<\{(?=[\s\S]{0,500}\b(?:fingerprint|signature|draftKey|key)\s*:\s*string)(?=[\s\S]{0,500}\boperationId\s*:\s*string)[\s\S]{0,500}?\}\s*\|\s*null>\(null\)/,
  );
  assert.ok(
    reusableRefMatch,
    "task creation needs a ref containing both the draft fingerprint and operationId",
  );
  const operationRef = reusableRefMatch[1];
  assert.match(operationRef, /(?:task.*create|create.*task)/i);

  const keyFieldMatch = reusableRefMatch[0].match(
    /\b(fingerprint|signature|draftKey|key)\s*:\s*string/,
  );
  assert.ok(keyFieldMatch);
  const keyField = keyFieldMatch[1];
  const escapedRef = escapeRegExp(operationRef);
  const escapedKey = escapeRegExp(keyField);
  const createTaskSource = sliceBetween(
    /async\s+function\s+createTask\b/,
    /async\s+function\s+moveTask\b/,
    "createTask",
  );

  const taskInputMatch = createTaskSource.match(
    /const\s+taskInput\s*=\s*\{[\s\S]*?\n\s*\};/,
  );
  assert.ok(taskInputMatch, "createTask must collect the submitted task fields before mutation");
  for (const field of [
    "activeBoard.id",
    "activeColumns[0].id",
    "taskTitle",
    "taskDescription",
    "taskPriority",
    "taskDueAt",
    "taskAssigneeIds",
  ]) {
    assert.ok(
      taskInputMatch[0].includes(field),
      `the submitted task fields must include ${field}`,
    );
  }
  assert.match(
    createTaskSource,
    /const\s+fingerprint\s*=\s*JSON\.stringify\(taskInput\)/,
    "the idempotency key must be tied to the complete submitted task payload",
  );

  assert.match(
    createTaskSource,
    new RegExp(`${escapedRef}\\.current\\?\\.${escapedKey}\\s*!==\\s*fingerprint`),
    "a changed form fingerprint must receive a new operation id",
  );
  assert.match(
    createTaskSource,
    new RegExp(`${escapedRef}\\.current(?:\\?\\.|\\.)operationId`),
  );
  assert.match(
    createTaskSource,
    /createClientMutationOperationId\(\s*["']enterprise-task-create["']\s*\)/,
  );
  assert.match(
    createTaskSource,
    /\.\.\.taskInput,\s*operationId,/,
    "the retained operation id must be sent with the submitted task payload",
  );
  assert.match(
    createTaskSource,
    new RegExp(
      `${escapedRef}\\.current\\s*=\\s*\\{[\\s\\S]{0,300}${escapedKey}[\\s\\S]{0,300}operationId`,
    ),
    "the chosen operation id and fingerprint must be retained before the request",
  );
  assert.match(
    createTaskSource,
    new RegExp(
      `if\\s*\\(\\s*payload\\s*\\)\\s*\\{[\\s\\S]{0,1000}${escapedRef}\\.current\\s*=\\s*null`,
    ),
    "the reusable operation id must be cleared only after a successful mutation",
  );
});
