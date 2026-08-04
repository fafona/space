import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(
  path.join(
    process.cwd(),
    "src",
    "components",
    "admin",
    "MerchantEnterpriseTodoCenter.tsx",
  ),
  "utf8",
);

test("todo center exposes the integration contract and all four actionable kinds", () => {
  assert.match(source, /^"use client";/);
  for (const prop of [
    "siteId: string",
    "actor: MerchantEnterpriseActor",
    "apiFetch: (path: string, init?: RequestInit) => Promise<Response>",
    "onOpenTask: (taskId: string) => void",
    "onOpenWorkflow: (workflowId: string, executionId?: string) => void",
    "onCountChange?: (count: number) => void",
    "refreshIntervalMs?: number",
  ]) {
    assert.ok(source.includes(prop), `missing todo center prop: ${prop}`);
  }
  assert.match(source, /normalizeMerchantEnterpriseTodoPage/);
  for (const kind of [
    "task",
    "workflow_acknowledgement",
    "workflow_execution",
    "workflow_feedback",
  ]) {
    assert.ok(source.includes(`\"${kind}\"`), `missing todo kind: ${kind}`);
  }
  assert.match(source, /onOpenTask\(item\.taskId\)/);
  assert.match(source, /onOpenWorkflow\(item\.workflowId, item\.executionId\)/);
  assert.match(source, /onCountChange\?\.\(openCount\)/);
});

test("todo center requests strict category pages and supports retry and pagination", () => {
  assert.match(
    source,
    /new URLSearchParams\(\{\s*siteId,\s*category,\s*limit: String\(PAGE_SIZE\)/,
  );
  assert.match(source, /query\.set\("cursor", options\.cursor\)/);
  assert.match(source, /`\$\{TODO_API\}\?\$\{query\.toString\(\)\}`/);
  assert.match(source, /page\.merchantId !== siteId/);
  assert.match(source, /page\.items\.length > PAGE_SIZE/);
  assert.match(source, /const categoryMismatch = page\?\.items\.some/);
  assert.match(source, /append: true, cursor: nextCursor/);
  assert.match(source, />\s*重新加载\s*</);
  assert.match(source, />\s*\{loadingMore \? "加载中…" : "加载更多"\}\s*</);
  for (const category of ["all", "tasks", "workflows"]) {
    assert.ok(source.includes(`[\"${category}\",`), `missing category: ${category}`);
  }
});

test("todo polling stops while hidden, refreshes on focus, and aborts stale requests", () => {
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /requestControllerRef\.current\?\.abort\(\)/);
  assert.match(
    source,
    /requestSequenceRef\.current === requestSequence[\s\S]{0,160}activeScopeRef\.current === scope/,
  );
  assert.match(
    source,
    /document\.visibilityState === "hidden"[\s\S]{0,120}stopPolling\(\)[\s\S]{0,180}abort\(\)/,
  );
  assert.match(source, /window\.addEventListener\("focus", handleFocus\)/);
  assert.match(source, /window\.clearInterval\(intervalId\)/);
  assert.match(source, /document\.removeEventListener\("visibilitychange"/);
  assert.match(source, /window\.removeEventListener\("focus"/);
});

test("todo center renders statistics, loading, failure, empty, and urgency states", () => {
  for (const label of [
    "任务待办",
    "待阅读确认",
    "流程执行中",
    "待处理反馈",
    "已逾期",
    "即将到期",
    "正在整理企业待办",
    "当前没有待办",
  ]) {
    assert.ok(source.includes(label), `missing todo state label: ${label}`);
  }
  assert.match(source, /role="alert"/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /aria-selected=\{category === value\}/);
  assert.match(source, /data-enterprise-todo-center/);
  assert.match(source, /data-todo-kind=\{item\.kind\}/);
});
