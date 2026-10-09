// Real-component SSR and pure form/confirmation checks, not browser/Auth/SQL evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import Panel, { buildManagementAuditGrant, confirmManagementDelegatedAction, managementAuditListQuery, managementCurrentAuth,
  managementUtcInput, managementDelegatedWriteAllowed, suspendManagementDelegatedWorkspace, buildManagementGroupsGrant, buildManagementGroupsCommand,
  managementGroupsContextQuery, managementConfigurationContextQuery, managementConfigurationGrantFromForm, managementConfigurationDraftFromContext, DelegatedRuleChoices, DelegatedRevisionReview,
  type ManagementConfigurationGrantForm, type ManagementAuditGrantDraft, type ManagementGroupsGrantDraft, type ManagementGroupsDraft } from "../components/enterprise/MerchantAttendanceManagementDelegatedPanel";
import Launcher from "../components/enterprise/MerchantAttendanceManagementDelegatedLauncher";
import { AttendanceManagementClient } from "./merchantAttendanceManagementDelegatedClient";
import * as groups from "./merchantAttendanceDelegatedGroups";
import * as configuration from "./merchantAttendanceDelegatedConfiguration";
import * as rules from "./merchantAttendanceDelegatedRules";
import * as revisions from "./merchantAttendanceDelegatedRevisions";
import { revisionApprovalResponse } from "../../scripts/fixtures/attendance-revision-approval-model";
import type { ManagementRulesContext } from "./merchantAttendanceDelegatedRulesUi";
import { emptyAttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { OPERATIONAL_RULE_KEYS, type OperationalRules } from "./merchantAttendanceOperationalRules";
import * as operationalFixture from "./merchantAttendanceOperationalRuleLedgerTestFixtures";
import type { GroupsResult, GroupAssignmentDetail, GroupsCommand } from "./merchantAttendanceGroups";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const siteId = "99990203", actorId = id(1), apiFetch = async () => assert.fail("initial render must not request");
const draft: ManagementAuditGrantDraft = { delegateEmployeeId: id(2), delegateAuthUserId: id(3), delegatedAction: "audit_view", scopeKind: "audit_company",
  workerId: "", employeeId: "", employeeAuthUserId: "", locationIds: "", sources: ["management", "config"], validFrom: "2026-10-08T10:00", validUntil: "2026-10-09T10:00", reason: "已核验的有限审计授权", acknowledged: true };
test("208 real owner exposes only two structured exact revision grants; delegate has no authorization form, and strict old review is readonly", async () => {
  const html = renderToStaticMarkup(<Panel {...{ siteId, actorId, apiFetch }} ownerMode isCurrentAuth={() => true} onClose={() => {}}/>),
    form = html.match(/<details><summary[^>]*>授予连续修订审批（批准／驳回精确授权）[\s\S]*?<\/details>/)?.[0]; assert(form);
  for (const action of ["revision_approve", "revision_reject"]) assert.match(form, new RegExp('<option value="' + action + '"'));
  assert.equal((form.match(/<option /g) ?? []).length, 2); assert.doesNotMatch(form, /annul|formal_exception|\bJSON\s*<textarea/);
  for (const label of ["修订目标 Worker ID", "修订目标 Employee ID", "修订目标 Auth ID", "授权前已提交、目前仍待审批", "实际提交记录时间不早于授权记录", "修订授权地点 ID", "<fieldset disabled=\"\""])
    assert(form.includes(label), label);
  const delegate = renderToStaticMarkup(<Panel {...{ siteId, actorId, apiFetch }} revisionsEnabled isCurrentAuth={() => true} onClose={() => {}}/>);
  assert.doesNotMatch(delegate, /授予连续修订审批（批准／驳回精确授权）|修订受托员工 ID/); assert.match(delegate, /读取修订授权上下文（GET）/); assert.match(delegate, /无撤销决定/);
  const review = revisionApprovalResponse(), app = review.review.review.application, query = revisions.parseDelegatedRevisionsQuery({ siteId: review.siteId, grantId: id(900), mode: "context", requestId: review.requestId });
  const context = await revisions.parseDelegatedRevisionsResult({ protocol: revisions.DELEGATED_REVISIONS_PROTOCOL, siteId: review.siteId, actorId, readAt: review.asOf, kind: "context", grantId: id(900), action: "revision_approve",
    scope: { kind: "revision", workerId: app.workerId, employeeId: app.employeeId, employeeAuthUserId: id(901), locationIds: [app.basis.events[0].locationId], includePending: true },
    context: { review, canApprove: true, canReject: false } }, query, actorId);
  assert.equal(context.kind, "context"); if (context.kind !== "context") assert.fail("context required");
  const readonly = renderToStaticMarkup(<DelegatedRevisionReview context={context}/>);
  for (const label of ["原始打卡（保留不变）", "提交时核定（修订", "本次员工声明（尚未生效）", "原始依据", "当前有效核定", "非周期合计或工资"]) assert(readonly.includes(label), label);
  assert(readonly.includes(review.review.base.operationId)); assert(readonly.includes(app.reason)); assert.doesNotMatch(readonly, /<input|<textarea|<button/);
});
test("208 precise flags and actual fresh-context/snapshot wiring keep one shared submit and independent full-original GET recovery", () => {
  for (const owner of [false, true]) for (const grant of [false, true]) for (const enabled of [false, true]) {
    const allowed = (kind: Parameters<typeof managementDelegatedWriteAllowed>[0]) => managementDelegatedWriteAllowed(kind, owner, grant, true, true, true, true, true, true, enabled);
    assert.equal(allowed("revisions-grant"), owner && grant && enabled); assert.equal(allowed("revisions"), enabled); assert.equal(allowed("revoke"), owner);
  }
  assert.equal(managementDelegatedWriteAllowed("revisions", true, true, true, true, true, true, true, true), false);
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx", import.meta.url), "utf8"),
    send = source.slice(source.indexOf("const sendRevisions ="), source.indexOf("const sendCredentials =")),
    client = readFileSync(new URL("./merchantAttendanceManagementDelegatedClient.ts", import.meta.url), "utf8"),
    launcher = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedLauncher.tsx", import.meta.url), "utf8");
  for (const exact of ["!ready() || !revisionsEnabled", "context.grantId !== snapshot.revisionsGrantId", "context.context.review.requestId !== snapshot.revisionsRequestId",
    '!("requestId" in snapshot.readQuery)', "await buildManagementRevisionsCommand(context, query, actorId, snapshot.revisionsDraft", "latest.current.state.result === context", "frozen(latest.current) === original", 'writeKind.current = "revisions"; clearAll()', "await client.submitRevisions(query, command)"]) assert(send.includes(exact), exact);
  assert(send.indexOf("await buildManagementRevisionsCommand") < send.indexOf("confirmManagementDelegatedAction"));
  assert(send.indexOf("confirmManagementDelegatedAction") < send.indexOf("await client.submitRevisions")); assert.equal((send.match(/client\.submitRevisions\(/g) ?? []).length, 1);
  assert.doesNotMatch(send, /ownerId|retry|setTimeout|expectedRevision\s*:/);
  assert.match(source, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_REVISIONS_ENABLED === "1"/); assert.match(source, /scope\.revisionsEnabled !== props\.revisionsEnabled/);
  assert.match(source, /const changeRevisionsSelection[\s\S]*?epoch\.current\+\+; client\.pause\(\); clearBody\(\)/); assert.match(source, /setRevisionsDraft\(emptyRevisions\(\)\)/);
  assert.match(launcher, /props\.revisionsEnabled === true/); assert.match(client, /pending\.domain === "revisions"[\s\S]*?parseDelegatedRevisionsResult\(result,[\s\S]*?pending\.command\)/);
});
test("207 initial real owner has exactly four isolated credential actions and delegate has no grant controls, all local/default-off", () => {
  const html = renderToStaticMarkup(<Panel {...{ siteId, actorId, apiFetch }} ownerMode isCurrentAuth={() => true} onClose={() => {}}/>),
    form = html.match(/<details><summary[^>]*>授予终端／PIN权限（四项精确授权）[\s\S]*?<\/details>/)?.[0]; assert(form);
  for (const action of ["terminal_prepare", "terminal_revoke", "pin_issue", "pin_revoke"]) assert.match(form, new RegExp('<option value="' + action + '"'));
  assert.equal((form.match(/<option /g) ?? []).length, 4); assert.match(form, /授权终端 ID/); assert.match(form, /授权终端地点 ID/); assert.match(form, /<fieldset disabled=""/);
  assert.match(html, /真实终端／PIN授权编号/); assert.match(html, /最后输入后15秒/); assert.match(html, /真实设备与手机仍需试点验收/);
  const delegate = renderToStaticMarkup(<Panel {...{ siteId, actorId, apiFetch }} ownerMode={false} terminalsEnabled pinEnabled isCurrentAuth={() => true} onClose={() => {}}/>);
  assert.doesNotMatch(delegate, /授予终端／PIN权限（四项精确授权）|凭据被委托员工 ID/); assert.match(delegate, /读取凭据授权上下文（GET）/); assert.match(delegate, /原号 GET 不受开关影响/);
});
test("207 terminal/PIN write and owner-grant gates remain independent, including delegate revoke, while old owner revoke is unchanged", () => {
  for (const [owner, grant, terminal, pin] of [[false, false, false, false], [true, true, false, true], [true, true, true, false], [true, false, true, true], [false, true, true, true], [true, true, true, true]] as const) {
    const allowed = (kind: Parameters<typeof managementDelegatedWriteAllowed>[0]) => managementDelegatedWriteAllowed(kind, owner, grant, true, true, true, true, terminal, pin);
    assert.equal(allowed("terminals-grant"), owner && grant && terminal); assert.equal(allowed("pin-grant"), owner && grant && pin);
    assert.equal(allowed("terminals"), terminal); assert.equal(allowed("pin"), pin); assert.equal(allowed("revoke"), owner);
  }
  assert.equal(managementDelegatedWriteAllowed("terminals", true, true, true, true, true, true), false);
  assert.equal(managementDelegatedWriteAllowed("pin", true, true, true, true, true, true), false);
});
test("207 secret lifecycle has synchronous hide/selection/cleanup fences and never puts PIN or paircode in durable state or download paths", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx", import.meta.url), "utf8"),
    send = source.slice(source.indexOf("const sendCredentials ="), source.indexOf("const download ="));
  for (const exact of ["flushSync(() => clearSecrets())", "MANAGEMENT_CREDENTIAL_SECRET_MS", "clearSecrets(false)", "clearSecrets(); setCredentialsDraft(emptyCredentials())",
    "pinRef.current = \"\"", "pairCandidate.current = null", "managementPairDisplayCurrent(candidate, operationId, Date.now())", "pairCandidate.current === candidate",
    "秘密不会保存或重新发送"]) assert(source.includes(exact), exact);
  assert(send.indexOf("confirmManagementDelegatedAction") < send.indexOf("newManagementPairSecret()"));
  assert.doesNotMatch(send, /sessionStorage|localStorage|setItem|clipboard|URL\.createObjectURL|anchor\.download|console\./);
  const latest = source.slice(source.indexOf("const latest ="), source.indexOf("const occupied =")); assert.doesNotMatch(latest, /pinValue|pairDisplay|pairSecret/);
  assert.match(source, /const clearBody[\s\S]*?clearSecrets\(\)/); assert.match(source, /const recover[\s\S]*?clearBody\(\)/);
  const layout = source.slice(source.indexOf("  useLayoutEffect(() => {"), source.indexOf("  const ready ="));
  assert(layout.indexOf("clearSecrets();") < layout.indexOf("mounted.current = true")); assert.match(layout, /suspend\(\)/);
});
test("207 actual wire dispatch uses fresh scoped context, frozen confirmation, strict helper body then exactly one shared submit and original recovery", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx", import.meta.url), "utf8"),
    send = source.slice(source.indexOf("const sendCredentials ="), source.indexOf("const download =")),
    launcher = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedLauncher.tsx", import.meta.url), "utf8");
  for (const exact of ["context.grantId !== snapshot.credentialsGrantId", "snapshot.readQuery?.mode !== \"context\"", "frozen(latest.current) === original", "secretEpoch.current === dispatchSecretEpoch",
    "await buildManagementTerminalBody", "await buildManagementPinBody", "if (!dispatchCurrent())", "client.submitTerminalPrepare(credentials.parseDelegatedTerminalPrepareEphemeralBody(body))", "client.submitPinIssue(credentials.parseDelegatedPinIssueEphemeralBody(body))", "client.submitTerminalRevoke", "client.submitPinRevoke"]) assert(send.includes(exact), exact);
  assert(send.indexOf("if (!dispatchCurrent())") < send.indexOf("client.submitTerminalPrepare(credentials.parseDelegatedTerminalPrepareEphemeralBody(body))"));
  assert.match(source, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_TERMINALS_ENABLED === "1"/); assert.match(source, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_PIN_ENABLED === "1"/);
  assert.match(launcher, /props\.terminalsEnabled === true, props\.pinEnabled === true/); assert.match(source, /prepare|terminal_prepare/);
  const branch = source.slice(source.indexOf("{credentialContext &&"), source.indexOf("{pairDisplay &&"));
  assert.doesNotMatch(branch, /maxLength=\{36\}|setItem|pairSecret|\bpin\s*:/); assert.match(branch, /当前版本|当前绑定/);
});
test("202–205 real initial panel is inert, default off, structured and honest about incomplete executors", () => {
  const html = renderToStaticMarkup(<Panel {...{ siteId, actorId, apiFetch }} ownerMode isCurrentAuth={() => true} onClose={() => {}}/>);
  assert.match(html, /其他管理能力尚未接执行器/); assert.match(html, /新增授权和导出按各自开关独立开放/); assert.match(html, /仅 GET 核验原编号/);
  assert.match(html, /不接受手填 JSON/); assert.match(html, /每页25条/); assert.match(html, /导出上限250条/); assert.match(html, /min-w-0/);
  const credentialForm = html.match(/<details><summary[^>]*>授予终端／PIN权限（四项精确授权）[\s\S]*?<\/details>/)?.[0]; assert(credentialForm);
  assert.match(credentialForm, /<fieldset disabled=""/); assert.match(html, /终端委托执行：未开放；PIN委托执行：未开放/);
});
const groupsGrant: ManagementGroupsGrantDraft = { delegateEmployeeId: id(2), delegateAuthUserId: id(3), delegatedAction: "group_save", groupId: id(10), create: false,
  assignmentId: "", workerId: id(11), employeeId: id(12), employeeAuthUserId: id(13), locationIds: id(91) + "\n" + id(90),
  validFrom: "2026-10-08T10:00", validUntil: "2026-10-09T10:00", reason: "已核验的指定组授权", acknowledged: true };
const groupsDraft: ManagementGroupsDraft = { name: "Kitchen", description: "班组", active: true, startsOn: "2026-10-08", endsOn: "", reason: "已核验的指定组操作", acknowledged: true };
async function groupContext(action: groups.DelegatedGroupsAction, create = false, ended = false) {
  const at = "2026-10-08T10:00:00.000000Z", later = "2026-10-08T11:00:00.000000Z", grantId = id(50);
  const assigned: GroupsCommand = { action: "assign", operationId: id(20), groupId: id(10), workerId: id(11), expectedGroupRevision: 3,
    expectedWorkerVersion: 7, expectedSettingsVersion: 2, timeZone: "UTC", startsOn: "2026-10-08", endsOn: null, reason: "明确分配" };
  const item = { assignmentId: id(20), groupId: id(10), groupName: "Kitchen", workerId: id(11), workerName: "Actual employee", workerNo: "E11", employeeId: id(12),
    timeZone: "UTC", startsOn: "2026-10-08", endsOn: null, createdAt: at, updatedAt: at, revision: 1 as const, status: "assigned" as const };
  const end: GroupsCommand = { action: "end", operationId: id(21), assignmentId: id(20), expectedRevision: 1, endsOn: "2026-10-09", reason: "明确结束" };
  const last = ended ? { ...item, endsOn: "2026-10-09", updatedAt: later, revision: 2 as const, status: "ended" as const } : item;
  const detail: GroupAssignmentDetail = { ...last, history: ended ? [{ command: assigned, item }, { command: end, item: last }] : [{ command: assigned, item }], canEnd: !ended, canCancel: true };
  const context: GroupsResult = { protocol: "groups-v1", siteId, actorId, settingsVersion: 2, timeZone: "UTC", view: "context",
    group: create ? null : { groupId: id(10), revision: 3, name: "Kitchen", description: "班组", active: true, createdAt: at, updatedAt: at },
    worker: action === "group_save" ? null : { workerId: id(11), workerName: "Actual employee", workerNo: "E11", employeeId: id(12), version: 7, active: true },
    items: [], nextCursor: null, detail: action === "group_end" || action === "group_cancel" ? detail : null, receipt: null };
  const scope = action === "group_save" ? { kind: "group", groupId: id(10), create }
    : { kind: "group_worker", groupId: id(10), assignmentId: action === "group_assign" ? null : id(20), workerId: id(11), employeeId: id(12), employeeAuthUserId: id(13), locationIds: [id(90)] };
  const result = await groups.parseDelegatedGroupsResult({ protocol: groups.DELEGATED_GROUPS_PROTOCOL, siteId, actorId, readAt: "2026-10-08T12:00:00.000000Z", kind: "context", grantId, action, scope, context },
    managementGroupsContextQuery(siteId, grantId), actorId);
  if (result.kind !== "context") assert.fail(); return result;
}
test("204 owner form offers exactly the four implemented group actions and no merchant inventory", () => {
  const html = renderToStaticMarkup(<Panel {...{ siteId, actorId, apiFetch }} ownerMode isCurrentAuth={() => true} onClose={() => {}}/>);
  const groupForm = html.match(/<details><summary[^>]*>授予指定组动作（四项结构化授权）[\s\S]*?<\/details>/)?.[0]; assert(groupForm);
  for (const action of groups.DELEGATED_GROUPS_ACTIONS) assert.match(groupForm, new RegExp('<option value="' + action + '"'));
  for (const action of ["worker_save", "location_save", "pin_issue", "terminal_prepare", "rule_publish"]) assert.doesNotMatch(groupForm, new RegExp('<option value="' + action + '"'));
  //206/207 now have independent scoped forms; none widens the older group form.
  for (const title of ["授予审计权限（结构化表单）", "授予指定档案／地点保存权（结构化授权）", "授予规则权限（八个明确动作）"]) {
    const existing = html.slice(html.indexOf(title), html.indexOf("</details>", html.indexOf(title)));
    for (const action of ["pin_issue", "terminal_prepare"]) assert.doesNotMatch(existing, new RegExp('<option value="' + action + '"'));
  }
  assert.match(html, /组执行：未开放/); assert.match(html, /组两个开关同时开放/); assert.match(html, /版本来自刚读取的上下文/);
  const delegate = renderToStaticMarkup(<Panel {...{ siteId, actorId, apiFetch }} ownerMode={false} groupsEnabled isCurrentAuth={() => true} onClose={() => {}}/>);
  assert.doesNotMatch(delegate, /授予指定组动作（四项结构化授权）/); assert.match(delegate, /真实组管理授权编号/); assert.match(delegate, /不提供全商户人员／组枚举/);
});

const configurationGrant: ManagementConfigurationGrantForm = { delegateEmployeeId: id(2), delegateAuthUserId: id(3), delegatedAction: "worker_save",
  workerId: id(10), employeeId: id(11), employeeAuthUserId: id(12), locationId: "", locationIds: id(91) + "\n" + id(90), create: false,
  validFrom: "2026-10-08T10:00", validUntil: "2026-10-09T10:00", reason: "指定档案配置授权", acknowledged: true };
function configurationContext(kind: "worker" | "location", create = false): Extract<configuration.DelegatedConfigurationResult, { kind: "context" }> {
  const base = { protocol: configuration.DELEGATED_CONFIGURATION_PROTOCOL, siteId, actorId, readAt: "2026-10-08T12:00:00.000000Z", kind: "context" as const, grantId: id(50) },
    location = { id: id(90), name: "Madrid", timeZone: "Europe/Madrid", active: true };
  return kind === "worker" ? { ...base, action: "worker_save", scope: { kind: "worker", create, workerId: id(10), employeeId: id(11), employeeAuthUserId: id(12), locationIds: [id(90)] },
    context: { settingsVersion: 10, targetVersion: create ? null : 3, employee: { id: id(11), displayName: "Current employee" },
      worker: create ? null : { id: id(10), employeeId: id(11), workerNo: "E10", displayName: "Saved worker", locationId: id(90), active: false, startsOn: "2026-09-01" }, locations: [location] } }
    : { ...base, action: "location_save", scope: { kind: "location", create, locationId: id(90) },
      context: { settingsVersion: 10, targetVersion: create ? null : 3, employee: null, worker: null, locations: create ? [] : [location] } };
}

test("205 actual owner/delegate UI is local, default-off, structured and exposes only the two new configuration actions", () => {
  const html = renderToStaticMarkup(<Panel {...{ siteId, actorId, apiFetch }} ownerMode isCurrentAuth={() => true} onClose={() => {}}/>),
    form = html.match(/<details><summary[^>]*>授予指定档案／地点保存权（结构化授权）[\s\S]*?<\/details>/)?.[0]; assert(form);
  assert.match(form, /<option value="worker_save"/); assert.match(form, /<option value="location_save"/); assert.equal((form.match(/<option /g) ?? []).length, 2);
  assert.match(form, /<fieldset disabled=""/); assert.match(html, /档案／地点执行：未开放/); assert.match(html, /授权与配置两个开关同时开放/);
  assert.match(form, /UUID 格式不代表权限/); assert.match(form, /不接受手填 JSON/); assert.doesNotMatch(form, /<textarea[^>]*(?:JSON|json)|<option value="(?:settings|rule_publish|pin_issue)"/);
  const delegate = renderToStaticMarkup(<Panel {...{ siteId, actorId, apiFetch }} ownerMode={false} configurationEnabled isCurrentAuth={() => true} onClose={() => {}}/>);
  assert.doesNotMatch(delegate, /授予指定档案／地点保存权（结构化授权）|配置受托员工 ID/); assert.match(delegate, /真实档案／地点配置授权编号/);
  assert.match(delegate, /不列举全商户资源/); assert.match(delegate, /配置开关不影响原号核验/);
});

test("205 configuration write and grant gates cannot be enabled by audit/groups flags; revoke remains independent", () => {
  for (const owner of [false, true]) for (const grant of [false, true]) for (const config of [false, true]) {
    assert.equal(managementDelegatedWriteAllowed("configuration-grant", owner, grant, true, true, config), owner && grant && config);
    assert.equal(managementDelegatedWriteAllowed("configuration", owner, grant, false, false, config), config);
    assert.equal(managementDelegatedWriteAllowed("export", owner, grant, false, true, config), false);
    assert.equal(managementDelegatedWriteAllowed("groups", owner, grant, true, false, config), false);
    assert.equal(managementDelegatedWriteAllowed("revoke", owner, false, false, false, config), owner);
  }
  assert.equal(managementDelegatedWriteAllowed("configuration", true, true, true, true), false);
  assert.equal(managementDelegatedWriteAllowed("configuration-grant", true, true, true, true), false);
});

test("205 configuration form uses the frozen strict grant builder and binds one target with exact double identity/locations", () => {
  const worker = managementConfigurationGrantFromForm(configurationGrant, id(80));
  assert.deepEqual(worker.scope, { kind: "worker", create: false, workerId: id(10), employeeId: id(11), employeeAuthUserId: id(12), locationIds: [id(90), id(91)] });
  const location = managementConfigurationGrantFromForm({ ...configurationGrant, delegatedAction: "location_save", locationId: id(90), create: true }, id(80));
  assert.deepEqual(location.scope, { kind: "location", create: true, locationId: id(90) });
  assert.equal(location.validFrom, "2026-10-08T10:00:00.000000Z");
  for (const patch of [{ acknowledged: false }, { employeeAuthUserId: "" }, { locationIds: "" }, { locationIds: id(90) + "," + id(90) },
    { delegateEmployeeId: configurationGrant.employeeId }, { delegatedAction: "pin_issue" as "worker_save" }]) assert.throws(() => managementConfigurationGrantFromForm({ ...configurationGrant, ...patch }, id(80)));
});

test("205 explicit scoped context query never requests inventories or an arbitrary employee/resource", () => {
  assert.deepEqual(managementConfigurationContextQuery(siteId, id(50)), { siteId, grantId: id(50), mode: "context", operationId: null });
  for (const value of ["", "all", "unknown", id(50) + "\n"]) assert.throws(() => managementConfigurationContextQuery(siteId, value));
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /client\.readConfiguration\(query as cfg\.DelegatedConfigurationQuery\)/);
  assert.doesNotMatch(source, /readConfiguration\([^\n]+mode:\s*"(?:members|workers|locations|list)"/);
});

test("205 current-context form keeps existing values but never invents dates, timezone or first allowed location for creates", () => {
  assert.deepEqual(managementConfigurationDraftFromContext(configurationContext("worker")), { kind: "worker", workerNo: "E10", displayName: "Saved worker",
    locationId: id(90), startsOn: "2026-09-01", active: false, acknowledged: false });
  assert.deepEqual(managementConfigurationDraftFromContext(configurationContext("worker", true)), { kind: "worker", workerNo: "", displayName: "Current employee",
    locationId: "", startsOn: "", active: true, acknowledged: false });
  assert.deepEqual(managementConfigurationDraftFromContext(configurationContext("location", true)), { kind: "location", name: "", timeZone: "", active: true, acknowledged: false });
  const location = managementConfigurationDraftFromContext(configurationContext("location")); assert.deepEqual(location, { kind: "location", name: "Madrid", timeZone: "Europe/Madrid", active: true, acknowledged: false });
  assert.doesNotMatch(JSON.stringify(location), /(?:employeeId|expectedVersion|targetVersion|settingsVersion|operationId)/);
});

test("205 async context validation precedes confirmation and exactly one shared-client submit; stale result/draft/current gate fence every stage", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx", import.meta.url), "utf8"),
    start = source.indexOf("const sendConfiguration = async () =>"), stop = source.indexOf("const sendRules = async () =>", start), block = source.slice(start, stop);
  assert(start >= 0 && stop > start); assert(block.indexOf("await buildManagementConfigurationCommand(") < block.indexOf("confirmManagementDelegatedAction("));
  assert(block.indexOf("confirmManagementDelegatedAction(") < block.indexOf("await client.submitConfiguration(query, command)"));
  for (const text of ['!ready() || !configurationEnabled', 'result.grantId !== snapshot.configurationGrantId', 'snapshot.readQuery.siteId !== siteId',
    'snapshot.readQuery.grantId !== result.grantId', 'latest.current.state.result === result', 'draftSnapshot(latest.current) === frozen',
    'if (!current() || token !== epoch.current) return', 'writeKind.current = "configuration"']) assert.ok(block.includes(text), text);
  assert.equal((block.match(/client\.submitConfiguration\(/g) ?? []).length, 1); assert.doesNotMatch(block, /\.removeItem\(|setTimeout|retry|\.submitManagement\(/);
});

test("205 hide/Auth/flag/requester cleanup preserves original slot and carries configuration scope through actual lazy launcher", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx", import.meta.url), "utf8"),
    launcher = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedLauncher.tsx", import.meta.url), "utf8");
  for (const text of ['NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_CONFIGURATION_ENABLED === "1"', 'scope.configurationEnabled !== props.configurationEnabled',
    'setConfigurationGrantDraft(emptyConfigurationGrant())', 'setConfigurationDraft(null)', 'setConfigurationGrantId("")', 'flushSync(pause)',
    'suspendManagementDelegatedWorkspace({ mounted, working, epoch }, client)', 'state.pending !== null', '!occupied()', 'timeoutMs: 12000']) assert.ok(source.includes(text), text);
  assert.match(launcher, /props\.configurationEnabled === true/); assert.match(launcher, /outerRegister\?\.\(leave\)/); assert.match(launcher, /<Suspense/);
  assert.doesNotMatch(source, /client\.dispose\(|sessionStorage\.removeItem/);
  const recover = source.slice(source.indexOf("const recover = async () =>"), source.indexOf("const send =", source.indexOf("const recover = async () =>")));
  assert.match(recover, /client\.recover\(\)/); assert.doesNotMatch(recover, /configurationEnabled|grantEnabled|submitConfiguration/);
});
test("204 structured grants bind the exact action, group, worker double identity and optional original assignment", () => {
  assert.deepEqual(buildManagementGroupsGrant({ ...groupsGrant, create: true }, id(80)).scope, { kind: "group", groupId: id(10), create: true });
  for (const action of ["group_assign", "group_end", "group_cancel"] as const) {
    const result = buildManagementGroupsGrant({ ...groupsGrant, delegatedAction: action, assignmentId: id(20) }, id(80));
    assert.equal(result.delegatedAction, action); assert.deepEqual(result.scope, { kind: "group_worker", groupId: id(10), assignmentId: action === "group_assign" ? null : id(20),
      workerId: id(11), employeeId: id(12), employeeAuthUserId: id(13), locationIds: [id(90), id(91)] });
    assert.equal(result.validFrom, "2026-10-08T10:00:00.000000Z");
  }
  for (const patch of [{ acknowledged: false }, { delegatedAction: "worker_save" as "group_save" }, { groupId: "" }, { validUntil: groupsGrant.validFrom }])
    assert.throws(() => buildManagementGroupsGrant({ ...groupsGrant, ...patch }, id(80)));
  for (const patch of [{ workerId: "" }, { employeeId: "" }, { employeeAuthUserId: "" }, { assignmentId: "" }, { locationIds: "" }, { locationIds: id(90) + "," + id(90) },
    { delegateAuthUserId: groupsGrant.employeeAuthUserId }, { locationIds: Array.from({ length: 26 }, (_, i) => id(90 + i)).join(",") }])
    assert.throws(() => buildManagementGroupsGrant({ ...groupsGrant, delegatedAction: "group_end", assignmentId: id(20), ...patch }, id(80)));
});
test("204 group writes and group grants have precise separate gates; none enables export or bypasses emergency revoke", () => {
  assert.equal(managementDelegatedWriteAllowed("groups", false, false, false, true), true);
  assert.equal(managementDelegatedWriteAllowed("groups", true, true, true, false), false);
  assert.equal(managementDelegatedWriteAllowed("groups-grant", true, true, false, true), true);
  for (const flags of [[true, false, true, true], [true, true, true, false], [false, true, true, true]] as const)
    assert.equal(managementDelegatedWriteAllowed("groups-grant", flags[0], flags[1], flags[2], flags[3]), false);
  assert.equal(managementDelegatedWriteAllowed("export", true, true, false, true), false);
  assert.equal(managementDelegatedWriteAllowed("grant", true, false, true, true), false);
  assert.equal(managementDelegatedWriteAllowed("revoke", true, false, false, false), true);
});
test("204 explicit scoped context does not accept inventory or an empty or guessed grant", () => {
  assert.deepEqual(managementGroupsContextQuery(siteId, id(50)), { siteId, grantId: id(50), mode: "context", operationId: null });
  for (const value of ["", "all", "unknown", id(50) + "\n"]) assert.throws(() => managementGroupsContextQuery(siteId, value));
});
test("204 save binds current group CAS, and only explicit create uses the grant's planned UUID as original operation", async () => {
  const existing = await groupContext("group_save"), create = await groupContext("group_save", true);
  const c = buildManagementGroupsCommand(existing, groupsDraft, id(80)); assert.equal(c.action, "save_group");
  if (c.action !== "save_group") assert.fail(); assert.equal(c.expectedRevision, 3); assert.equal(c.groupId, id(10)); assert.equal(c.operationId, id(80));
  const created = buildManagementGroupsCommand(create, groupsDraft, id(80));
  assert.deepEqual(created, { action: "save_group", operationId: id(10), groupId: id(10), expectedRevision: 0, name: "Kitchen", description: "班组", active: true, reason: groupsDraft.reason });
  assert.throws(() => buildManagementGroupsCommand(existing, { ...groupsDraft, acknowledged: false }, id(80)));
  assert.throws(() => buildManagementGroupsCommand({ ...existing, scope: { kind: "group", groupId: id(99), create: false } }, groupsDraft, id(80)));
});
test("204 assignment automatically binds actual group, worker and settings versions, timezone and calendar dates", async () => {
  const context = await groupContext("group_assign"), command = buildManagementGroupsCommand(context, groupsDraft, id(80));
  assert.deepEqual(command, { action: "assign", operationId: id(80), groupId: id(10), workerId: id(11), expectedGroupRevision: 3, expectedWorkerVersion: 7,
    expectedSettingsVersion: 2, timeZone: "UTC", startsOn: "2026-10-08", endsOn: null, reason: groupsDraft.reason });
  for (const patch of [{ startsOn: "2026-02-30" }, { endsOn: "2026-10-07" }, { reason: "" }]) assert.throws(() => buildManagementGroupsCommand(context, { ...groupsDraft, ...patch }, id(80)));
  assert.throws(() => buildManagementGroupsCommand({ ...context, context: { ...context.context, worker: { ...context.context.worker!, employeeId: id(99) } } }, groupsDraft, id(80)));
  assert.throws(() => buildManagementGroupsCommand({ ...context, context: { ...context.context, group: { ...context.context.group!, active: false } } }, groupsDraft, id(80)));
});
test("204 end and cancel bind the exact current original assignment and allowed revision, never choose another action", async () => {
  const end = await groupContext("group_end"), cancel = await groupContext("group_cancel", false, true);
  assert.deepEqual(buildManagementGroupsCommand(end, { ...groupsDraft, endsOn: "2026-10-09" }, id(80)), { action: "end", operationId: id(80), assignmentId: id(20), expectedRevision: 1, endsOn: "2026-10-09", reason: groupsDraft.reason });
  assert.deepEqual(buildManagementGroupsCommand(cancel, groupsDraft, id(80)), { action: "cancel", operationId: id(80), assignmentId: id(20), expectedRevision: 2, reason: groupsDraft.reason });
  for (const endsOn of ["", "2026-10-07", "2026-02-30"]) assert.throws(() => buildManagementGroupsCommand(end, { ...groupsDraft, endsOn }, id(80)));
  assert.throws(() => buildManagementGroupsCommand({ ...end, context: { ...end.context, detail: { ...end.context.detail!, canEnd: false } } }, groupsDraft, id(80)));
  assert.throws(() => buildManagementGroupsCommand({ ...cancel, context: { ...cancel.context, detail: { ...cancel.context.detail!, assignmentId: id(99) } } }, groupsDraft, id(80)));
});
test("204 source wiring retains shared pending, current snapshot fencing, split gates and synchronous hidden cleanup", () => {
  const panel = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx", import.meta.url), "utf8"),
    launcher = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedLauncher.tsx", import.meta.url), "utf8");
  for (const text of ['NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_GROUPS_ENABLED === "1"', 'client.readGroups(', 'client.submitGroups(groupsQuery, command as GroupsCommand)',
    'client.recover()', 'draftSnapshot(latest.current) === frozen', 'latest.current.state.result === result', 'flushSync(pause)', 'setGroupsGrantDraft(emptyGroupsGrant())', 'setGroupsDraft(emptyGroups())', 'setGroupsGrantId("")',
    'scope.groupsEnabled !== props.groupsEnabled', 'state.pending !== null', '!occupied()', 'isCurrentAuth: current', 'timeoutMs: 12000']) assert.ok(panel.includes(text), text);
  assert.match(launcher, /props\.groupsEnabled === true/); assert.doesNotMatch(panel, /\.submitGroups\([^;]+\)\s*;\s*.*\.submitGroups/);
  assert.doesNotMatch(panel, /readGroups\([^\n]+mode:\s*"(?:groups|members)"|client\.dispose\(/);
});
test("202/203 launcher is inert and strict false or throwing Auth renders no private UI", () => {
  const props = { siteId, actorId, apiFetch, isCurrentAuth: () => true };
  assert.doesNotMatch(renderToStaticMarkup(<Launcher {...props}/>), /<dialog/);
  for (const isCurrentAuth of [() => false, () => { throw Error("Auth lost"); }]) {
    assert.equal(renderToStaticMarkup(<Panel {...props} isCurrentAuth={isCurrentAuth} onClose={() => {}}/>), "");
    assert.equal(renderToStaticMarkup(<Launcher {...props} isCurrentAuth={isCurrentAuth}/>), "");
  }
  assert.equal(managementCurrentAuth(() => undefined as unknown as boolean), false);
});
test("202 structured company grant binds real delegate IDs, explicit action, canonical sources and UTC", () => {
  const result = buildManagementAuditGrant(draft, id(4));
  assert.equal(result.action, "grant"); assert.equal(result.delegateEmployeeId, id(2)); assert.equal(result.delegateAuthUserId, id(3));
  assert.deepEqual(result.scope, { kind: "audit_company", sources: ["config", "management"] });
  assert.equal(result.validFrom, "2026-10-08T10:00:00.000000Z"); assert.equal(result.delegatedAction, "audit_view");
  assert.throws(() => buildManagementAuditGrant({ ...draft, acknowledged: false }, id(4)));
  assert.throws(() => buildManagementAuditGrant({ ...draft, sources: [] }, id(4)));
  assert.throws(() => buildManagementAuditGrant({ ...draft, sources: ["scope"] }, id(4)));
  assert.throws(() => buildManagementAuditGrant({ ...draft, delegatedAction: "worker_save" as "audit_view" }, id(4)));
  assert.throws(() => buildManagementAuditGrant({ ...draft, scopeKind: "worker" as "audit_worker" }, id(4)));
});
test("202 worker audit requires complete target double identity and canonical 1..25 exact locations", () => {
  const worker: ManagementAuditGrantDraft = { ...draft, scopeKind: "audit_worker", workerId: id(10), employeeId: id(11), employeeAuthUserId: id(12),
    locationIds: id(21) + "\n" + id(20), sources: ["scope", "config"], delegatedAction: "audit_export" };
  assert.deepEqual(buildManagementAuditGrant(worker, id(4)).scope, { kind: "audit_worker", workerId: id(10), employeeId: id(11), employeeAuthUserId: id(12),
    locationIds: [id(20), id(21)], sources: ["config", "scope"] });
  for (const patch of [{ workerId: "" }, { employeeId: "" }, { employeeAuthUserId: "" }, { locationIds: "" }, { locationIds: id(20) + "," + id(20) },
    { locationIds: Array.from({ length: 26 }, (_, i) => id(i + 20)).join(",") }]) assert.throws(() => buildManagementAuditGrant({ ...worker, ...patch }, id(4)));
});
test("203 structured audit query is strict UTC, no synthetic asOf/cursor or >31day window", () => {
  const query = managementAuditListQuery(siteId, { grantId: id(4), source: "config", fromAt: "2026-10-01T00:00", toAt: "2026-10-08T00:00" });
  assert.equal(query.asOf, null); assert.equal(query.cursorAt, null); assert.equal(query.cursorId, null);
  assert.equal(query.fromAt, "2026-10-01T00:00:00.000000Z");
  assert.throws(() => managementAuditListQuery(siteId, { grantId: id(4), source: "config", fromAt: "2026-09-01T00:00", toAt: "2026-10-08T00:00" }));
  assert.throws(() => managementAuditListQuery(siteId, { grantId: "unknown", source: "config", fromAt: query.fromAt, toAt: query.toAt }));
});
test("UTC controls preserve six microseconds and reject impossible/timezone-ambiguous input", () => {
  assert.equal(managementUtcInput("2026-10-08T10:00:01.123456"), "2026-10-08T10:00:01.123456Z");
  assert.equal(managementUtcInput("2026-10-08T10:00:01.1"), "2026-10-08T10:00:01.100000Z");
  for (const invalid of ["2026-02-30T10:00", "2026-10-08T24:00", "2026-10-08 10:00", "2026-10-08T10:00:00+02:00", "2026-10-08T10:00:00.000000Z\n"]) assert.throws(() => managementUtcInput(invalid));
});
test("202/203 confirmation checks current Auth and frozen snapshot both before and after modal", () => {
  let current = true, sends = 0;
  assert.equal(confirmManagementDelegatedAction(() => { current = false; return true; }, () => current, () => { sends++; }), false);
  current = true; assert.equal(confirmManagementDelegatedAction(() => false, () => current, () => { sends++; }), false);
  current = false; let confirms = 0; assert.equal(confirmManagementDelegatedAction(() => { confirms++; return true; }, () => current, () => { sends++; }), false);
  assert.equal(confirms, 0); assert.equal(sends, 0); current = true;
  assert.equal(confirmManagementDelegatedAction(() => true, () => current, () => { sends++; }), true); assert.equal(sends, 1);
});
test("202/203 layout replay cleanup uses reusable pause, still fences leases and never requests", async () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /suspendManagementDelegatedWorkspace\(\{ mounted, working, epoch \}, client\)/);
  assert.match(source, /return \(\) => \{ suspend\(\);/); assert.doesNotMatch(source, /client\.dispose\(/);
  const values = new Map<string, string>(), refs = { mounted: { current: true }, working: { current: true }, epoch: { current: 0 } }; let requests = 0;
  const client = new AttendanceManagementClient({ siteId, actorId, isCurrentAuth: () => refs.mounted.current, canWrite: () => false,
    apiFetch: async () => { requests++; assert.fail("effect replay is local-only"); },
    storage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }) });
  const first = client.initialize(), cancelled = assert.rejects(first);
  suspendManagementDelegatedWorkspace(refs, client); assert.equal(refs.working.current, false); assert.equal(refs.mounted.current, false); assert.equal(refs.epoch.current, 1);
  await cancelled; assert.equal(client.getSnapshot().result, null); refs.mounted.current = true; assert.equal(await client.initialize(), null);
  assert.equal(requests, 0); client.pause();
});
test("202/203 overview presentation never shows owner grant/revoke controls; flags cannot enable the other domain", () => {
  const html = renderToStaticMarkup(<Panel {...{ siteId, actorId, apiFetch }} ownerMode={false} grantEnabled auditEnabled isCurrentAuth={() => true} onClose={() => {}}/>);
  assert.doesNotMatch(html, /负责人：授权管理|授予明确审计权限|撤销此授权|被委托员工 ID/); assert.match(html, /被委托人：读取资源审计/);
  assert.match(html, /仅 GET 核验原编号/);
  assert.equal(managementDelegatedWriteAllowed("grant", true, false, true), false);
  assert.equal(managementDelegatedWriteAllowed("export", true, true, false), false);
  assert.equal(managementDelegatedWriteAllowed("revoke", true, false, false), true);
  assert.equal(managementDelegatedWriteAllowed("grant", false, true, true), false);
  assert.equal(managementDelegatedWriteAllowed("revoke", false, true, true), false);
  assert.equal(managementDelegatedWriteAllowed("export", false, false, true), true);
  assert.equal(managementDelegatedWriteAllowed(null, true, true, true), false);
});
test("202/203 real owner host preserves actual Auth/epoch and parent pending/draft/child guards", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceAdminPanel.tsx", import.meta.url), "utf8");
  const mount = source.slice(source.indexOf('{authUserId === ownerId && isCurrentAuth && <ManagementDelegatedLauncher'), source.indexOf('{missingEnabled && <button'));
  for (const text of ['actorId={authUserId} ownerMode', 'isCurrentAuth={cycleAuthCurrent}', 'requesterKey={String(state.authorizationEpoch)}',
    'grantEnabled={managementDelegationsEnabled} auditEnabled={delegatedAuditEnabled}', 'registerChild("management-delegated")',
    '!cycleAuthCurrent()', 'client.getSnapshot().pending', 'parentDraft.current', 'targetOccupied', 'backlogOpen', 'childGuards.current.size', 'inlineWorkspaces.current.size',
    'ownerBacklogHostReady(client.getSnapshot()', 'window.sessionStorage.getItem(client.storageKey)']) assert.ok(mount.includes(text), text);
  assert.doesNotMatch(mount, /actorId=\{ownerId\}|removeItem|submit|apiFetch\(/);
});
test("202/203 real overview host uses actual Auth independently of self rights and occupies both lanes compare-own only", () => {
  const source = readFileSync(new URL("../components/admin/MerchantEnterpriseManager.tsx", import.meta.url), "utf8");
  const start = source.indexOf('{tab === "overview" && periodDelegationAuthId ? <MerchantAttendanceManagementDelegatedLauncher');
  const mount = source.slice(start, source.indexOf('{tab === "overview" && periodDelegationAuthId ? <MerchantAttendanceOperationalConsumerActivationRecoveryLink', start));
  for (const text of ['actorId={periodDelegationAuthId}', 'ownerMode={false}', 'isCurrentAuth={periodDelegationAuthCurrent}', 'requesterKey={actorAuthorizationFingerprint}',
    '!attendanceLeaveGuardRef.current && !correctionLeaveGuardRef.current', 'registerLeaveGuard={registerManagementDelegatedLeaveGuard}',
    'NEXT_PUBLIC_FAOLLA_ATTENDANCE_MANAGEMENT_DELEGATIONS_ENABLED', 'NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_AUDIT_ENABLED']) assert.ok(mount.includes(text), text);
  assert.doesNotMatch(mount, /actorId=\{actor.id\}|self.view|self.clock/);
  const register = source.slice(source.indexOf('const registerManagementDelegatedLeaveGuard ='), source.indexOf('const registerCorrectionLeaveGuard ='));
  for (const text of ['value !== null && value !== prior', 'attendanceLeaveGuardRef.current = registration', 'correctionLeaveGuardRef.current = registration',
    'attendanceLeaveGuardRef.current === prior', 'correctionLeaveGuardRef.current === prior']) assert.ok(register.includes(text), text);
});
test("202/203 modal layout registers one stable outer guard before lazy panel, scope/flags/requester changes reset it", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedLauncher.tsx", import.meta.url), "utf8");
  assert.match(source, /const Panel = lazy/); assert.match(source, /import type \{ ManagementDelegatedPanelProps \}/);
  assert.match(source, /if \(!open\) return; outerRegister\?\.\(leave\); return \(\) => outerRegister\?\.\(null\)/);
  assert.match(source, /const registerLeaveGuard = useCallback\(\(value:[^\n]+guard\.current = value;/);
  for (const text of ['props.requesterKey', 'props.grantEnabled', 'props.auditEnabled', 'scope.apiFetch !== props.apiFetch', 'scope.auth !== props.isCurrentAuth']) assert.ok(source.includes(text), text);
});
test("206 actual owner form has exactly eight scoped rule actions; delegate never receives authorization controls", () => {
  const owner = renderToStaticMarkup(<Panel {...{ siteId, actorId, apiFetch }} ownerMode grantEnabled rulesEnabled isCurrentAuth={() => true} onClose={() => {}}/>),
    form = owner.match(/<details><summary[^>]*>授予规则权限（八个明确动作）[\s\S]*?<\/details>/)?.[0]; assert(form);
  for (const action of rules.DELEGATED_RULES_ACTIONS) assert.match(form, new RegExp('<option value="' + action + '"'));
  for (const action of ["pin_issue", "worker_save", "terminal_prepare", "group_save"]) assert.doesNotMatch(form, new RegExp('<option value="' + action + '"'));
  assert.match(form, /不提供全商户目录或手填 JSON/); assert.match(form, /允许变化的规则键/); assert.match(form, /<fieldset disabled=""/);
  const delegate = renderToStaticMarkup(<Panel {...{ siteId, actorId, apiFetch }} ownerMode={false} rulesEnabled isCurrentAuth={() => true} onClose={() => {}}/>);
  assert.doesNotMatch(delegate, /授予规则权限（八个明确动作）/); assert.match(delegate, /真实规则授权编号/); assert.match(delegate, /读取规则历史（每页25条）/);
});
test("206 rules execution and owner grant require only their precise independent flags, never OR with other domains", () => {
  for (const owner of [false, true]) for (const grant of [false, true]) for (const rule of [false, true]) {
    assert.equal(managementDelegatedWriteAllowed("rules-grant", owner, grant, true, true, true, rule), owner && grant && rule);
    assert.equal(managementDelegatedWriteAllowed("rules", owner, grant, false, false, false, rule), rule);
    assert.equal(managementDelegatedWriteAllowed("configuration", owner, grant, true, true, false, rule), false);
    assert.equal(managementDelegatedWriteAllowed("groups", owner, grant, true, false, true, rule), false);
    assert.equal(managementDelegatedWriteAllowed("export", owner, grant, false, true, true, rule), false);
    assert.equal(managementDelegatedWriteAllowed("revoke", owner, false, false, false, false, rule), owner);
  }
  assert.equal(managementDelegatedWriteAllowed("rules", true, true, true, true, true), false);
});
test("206 actual base controls expose only allowed keys while showing unauthorized saved values without editable controls", () => {
  const baseline = { ...emptyAttendanceRuleDraft(), earlyGraceMinutes: { mode: "value" as const, minutes: 23 } }, context: ManagementRulesContext = {
    protocol: rules.DELEGATED_RULES_PROTOCOL, siteId, actorId, readAt: "2026-10-08T12:00:00.000000Z", kind: "context", grantId: id(50), action: "rule_draft",
    scope: { kind: "rules", family: "base", subject: { kind: "enterprise" }, allowedRuleKeys: ["lateGraceMinutes"], locationIds: [] },
    context: { family: "base", revision: 1, settingsVersion: 9, timeZone: "UTC", group: null, draft: { revision: 1, settingsVersion: 9, groupRevision: null, timeZone: "UTC", rules: baseline }, baselineKind: "draft", baselineRevision: 1, baselineRules: baseline } };
  const html = renderToStaticMarkup(<DelegatedRuleChoices context={context} value={baseline} onChange={() => assert.fail("SSR does not edit")}/>);
  assert.equal((html.match(/<select/g) ?? []).length, 1); assert.match(html, /早退宽限.*未授权，原值保留/); assert.match(html, /23/);
  assert.doesNotMatch(html, /aria-label="早退宽限.*处理方式"|<textarea|JSON/);
});
test("206 actual operational controls retain all eight choices, grant locations and only immutable baseline route pairs", async () => {
  const old = await operationalFixture.operationalRuleLedgerDetail(undefined, true); if (old.data.kind !== "detail" || !old.data.draft) assert.fail();
  const value: OperationalRules = { ...old.data.draft.rules, locationScope: { mode: "value", value: [id(90)] },
    reviewRouting: { mode: "value", value: { correction: { delegateEmployeeId: id(10), delegateAuthUserId: id(11) }, missing: "owner", leave: "owner", work_arrangement: "owner" } } };
  const context: ManagementRulesContext = { protocol: rules.DELEGATED_RULES_PROTOCOL, siteId: old.siteId, actorId: old.actorId, readAt: old.readAt, kind: "context", grantId: id(50), action: "operational_rule_draft",
    scope: { kind: "rules", family: "operational", subject: old.data.scope, allowedRuleKeys: [...OPERATIONAL_RULE_KEYS].sort(), locationIds: [id(90)] },
    context: { family: "operational", detail: old.data, baselineKind: "draft", baselineRevision: 1, baselineRules: value } };
  const html = renderToStaticMarkup(<DelegatedRuleChoices context={context} value={value} onChange={() => assert.fail("SSR does not edit")}/>);
  for (const label of ["允许打卡渠道处理方式", "地点范围处理方式", "班次来源处理方式", "休息类型处理方式", "补正窗口处理方式", "审核路由处理方式", "周期方式处理方式", "提醒配置处理方式"]) assert(html.includes(label), label);
  assert.match(html, /仅从此授权的精确地点名单选择/); assert.match(html, /只复用刚读取的同层基线/); assert.match(html, /不输入新身份/);
  assert.match(html, new RegExp('<option value="' + id(10) + '/' + id(11) + '"')); assert.match(html, /保存员工/);
  assert.doesNotMatch(html, /路由员工 ID|路由账户 Auth ID|读取.*目录|<textarea|手填.*JSON/);
});
test("206 source uses one durable shared submit after strict async validation and frozen confirmation, including nested pending ID", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedPanel.tsx", import.meta.url), "utf8"),
    start = source.indexOf("const sendRules = async () =>"), end = source.indexOf("const download = async () =>", start), block = source.slice(start, end);
  assert.match(block, /await buildManagementRulesCommand\(context, query, actorId, snapshot.rulesDraft/);
  assert.match(block, /latest\.current\.rulesContext === context/); assert.match(block, /latest\.current\.state\.result === result/); assert.match(block, /draftSnapshot\(latest\.current\) === frozen/);
  assert(block.indexOf("buildManagementRulesCommand") < block.indexOf("confirmManagementDelegatedAction"));
  assert.equal((block.match(/client\.submitRules\(/g) ?? []).length, 1); assert.doesNotMatch(block, /retry|setTimeout|removeItem|submitManagement|ownerId/);
  assert.match(source, /state\.pending\.domain === "rules" \? state\.pending\.command\.decision\.operationId/);
  for (const text of ['client.readRules(', 'rulesHistory.nextCursor', '下一页规则历史（同一快照）', 'setRulesDraft(null)', 'setRulesContext(null)', 'setRulesEvidence(null)',
    'scope.rulesEnabled !== props.rulesEnabled', 'NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_RULES_ENABLED === "1"']) assert(source.includes(text), text);
  const recover = source.slice(source.indexOf("const recover = async () =>"), source.indexOf("const send =", source.indexOf("const recover = async () =>")));
  assert.match(recover, /client\.recover\(\)/); assert.doesNotMatch(recover, /rulesEnabled|submitRules/);
  const launcher = readFileSync(new URL("../components/enterprise/MerchantAttendanceManagementDelegatedLauncher.tsx", import.meta.url), "utf8"); assert.match(launcher, /props\.rulesEnabled === true/);
});
