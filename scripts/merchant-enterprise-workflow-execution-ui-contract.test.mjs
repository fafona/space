import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function normalizeSource(source) {
  return source.replace(/\r\n?/g, "\n");
}

const executionSource = normalizeSource(readFileSync(
  path.join(root, "src", "app", "enterprise", "[siteId]", "EnterpriseWorkflowExecutionPanel.tsx"),
  "utf8",
));
const governanceSource = normalizeSource(readFileSync(
  path.join(root, "src", "app", "enterprise", "[siteId]", "EnterpriseWorkflowGovernance.tsx"),
  "utf8",
));
const workflowSource = normalizeSource(readFileSync(
  path.join(root, "src", "app", "enterprise", "[siteId]", "EnterpriseWorkflowsPanel.tsx"),
  "utf8",
));
const managerSource = normalizeSource(readFileSync(
  path.join(root, "src", "components", "admin", "MerchantEnterpriseManager.tsx"),
  "utf8",
));
const taskBindingSource = normalizeSource(readFileSync(
  path.join(root, "src", "components", "admin", "MerchantTaskWorkflowBindingCard.tsx"),
  "utf8",
));

test("published workflow details expose employee execution and manager statistics", () => {
  assert.match(workflowSource, /<EnterpriseWorkflowExecutionPanel[\s\S]{0,400}workflow=\{selectedWorkflow\}/);
  assert.match(executionSource, /scope:\s*["']mine["'][\s\S]{0,240}workflowId:\s*workflow\.id/);
  assert.match(executionSource, /scope:\s*["']stats["'][\s\S]{0,240}workflowId:\s*workflow\.id/);
  assert.match(executionSource, /actor\.type\s*===\s*["']employee["']/);
  assert.match(executionSource, /permissions\.includes\(["']workflows\.manage["']\)/);
  assert.match(executionSource, />阅读与执行</);
  assert.match(executionSource, />执行与培训统计</);
});

test("employees acknowledge the exact publication before starting a version-pinned execution", () => {
  assert.match(executionSource, /acknowledgement\?\.revisionNo\s*===\s*currentRevisionNo/);
  assert.match(executionSource, /action:\s*["']acknowledge["'][\s\S]{0,220}publishedVersion:\s*currentRevisionNo/);
  assert.match(executionSource, /disabled=\{Boolean\(busy\)\s*\|\|\s*loading\s*\|\|\s*!acknowledgedCurrent\}/);
  assert.match(executionSource, /action:\s*["']start["'][\s\S]{0,260}publishedVersion:\s*currentRevisionNo/);
  assert.match(executionSource, /后续更新不会改写既有记录/);
});

test("execution steps preserve CAS, notes, evidence and completion progress", () => {
  assert.match(executionSource, /executionId:\s*execution\.id[\s\S]{0,120}version:\s*execution\.version/);
  assert.match(executionSource, /action:\s*["']step["'][\s\S]{0,100}stepId[\s\S]{0,100}completed/);
  assert.match(executionSource, /action:\s*["']step["'][\s\S]{0,140}note:[\s\S]{0,100}evidence/);
  assert.match(executionSource, /每个步骤最多保存 10 项凭证/);
  assert.match(executionSource, /selectedExecution\.completedSteps\s*\/\s*selectedExecution\.totalSteps/);
  assert.ok(executionSource.includes("保存备注与凭证"));
});

test("workflow and actor switches discard stale loads without overwriting the new scope", () => {
  assert.match(executionSource, /const\s+loadEpochRef\s*=\s*useRef\(0\)/);
  assert.match(executionSource, /activeLoadScopeRef\.current\s*===\s*loadScope/);
  assert.match(executionSource, /if\s*\(!isCurrentLoad\(\)\)\s*return/);
  assert.match(executionSource, /loadEpochRef\.current\s*\+=\s*1/);
  assert.match(executionSource, /actor\.type[\s\S]{0,80}actor\.id[\s\S]{0,160}\.join\(["']:["']\)/);
});

test("server refreshes preserve dirty notes and feedback drafts", () => {
  assert.match(executionSource, /dirtyStepNoteIdsRef\.current\.add\(step\.stepId\)/);
  assert.match(executionSource, /!dirtyStepNoteIdsRef\.current\.has\(step\.stepId\)/);
  assert.match(executionSource, /feedbackDraftDirtyRef\.current\s*=\s*true/);
  assert.match(executionSource, /if\s*\(!feedbackDraftDirtyRef\.current\)/);
  assert.match(executionSource, /beforePublish\?\.\(updated\)[\s\S]{0,100}onExecutions/);
});

test("execution switches confirm before discarding every local draft kind", () => {
  assert.match(
    executionSource,
    /function\s+hasUnsavedExecutionDraft\(\)[\s\S]{0,220}dirtyStepNoteIdsRef\.current\.size\s*>\s*0[\s\S]{0,120}feedbackDraftDirtyRef\.current[\s\S]{0,180}evidenceLabels[\s\S]{0,140}evidenceReferences/,
  );
  assert.match(
    executionSource,
    /function\s+confirmDiscardExecutionDraft\(message:\s*string\)[\s\S]{0,180}window\.confirm\(message\)/,
  );
  assert.match(
    executionSource,
    /async function\s+startExecution\(\)[\s\S]{0,260}selectedExecution[\s\S]{0,120}!confirmDiscardExecutionDraft\([\s\S]{0,220}return;[\s\S]{0,100}setBusy\(["']start["']\)/,
  );
  assert.match(
    executionSource,
    /nextExecutionId\s*!==\s*selectedExecution\?\.id[\s\S]{0,120}!confirmDiscardExecutionDraft\([\s\S]{0,220}return;[\s\S]{0,100}setSelectedExecutionId\(nextExecutionId\)/,
  );
});

test("completed executions collect feedback and managers close the loop", () => {
  assert.match(executionSource, /selectedExecution\.status\s*===\s*["']completed["']/);
  assert.match(executionSource, /action:\s*["']feedback["'][\s\S]{0,260}rating[\s\S]{0,180}text/);
  assert.match(executionSource, /feedbackStatus\s*===\s*["']resolved["']/);
  assert.match(executionSource, /action:\s*["']resolve_feedback["'][\s\S]{0,260}version:\s*executionVersion/);
  assert.match(executionSource, /normalizeMerchantEnterpriseWorkflowFeedbackResolution\([\s\S]{0,100}payload\)\?\.resolution/);
  assert.ok(executionSource.includes("标记已处理"));
  assert.match(executionSource, /待处理反馈["'],\s*stats\.openFeedbackCount/);
  assert.ok(executionSource.includes("待处理反馈汇总此流程的全部版本"));
  assert.ok(executionSource.includes("反馈处理队列（全部版本）"));
  assert.match(executionSource, /feedback\.employeeName[\s\S]{0,80}feedback\.revisionNo/);
});

test("unpublished drafts clearly leave execution and statistics on the published version", () => {
  assert.match(executionSource, /workflow\.hasUnpublishedChanges/);
  assert.match(executionSource, /员工阅读、执行和管理统计仍基于已发布版本/);
  assert.match(executionSource, /data-workflow-published-version-notice/);
});

test("revision history compares immutable publications and restores only to a draft", () => {
  assert.match(workflowSource, /<WorkflowRevisionHistory[\s\S]{0,360}onRestored=/);
  assert.match(governanceSource, /beforeRevision/);
  assert.match(
    governanceSource,
    /snapshotChanges\(scopedDetail\.snapshot,\s*scopedPrevious\?\.snapshot\s*\?\?\s*null/,
  );
  assert.match(governanceSource, /action:\s*["']restore_to_draft["']/);
  assert.match(governanceSource, /restoreRequestRef\.current\s*===\s*requestId/);
  assert.match(governanceSource, /已发布版本不会立即改变，需再次发布后才对员工生效/);
  assert.ok(governanceSource.includes("复制为当前草稿"));
});

test("revision history rejects stale list and detail responses across publication scopes", () => {
  assert.match(
    governanceSource,
    /const\s+workflowScope\s*=\s*`\$\{siteId\}:\$\{workflow\.id\}:\$\{workflow\.publishedVersion\}`/,
  );
  assert.match(governanceSource, /const\s+workflowScopeRef\s*=\s*useRef\(workflowScope\)/);
  assert.match(governanceSource, /const\s+listRequestRef\s*=\s*useRef\(0\)/);
  assert.match(governanceSource, /const\s+detailRequestRef\s*=\s*useRef\(0\)/);
  assert.match(governanceSource, /const\s+scopedRevisions\s*=\s*listScope\s*===\s*workflowScope\s*\?\s*revisions\s*:\s*\[\]/);
  assert.match(governanceSource, /const\s+scopedDetail\s*=\s*detailScope\s*===\s*workflowScope\s*\?\s*detail\s*:\s*null/);
  assert.match(
    governanceSource,
    /const\s+requestId\s*=\s*\+\+listRequestRef\.current[\s\S]{0,1400}workflowScopeRef\.current\s*!==\s*requestScope[\s\S]{0,100}listRequestRef\.current\s*!==\s*requestId[\s\S]{0,180}setListScope\(requestScope\)/,
  );
  assert.match(
    governanceSource,
    /const\s+requestId\s*=\s*\+\+detailRequestRef\.current[\s\S]{0,1400}workflowScopeRef\.current\s*!==\s*requestScope[\s\S]{0,100}detailRequestRef\.current\s*!==\s*requestId[\s\S]{0,180}setDetail\(nextDetail\)[\s\S]{0,120}setDetailScope\(requestScope\)/,
  );
  assert.match(
    governanceSource,
    /listRequestRef\.current\s*\+=\s*1;[\s\S]{0,100}detailRequestRef\.current\s*\+=\s*1;[\s\S]{0,320}\[siteId,\s*workflow\.id,\s*workflow\.publishedVersion\]/,
  );
});

test("legacy role workflow permission upgrades remain owner-confirmed and never automatic", () => {
  assert.match(managerSource, /<WorkflowPermissionGapCard[\s\S]{0,220}actorType=\{actor\.type\}/);
  assert.match(governanceSource, /actorType\s*!==\s*["']owner["']/);
  assert.match(governanceSource, /这里只检测历史角色，不会自动提权/);
  assert.match(governanceSource, /window\.confirm\([\s\S]{0,260}员工会立即获得相应能力/);
  assert.match(governanceSource, /workflowPermissions:\s*selected/);
  assert.ok(governanceSource.includes("确认授予所选权限"));
});

test("task details bind one immutable publication and refresh generated checklist state", () => {
  assert.match(managerSource, /<MerchantTaskWorkflowBindingCard[\s\S]{0,280}canBind=\{canUpdate\}/);
  assert.match(managerSource, /onChecklistChanged=\{async \(\) => \{[\s\S]{0,180}refreshChecklist\(\)[\s\S]{0,120}refreshEvents\(\)/);
  assert.match(taskBindingSource, /TASK_WORKFLOW_API[\s\S]{0,300}siteId:\s*task\.siteId[\s\S]{0,100}taskId:\s*task\.id/);
  assert.match(taskBindingSource, /PUBLISHED_WORKFLOWS_API/);
  assert.match(taskBindingSource, /expectedTaskVersion:\s*task\.version/);
  assert.match(taskBindingSource, /expectedRevisionId:\s*selectedChoice\.revisionId/);
  assert.match(
    taskBindingSource,
    /nextBinding\.siteId\s*!==\s*task\.siteId[\s\S]{0,100}nextBinding\.taskId\s*!==\s*task\.id/,
  );
  assert.match(
    taskBindingSource,
    /normalized\.siteId\s*!==\s*task\.siteId[\s\S]{0,100}normalized\.taskId\s*!==\s*task\.id/,
  );
  assert.match(taskBindingSource, /保留现有清单[\s\S]{0,100}后续流程发版不会自动改写本任务/);
  assert.ok(taskBindingSource.includes("版本已固定"));
  assert.ok(taskBindingSource.includes("员工按下方任务清单执行并留痕"));
  assert.match(managerSource, /event\.eventType\s*===\s*["']workflow_bound["']/);
  assert.match(managerSource, /event\.eventType\s*===\s*["']workflow_execution_started["']/);
});
