import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(
  path.join(
    process.cwd(),
    "src",
    "components",
    "admin",
    "MerchantEnterpriseAutomationManager.tsx",
  ),
  "utf8",
);
const manager = fs.readFileSync(
  path.join(
    process.cwd(),
    "src",
    "components",
    "admin",
    "MerchantEnterpriseManager.tsx",
  ),
  "utf8",
);
const adminClient = fs.readFileSync(
  path.join(process.cwd(), "src", "app", "admin", "AdminClient.tsx"),
  "utf8",
);
const auditLog = fs.readFileSync(
  path.join(
    process.cwd(),
    "src",
    "components",
    "admin",
    "MerchantEnterpriseAuditLog.tsx",
  ),
  "utf8",
);

test("automation UI exposes order and booking event availability without claiming inactive streams", () => {
  assert.match(source, /sourceAvailability|availability/);
  assert.match(source, /order:\s*"订单"/);
  assert.match(source, /booking:\s*"预约"/);
  assert.match(source, /\{SOURCE_LABELS\[sourceType\]\}事件接入/);
  assert.match(source, /可自动触发/);
  assert.match(source, /尚未启用/);
  assert.match(
    source,
    /value="active"[\s\S]{0,160}disabled=\{availability\[draft\.sourceType\]\s*!==\s*"active"\}/,
  );
  assert.match(source, /source_event_stream_unavailable/);
  assert.match(source, /只能先保存为暂停/);
});

test("automation editor pins a published revision and sends complete CAS mutations", () => {
  assert.match(source, /workflowRevisionId/);
  assert.match(source, /固定工作流程版本/);
  assert.match(source, /发布新版不会悄然改变/);
  assert.match(source, /升级到 v\{selectedWorkflow\.revisionNo\}/);
  assert.match(source, /method:\s*draft\.ruleId\s*\?\s*"PATCH"\s*:\s*"POST"/);
  assert.match(source, /expectedVersion:\s*draft\.expectedVersion/);
  assert.match(source, /createClientMutationOperationId\("enterprise-automation"\)/);
  for (const field of [
    "sourceType",
    "eventType",
    "boardId",
    "columnId",
    "workflowId",
    "taskTitle",
    "priority",
    "assigneeIds",
  ]) {
    assert.ok(source.includes(field), `missing automation mutation field ${field}`);
  }
});

test("automation templates expose only operational placeholders and explain PII isolation", () => {
  for (const placeholder of ["{eventRef}", "{fromStatus}", "{toStatus}"]) {
    assert.ok(source.includes(placeholder), `missing safe placeholder ${placeholder}`);
  }
  assert.doesNotMatch(source, /\{sourceId\}/);
  assert.match(source, /不会注入客户资料/);
  assert.match(source, /事件引用为不可反查业务内容的随机标识/);
  assert.doesNotMatch(source, /customerName|customerPhone|customerEmail/);
  assert.match(source, /hasOnlyMerchantEnterpriseAutomationTemplateTokens/);
  assert.match(source, /normalizeMerchantEnterpriseAutomationRule/);
  assert.match(source, /normalizeMerchantEnterpriseAutomationRun/);
});

test("enterprise navigation places todos before tasks and automation after workflows", () => {
  assert.match(
    manager,
    /key:\s*"overview"[\s\S]+key:\s*"todos"[\s\S]+key:\s*"tasks"[\s\S]+key:\s*"workflows"[\s\S]+key:\s*"automations"/,
  );
  assert.match(
    adminClient,
    /label:\s*"待办中心"[\s\S]+label:\s*"任务看板"[\s\S]+label:\s*"工作流程"[\s\S]+label:\s*"流程自动化"/,
  );
  assert.match(manager, /<MerchantEnterpriseTodoCenter/);
  assert.match(manager, /<MerchantEnterpriseAutomationManager/);
  assert.match(manager, /onDirtyChange=\{setAutomationHasDraft\}/);
  assert.match(adminClient, /merchantEnterpriseTodoCount\s*>\s*99\s*\?\s*"99\+"/);
});

test("automation runs remain actionable without exposing source business content", () => {
  assert.match(source, /最近运行/);
  assert.match(source, /run\.eventRef/);
  assert.match(source, /run\.status\s*===\s*"processing"/);
  assert.match(source, /run\.attemptCount/);
  assert.match(source, /run\.eventType === "created" \? " · 新建事件"/);
  assert.doesNotMatch(source, /run\.toStatus \? ` · 状态/);
  assert.match(source, /第 \{run\.attemptCount\} 次尝试/);
  assert.match(source, /系统会自动重试；如持续失败，请检查规则目标、流程版本和事件服务配置/);
  for (const errorCode of [
    "automation_target_unavailable",
    "automation_workflow_unavailable",
    "automation_assignee_unavailable",
  ]) {
    assert.ok(source.includes(errorCode), `missing auto-pause error code ${errorCode}`);
  }
  assert.match(source, /AUTOMATION_AUTO_PAUSE_ERROR_CODES\.has\(run\.errorCode\)/);
  assert.match(source, /规则已自动暂停，请修复目标、流程或负责人配置后再启用/);
  assert.match(source, /automation_target_unavailable: "目标看板\/工作列不可用"/);
  assert.match(source, /automation_workflow_unavailable: "工作流程不可用"/);
  assert.match(source, /automation_assignee_unavailable: "负责人权限已失效"/);
  assert.match(source, /automation_execution_failed: "执行失败"/);
  assert.match(source, /automationRunErrorLabel\(run\.errorCode\)/);
  assert.doesNotMatch(source, /` · \$\{run\.errorCode\}`/);
  assert.doesNotMatch(source, /立即重试|手动重试/);
  assert.match(source, /run\.taskId\s*&&\s*onOpenTask/);
  assert.match(source, /onOpenTask\(run\.taskId!\)/);
  assert.match(source, /执行失败/);
  assert.match(source, /已跳过/);
});

test("automation UI explains waiting rules, active limits, and audit events", () => {
  assert.match(source, /已启用·等待事件服务/);
  assert.match(source, /automation_active_rule_limit_reached/);
  assert.match(source, /同类来源和触发时机最多启用 20 条规则，请先暂停或合并现有规则/);
  assert.match(source, /automation_rule_limit_reached/);
  assert.match(source, /企业最多可创建 100 条自动化规则，请先合并现有规则或清理不再使用的规则/);
  assert.match(auditLog, /value: "automation", label: "流程自动化"/);
  for (const eventType of [
    "automation.created",
    "automation.updated",
    "automation.paused",
    "automation.resumed",
    "automation.archived",
    "automation.fired",
    "automation.failed",
  ]) {
    assert.ok(auditLog.includes(`"${eventType}"`), `missing audit label ${eventType}`);
  }
  assert.match(auditLog, /工作流程、流程自动化和邀请/);
});

test("automation targets only usable columns and board-authorized employees", () => {
  assert.match(
    source,
    /snapshot\.columns\.filter\(\(column\) => column\.status === "active" && !column\.isDone\)/,
  );
  assert.match(source, /role\.status === "active"/);
  assert.match(source, /role\.permissions\.includes\("tasks\.view"\)/);
  assert.match(
    source,
    /role\.accessScope === "all" \|\| role\.allowedBoardIds\.includes\(draft\.boardId\)/,
  );
  assert.match(source, /invalidSelectedAssignees/);
  assert.match(source, /旧规则中存在已失效负责人/);
  assert.match(source, /初始工作列必须是当前看板中仍在使用的未完成列/);
});

test("automation rules can be soft archived without losing run history", () => {
  assert.match(source, /async function archiveRule\(rule: AutomationRule\)/);
  assert.match(source, /window\.confirm\(/);
  assert.match(source, /action: "archive"/);
  assert.match(source, /ruleId: rule\.id/);
  assert.match(source, /expectedVersion: rule\.version/);
  assert.match(source, /createClientMutationOperationId\("enterprise-automation-archive"\)/);
  assert.match(source, /archivedRule\.status !== "archived"/);
  assert.match(source, /current\.filter\(\(candidate\) => candidate\.id !== rule\.id\)/);
  assert.match(source, /已有运行记录和审计记录会继续保留/);
  assert.match(source, /automation_rule_archived/);
  assert.match(source, /onClick=\{\(\) => void archiveRule\(rule\)\}>归档<\/button>/);
});
