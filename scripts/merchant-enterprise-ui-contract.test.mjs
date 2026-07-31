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
const adminClientSource = readFileSync(
  path.join(process.cwd(), "src", "app", "admin", "AdminClient.tsx"),
  "utf8",
);
const enterprisePortalSource = readFileSync(
  path.join(
    process.cwd(),
    "src",
    "app",
    "enterprise",
    "[siteId]",
    "EnterprisePortalClient.tsx",
  ),
  "utf8",
);

function sliceSourceBetween(targetSource, startPattern, endPattern, label) {
  const startMatch = startPattern.exec(targetSource);
  assert.ok(startMatch, `${label} start marker is missing`);
  const start = startMatch.index;
  const endMatch = endPattern.exec(targetSource.slice(start + startMatch[0].length));
  assert.ok(endMatch, `${label} end marker is missing`);
  const end = start + startMatch[0].length + endMatch.index;
  return targetSource.slice(start, end);
}

function sliceBetween(startPattern, endPattern, label) {
  return sliceSourceBetween(source, startPattern, endPattern, label);
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

test("enterprise task drag and drop wires mouse, touch and keyboard sensors into dnd-kit", () => {
  for (const token of [
    "DndContext",
    "DragOverlay",
    "KeyboardSensor",
    "MouseSensor",
    "TouchSensor",
    "useDroppable",
    "useSensor",
    "useSensors",
    "SortableContext",
    "sortableKeyboardCoordinates",
    "useSortable",
  ]) {
    assert.ok(source.includes(token), `missing dnd-kit integration: ${token}`);
  }
  assert.match(source, /from\s+["']@dnd-kit\/core["']/);
  assert.match(source, /from\s+["']@dnd-kit\/sortable["']/);
  assert.match(source, /from\s+["']@dnd-kit\/utilities["']/);

  const sensorSource = sliceBetween(
    /const\s+taskSensors\s*=\s*useSensors\(/,
    /const\s+\[taskTitle,/,
    "task drag sensors",
  );
  assert.match(
    sensorSource,
    /useSensor\(MouseSensor,\s*\{\s*activationConstraint:\s*\{\s*distance:\s*\d+\s*\}\s*\}\)/,
  );
  assert.match(
    sensorSource,
    /useSensor\(TouchSensor,\s*\{\s*activationConstraint:\s*\{\s*delay:\s*\d+,\s*tolerance:\s*\d+\s*\}\s*\}\)/,
  );
  assert.match(
    sensorSource,
    /useSensor\(KeyboardSensor,\s*\{\s*coordinateGetter:\s*sortableKeyboardCoordinates\s*\}\)/,
  );

  const dndContextSource = sliceBetween(
    /<DndContext\b/,
    /<\/DndContext>/,
    "task DndContext",
  );
  assert.match(dndContextSource, /sensors=\{taskSensors\}/);
  assert.match(dndContextSource, /onDragStart=\{handleTaskDragStart\}/);
  assert.match(dndContextSource, /onDragEnd=\{handleTaskDragEnd\}/);
  assert.match(dndContextSource, /onDragCancel=/);
  assert.match(dndContextSource, /<DragOverlay>/);
  assert.match(dndContextSource, /<TaskDragPreview\s+task=\{draggingTask\}/);
  assert.match(source, /function\s+TaskDragPreview[\s\S]{0,400}aria-hidden=["']true["']/);
  assert.match(source, /已放下任务/);
  assert.doesNotMatch(source, /activeCenter|overCenter/);
});

test("sortable tasks use a dedicated accessible handle and columns remain droppable when empty", () => {
  const taskShellSource = sliceBetween(
    /function\s+SortableTaskShell\b/,
    /function\s+SortableTaskColumn\b/,
    "SortableTaskShell",
  );
  assert.match(taskShellSource, /useSortable\(\{/);
  assert.match(taskShellSource, /id:\s*taskDndId\(task\.id\)/);
  assert.match(taskShellSource, /disabled:\s*dragDisabled/);
  assert.match(taskShellSource, /type:\s*["']task["']/);
  assert.match(taskShellSource, /<article[\s\S]{0,300}ref=\{setNodeRef\}/);

  const handleMatch = taskShellSource.match(
    /<button[\s\S]*?ref=\{setActivatorNodeRef\}[\s\S]*?<\/button>/,
  );
  assert.ok(handleMatch, "sortable tasks need an activator button separate from the task card");
  assert.match(handleMatch[0], /type=["']button["']/);
  assert.match(handleMatch[0], /\{\.\.\.attributes\}/);
  assert.match(handleMatch[0], /\{\.\.\.listeners\}/);
  assert.match(handleMatch[0], /aria-label=\{`拖动任务：\$\{task\.title\}`\}/);
  assert.match(handleMatch[0], /disabled=\{dragDisabled\}/);
  assert.doesNotMatch(
    taskShellSource.match(/<article[\s\S]*?>/)?.[0] ?? "",
    /\{\.\.\.(?:attributes|listeners)\}/,
    "drag listeners belong on the handle, not the whole task card",
  );

  const columnSource = sliceBetween(
    /function\s+SortableTaskColumn\b/,
    /function\s+TaskDragPreview\b/,
    "SortableTaskColumn",
  );
  assert.match(columnSource, /useDroppable\(\{/);
  assert.match(columnSource, /id:\s*columnDndId\(column\.id\)/);
  assert.match(columnSource, /disabled:\s*dragDisabled/);
  assert.match(columnSource, /type:\s*["']column["']/);
  assert.match(columnSource, /ref=\{setNodeRef\}/);
  assert.match(
    columnSource,
    /<SortableContext\s+items=\{taskIds\.map\(taskDndId\)\}\s+strategy=\{verticalListSortingStrategy\}>/,
  );

  assert.doesNotMatch(
    source,
    /\bdraggable\s*=/,
    "native HTML drag attributes must not compete with dnd-kit sensors",
  );
});

test("task drag and fallback controls are gated by filters, archive state, permission and busy state", () => {
  const gateSource = sliceBetween(
    /const\s+hasTaskFilters\s*=/,
    /const\s+draggingTask\s*=/,
    "task drag gate",
  );
  assert.match(gateSource, /Boolean\(taskQuery\.trim\(\)\)/);
  assert.match(gateSource, /taskPriorityFilter\s*!==\s*["']all["']/);
  assert.match(gateSource, /taskAssigneeFilter\s*!==\s*["']all["']/);
  assert.match(
    gateSource,
    /const\s+taskDragEnabled\s*=\s*taskArchiveView\s*===\s*["']active["'][\s\S]{0,200}can\(actor,\s*["']tasks\.update["']\)[\s\S]{0,100}!busy[\s\S]{0,100}!hasTaskFilters/,
  );

  assert.match(source, /dragDisabled=\{!taskDragEnabled\}/);
  assert.match(
    source,
    /showDragHandle=\{taskArchiveView\s*===\s*["']active["']\s*&&\s*can\(actor,\s*["']tasks\.update["']\)\}/,
  );
  assert.match(
    source,
    /const\s+reorderControlsDisabled\s*=\s*busy\s*\|\|\s*hasTaskFilters/,
  );
  assert.match(source, /归档任务不能移动/);
  assert.match(source, /当前账号没有移动任务的权限/);
});

test("drag completion plans an atomic target index and sends it through the reorder mutation", () => {
  const dragEndSource = sliceBetween(
    /function\s+handleTaskDragEnd\b/,
    /async\s+function\s+saveTask\b/,
    "handleTaskDragEnd",
  );
  assert.match(dragEndSource, /setDraggingTaskId\(["']{2}\)/);
  assert.match(dragEndSource, /if\s*\(\s*!taskDragEnabled\s*\|\|\s*!event\.over\s*\)\s*return/);
  assert.match(dragEndSource, /taskDndData\(event\.active\.data\.current\)/);
  assert.match(dragEndSource, /taskDndData\(event\.over\.data\.current\)/);
  assert.match(dragEndSource, /columnDndData\(event\.over\.data\.current\)/);
  assert.match(
    dragEndSource,
    /const\s+plan\s*=\s*planMerchantTaskReorder\(visibleTasks,\s*\{[\s\S]{0,500}taskId:\s*activeTask\.id[\s\S]{0,500}targetColumnId[\s\S]{0,500}placement/,
  );
  assert.match(
    dragEndSource,
    /if\s*\(plan\.kind\s*===\s*["']move["']\)\s*\{[\s\S]{0,250}reorderTask\(activeTask,\s*plan\.columnId,\s*plan\.targetIndex\)/,
  );
  assert.doesNotMatch(
    dragEndSource,
    /filteredTasks/,
    "reordering must use the complete active board order, not the filtered subset",
  );
  assert.doesNotMatch(dragEndSource, /Date\.now\(\)/);

  const reorderMutationSource = sliceBetween(
    /async\s+function\s+reorderTask\b/,
    /async\s+function\s+moveTask\b/,
    "reorderTask",
  );
  assert.match(reorderMutationSource, /["']PATCH["']/);
  assert.match(reorderMutationSource, /taskId:\s*task\.id/);
  assert.match(reorderMutationSource, /version:\s*task\.version/);
  assert.match(reorderMutationSource, /columnId,/);
  assert.match(reorderMutationSource, /targetIndex,/);
  assert.match(
    reorderMutationSource,
    /createClientMutationOperationId\(["']enterprise-task-reorder["']\)/,
  );
  assert.doesNotMatch(reorderMutationSource, /\bposition\s*:/);
});

test("task cards retain button alternatives for same-column and cross-column movement", () => {
  const dndContextSource = sliceBetween(
    /<DndContext\b/,
    /<\/DndContext>/,
    "task movement controls",
  );
  assert.match(
    dndContextSource,
    /onClick=\{\(\)\s*=>\s*void\s+moveTaskWithinColumn\(task,\s*-1\)\}[\s\S]{0,250}上移/,
  );
  assert.match(
    dndContextSource,
    /onClick=\{\(\)\s*=>\s*void\s+moveTaskWithinColumn\(task,\s*1\)\}[\s\S]{0,250}下移/,
  );
  assert.match(
    dndContextSource,
    /const\s+previous\s*=\s*activeColumns\[columnIndex\s*-\s*1\][\s\S]{0,250}moveTask\(task,\s*previous\.id\)[\s\S]{0,250}上一列/,
  );
  assert.match(
    dndContextSource,
    /const\s+next\s*=\s*activeColumns\[columnIndex\s*\+\s*1\][\s\S]{0,250}moveTask\(task,\s*next\.id\)[\s\S]{0,250}下一列/,
  );
  assert.match(
    dndContextSource,
    /disabled=\{reorderControlsDisabled\s*\|\|\s*taskIndex\s*===\s*0\}/,
  );
  assert.match(
    dndContextSource,
    /disabled=\{reorderControlsDisabled\s*\|\|\s*taskIndex\s*===\s*tasks\.length\s*-\s*1\}/,
  );
});

test("task editor separates detail updates from atomic column movement", () => {
  const saveTaskSource = sliceBetween(
    /async\s+function\s+saveTask\b/,
    /async\s+function\s+setTaskArchived\b/,
    "saveTask",
  );
  assert.match(saveTaskSource, /delete\s+editChanges\.columnId/);
  assert.match(saveTaskSource, /hasColumnChange/);
  assert.match(saveTaskSource, /hasColumnChange\s*\?\s*\{\s*reload:\s*false\s*\}/);
  assert.match(saveTaskSource, /reconcilePartiallySavedTaskMove\(\)/);
  assert.match(source, /任务详情已保存，但刚才无法确认所在列更新结果；已刷新最新状态/);
  assert.match(
    saveTaskSource,
    /planMerchantTaskReorder\(visibleTasks,\s*\{[\s\S]{0,300}targetColumnId[\s\S]{0,300}placement:\s*["']end["']/,
  );
  assert.match(
    saveTaskSource,
    /reorderTask\(taskForMove,\s*plan\.columnId,\s*plan\.targetIndex\)/,
  );
  assert.doesNotMatch(
    saveTaskSource.match(/const\s+editChanges[\s\S]*?await\s+mutate\([\s\S]*?\);/)?.[0] ?? "",
    /columnId:\s*targetColumnId/,
    "ordinary detail updates must not move a task through the legacy patch path",
  );
});

test("merchant admin moves enterprise subviews into the contextual sidebar menu", () => {
  assert.match(
    adminClientSource,
    /const\s+MERCHANT_ENTERPRISE_CONTEXT_MENU_ITEMS[\s\S]{0,500}任务看板[\s\S]{0,200}员工账号[\s\S]{0,200}角色权限/,
  );
  assert.match(
    adminClientSource,
    /const\s+\[merchantEnterpriseView,\s*setMerchantEnterpriseView\]\s*=\s*useState<MerchantEnterpriseView>\(["']overview["']\)/,
  );
  assert.match(
    adminClientSource,
    /async\s+function\s+openMerchantEnterprisePanel\(view:\s*MerchantEnterpriseView\s*=\s*["']overview["']\)[\s\S]{0,900}setMerchantEnterpriseView\(view\)[\s\S]{0,200}setMerchantDesktopSection\(["']enterprise["']\)/,
  );
  assert.match(
    adminClientSource,
    /merchantDesktopSection\s*===\s*["']enterprise["']\s*&&\s*canUseEnterpriseManagement[\s\S]{0,700}MERCHANT_ENTERPRISE_CONTEXT_MENU_ITEMS[\s\S]{0,500}merchantEnterpriseAvailableViews\.includes\(item\.view\)[\s\S]{0,600}openMerchantEnterprisePanel\(item\.view\)/,
  );
  assert.match(
    adminClientSource,
    /aria-current=\{merchantEnterpriseView\s*===\s*item\.view\s*\?\s*["']page["']/,
  );
  assert.match(
    adminClientSource,
    /aria-controls=["']merchant-enterprise-context-menu["'][\s\S]{0,150}aria-expanded=\{merchantDesktopSection\s*===\s*["']enterprise["']\}/,
  );
  assert.match(
    adminClientSource,
    /<nav\s+id=["']merchant-enterprise-context-menu["']\s+aria-label=["']企业管理子菜单["']/,
  );

  const orderButtonIndex = adminClientSource.indexOf("<span>订单管理</span>");
  const enterpriseButtonIndex = adminClientSource.indexOf("<span>企业管理</span>");
  const supportButtonIndex = adminClientSource.indexOf("<span>会话</span>", enterpriseButtonIndex);
  assert.ok(orderButtonIndex >= 0 && orderButtonIndex < enterpriseButtonIndex);
  assert.ok(enterpriseButtonIndex < supportButtonIndex);
});

test("external enterprise navigation stays permission-aware while standalone keeps its tabs", () => {
  assert.match(source, /export\s+type\s+MerchantEnterpriseExternalNavigation/);
  assert.match(source, /const\s+usesExternalNavigation\s*=\s*navigation\?\.mode\s*===\s*["']external["']/);
  assert.match(
    source,
    /const\s+requestedViewAllowed\s*=\s*actor[\s\S]{0,200}MERCHANT_ENTERPRISE_VIEW_PERMISSIONS\[requestedView\]/,
  );
  assert.match(source, /const\s+tab\s*=\s*requestedViewAllowed\s*\?\s*requestedView\s*:\s*["']overview["']/);
  assert.match(source, /if\s*\(requestedView\s*!==\s*tab\)\s*selectView\(tab\)/);
  assert.match(
    source,
    /MERCHANT_ENTERPRISE_VIEW_ITEMS[\s\S]{0,250}filter\(\(item\)\s*=>\s*can\(actor,\s*item\.permission\)\)[\s\S]{0,300}onAvailableViewsChange\(views\)/,
  );
  assert.match(source, /\{!usesExternalNavigation\s*\?\s*\([\s\S]{0,300}<nav/);
  assert.match(source, /onClick=\{\(\)\s*=>\s*selectView\(["']tasks["']\)\}/);

  assert.match(
    adminClientSource,
    /<MerchantEnterpriseManager[\s\S]{0,500}navigation=\{\{[\s\S]{0,300}mode:\s*["']external["'][\s\S]{0,300}activeView:\s*merchantEnterpriseView/,
  );
  assert.doesNotMatch(
    enterprisePortalSource,
    /<MerchantEnterpriseManager[\s\S]{0,300}\bnavigation=/,
    "the standalone employee portal must keep the manager's internal tab navigation",
  );
});

test("merchant mobile shell gates the enterprise entry and routes it to enterprise content", () => {
  assert.match(
    adminClientSource,
    /type\s+SupportMobileHomeTab\s*=\s*[^;]*["']enterprise["'][^;]*;/,
    "the merchant mobile shell must model enterprise as a first-class home tab",
  );

  const openMobileTabSource = sliceSourceBetween(
    adminClientSource,
    /const\s+openSupportMobileHomeTab\s*=\s*useCallback\b/,
    /const\s+openSupportShuangkouScoreTool\s*=/,
    "openSupportMobileHomeTab",
  );
  assert.match(openMobileTabSource, /tab\s*===\s*["']enterprise["']/);
  assert.match(openMobileTabSource, /loadMerchantEnterpriseManager\(\)/);
  assert.match(openMobileTabSource, /setSupportMobileView\(["']list["']\)/);

  const entitlementSource = sliceSourceBetween(
    adminClientSource,
    /const\s+canUseEnterpriseManagement\s*=/,
    /const\s+canUseMembershipManagement\s*=/,
    "mobile enterprise entitlement guard",
  );
  assert.match(
    entitlementSource,
    /supportMobileHomeTab\s*!==\s*["']enterprise["']\s*\|\|\s*canUseEnterpriseManagement/,
  );
  assert.match(
    entitlementSource,
    /openSupportMobileHomeTab\(["']conversations["']\)/,
    "revoking the entitlement while enterprise is active must return to the conversation list",
  );

  const bottomNavSource = sliceSourceBetween(
    adminClientSource,
    /const\s+supportMobileBottomNav\s*=/,
    /const\s+supportMobileBottomNavOverlay\s*=/,
    "mobile bottom navigation",
  );
  const enterpriseItemIndex = bottomNavSource.search(/\bkey:\s*["']enterprise["']/);
  assert.ok(enterpriseItemIndex >= 0, "the mobile bottom navigation must contain an enterprise entry");
  assert.match(
    bottomNavSource.slice(Math.max(0, enterpriseItemIndex - 700), enterpriseItemIndex + 700),
    /canUseEnterpriseManagement/,
    "the enterprise entry must be created or filtered by canUseEnterpriseManagement",
  );
  assert.match(
    bottomNavSource.slice(enterpriseItemIndex, enterpriseItemIndex + 260),
    /label:\s*["']企业(?:管理)?["']/,
  );

  const mobileEnterpriseContent = sliceSourceBetween(
    adminClientSource,
    /const\s+supportMobileEnterpriseContent\s*=/,
    /const\s+supportMobilePrimaryTabContent\s*=/,
    "mobile enterprise content",
  );
  assert.match(mobileEnterpriseContent, /<MerchantEnterpriseManager\b/);
  assert.match(mobileEnterpriseContent, /siteId=\{(?:editingSiteId|supportMobileBookingSiteId|merchantSiteIdOverride)/);

  const mobileContentRouter = sliceSourceBetween(
    adminClientSource,
    /const\s+supportMobilePrimaryTabContent\s*=/,
    /const\s+supportMobileListTabContent\s*=/,
    "mobile primary tab router",
  );
  assert.match(
    mobileContentRouter,
    /supportMobileHomeTab\s*===\s*["']enterprise["'][\s\S]{0,180}supportMobileEnterpriseContent/,
    "enterprise must not fall through to the self-tab content",
  );
});

test("mobile enterprise back controls and native swipe-back return to conversations", () => {
  const mobileEnterpriseContent = sliceSourceBetween(
    adminClientSource,
    /const\s+supportMobileEnterpriseContent\s*=/,
    /const\s+supportMobilePrimaryTabContent\s*=/,
    "mobile enterprise content",
  );
  const backButton = mobileEnterpriseContent.match(
    /<button\b[\s\S]{0,900}?aria-label=["']返回会话(?:列表)?["'][\s\S]{0,500}?<\/button>/,
  )?.[0];
  assert.ok(backButton, "mobile enterprise needs a semantic back-to-conversations button");
  assert.match(
    backButton,
    /openSupportMobileHomeTab\(["']conversations["']\)/,
    "the visible back button must return to conversations",
  );

  const swipeBackSource = sliceSourceBetween(
    adminClientSource,
    /const\s+handleMobileSwipeBack\s*=\s*\(event:\s*Event\)\s*=>\s*\{/,
    /window\.addEventListener\(MOBILE_SWIPE_BACK_EVENT/,
    "mobile swipe-back handler",
  );
  assert.match(
    swipeBackSource,
    /supportMobileHomeTab\s*===\s*["']enterprise["'][\s\S]{0,220}event\.preventDefault\(\)[\s\S]{0,220}openSupportMobileHomeTab\(["']conversations["']\)[\s\S]{0,120}return/,
  );

  const swipeBackActivationSource = sliceSourceBetween(
    adminClientSource,
    /const\s+active\s*=\s*supportInterfaceOpen\s*&&\s*isMobileSupportDialog\s*&&/,
    /if\s*\(active\)\s*\{/,
    "mobile swipe-back activation",
  );
  assert.match(
    swipeBackActivationSource,
    /supportMobileHomeTab\s*===\s*["']enterprise["']/,
    "enterprise must activate the mobile swipe-back interception layer",
  );
});

test("mobile owner enterprise keeps internal tabs while desktop navigation remains external", () => {
  const mobileEnterpriseContent = sliceSourceBetween(
    adminClientSource,
    /const\s+supportMobileEnterpriseContent\s*=/,
    /const\s+supportMobilePrimaryTabContent\s*=/,
    "mobile enterprise content",
  );
  const mobileManager = mobileEnterpriseContent.match(
    /<MerchantEnterpriseManager\b[\s\S]*?\/>/,
  )?.[0];
  assert.ok(mobileManager, "mobile enterprise must embed MerchantEnterpriseManager");
  assert.doesNotMatch(
    mobileManager,
    /\bnavigation=/,
    "mobile owner enterprise must retain the manager's permission-aware internal tabs",
  );

  const desktopWorkspaceSource = sliceSourceBetween(
    adminClientSource,
    /const\s+desktopMerchantWorkspaceContent\s*=/,
    /\n\s*return\s*\(\s*\n\s*<main\b/,
    "desktop merchant workspace",
  );
  const desktopEnterpriseBranch = sliceSourceBetween(
    desktopWorkspaceSource,
    /merchantDesktopSection\s*===\s*["']enterprise["']\s*&&\s*canUseEnterpriseManagement\s*\?\s*\(/,
    /:\s*merchantDesktopSection\s*===\s*["']logs["']/,
    "desktop enterprise branch",
  );
  assert.match(desktopEnterpriseBranch, /<MerchantEnterpriseManager\b/);
  assert.match(desktopEnterpriseBranch, /navigation=\{\{/);
  assert.match(desktopEnterpriseBranch, /mode:\s*["']external["']/);
  assert.match(desktopEnterpriseBranch, /activeView:\s*merchantEnterpriseView/);

  assert.match(source, /\{!usesExternalNavigation\s*\?\s*\([\s\S]{0,300}<nav/);
  assert.match(
    source,
    /MERCHANT_ENTERPRISE_VIEW_ITEMS[\s\S]{0,250}filter\(\(item\)\s*=>\s*can\(actor,\s*item\.permission\)\)/,
    "internal tabs must continue to honor the authenticated enterprise actor's permissions",
  );
});

test("mobile enterprise contains navigation, board scrolling and compact task workflows", () => {
  const bottomNavOverlay = sliceSourceBetween(
    adminClientSource,
    /const\s+supportMobileBottomNavOverlay\s*=/,
    /const\s+selectedSupportPeerMessagePage\s*=/,
    "mobile bottom navigation overlay",
  );
  assert.match(
    bottomNavOverlay,
    /isMobileSupportDialog\s*&&[\s\S]{0,180}supportMobileHomeTab\s*!==\s*["']enterprise["'][\s\S]{0,180}\?\s*renderTopMostOverlay\(supportMobileBottomNav\)/,
    "the global mobile bottom navigation must not cover the enterprise workspace",
  );

  const internalNavigation = sliceBetween(
    /\{!usesExternalNavigation\s*\?\s*\(/,
    /\{message\s*\?\s*\(/,
    "internal enterprise navigation",
  );
  assert.match(internalNavigation, /<nav[\s\S]{0,240}grid-cols-2/);
  assert.match(internalNavigation, /grid-cols-2[\s\S]{0,160}sm:flex/);
  assert.match(internalNavigation, /className=\{`[^`]*\bw-full\b[^`]*\bsm:w-auto\b/);

  const taskBoard = sliceBetween(
    /<DndContext\b/,
    /<DragOverlay>/,
    "mobile enterprise task board",
  );
  assert.match(taskBoard, /<section\s+data-enterprise-board-scroll/);
  assert.match(taskBoard, /data-enterprise-board-scroll[\s\S]{0,220}\boverflow-x-auto\b/);
  assert.match(taskBoard, /data-enterprise-board-scroll[\s\S]{0,220}\boverscroll-x-contain\b/);

  const taskEditor = sliceBetween(
    /function\s+TaskEditor\(/,
    /function\s+RoleEditor\(/,
    "mobile task editor",
  );
  const dialog = taskEditor.match(
    /<section[\s\S]{0,350}?role=["']dialog["'][\s\S]{0,500}?>/,
  )?.[0];
  assert.ok(dialog, "TaskEditor must expose its dialog shell");
  assert.match(dialog, /(?:^|\s)h-\[100dvh\](?:\s|$)/);
  assert.match(dialog, /(?:^|\s)max-h-\[100dvh\](?:\s|$)/);
  assert.match(dialog, /\bflex-col\b/);
  assert.match(dialog, /\boverflow-hidden\b/);
  assert.match(dialog, /\bsm:overflow-y-auto\b/);
  assert.match(
    taskEditor,
    /className=["'][^"']*\bshrink-0\b[^"']*["'][\s\S]{0,900}className=["'][^"']*\bmin-h-0\b[^"']*\bflex-1\b[^"']*\boverflow-y-auto\b[^"']*["']/,
    "the mobile dialog header must stay fixed while one central body owns vertical scrolling",
  );
  assert.match(
    taskEditor,
    /className=["'][^"']*\bshrink-0\b[^"']*\bborder-t\b[^"']*["']/,
    "the mobile task action footer must remain outside the scrolling body",
  );
  const mobileVerticalScrollOwners = [...taskEditor.matchAll(/className=["']([^"']*)["']/g)]
    .flatMap((match) => match[1].split(/\s+/))
    .filter((token) => token === "overflow-y-auto");
  assert.equal(
    mobileVerticalScrollOwners.length,
    1,
    "TaskEditor must have exactly one unprefixed mobile vertical scroll owner",
  );

  assert.match(
    source,
    /const\s+\[mobileTaskComposerOpen,\s*setMobileTaskComposerOpen\]\s*=\s*useState\(false\)/,
    "the mobile new-task composer must be collapsed by default",
  );
  const taskComposer = sliceBetween(
    /\{can\(actor,\s*["']tasks\.create["']\)\s*\?\s*\(/,
    /<section\s+className=["']rounded-3xl border border-slate-200 bg-white p-4 shadow-sm["']>/,
    "mobile task composer",
  );
  assert.match(taskComposer, /aria-expanded=\{mobileTaskComposerOpen\}/);
  assert.match(taskComposer, /aria-controls=["']merchant-enterprise-task-composer["']/);
  assert.match(taskComposer, /setMobileTaskComposerOpen\(\(current\)\s*=>\s*!current\)/);
  assert.match(
    taskComposer,
    /id=["']merchant-enterprise-task-composer["'][\s\S]{0,220}mobileTaskComposerOpen\s*\?\s*["']block["']\s*:\s*["']hidden["'][\s\S]{0,180}\bsm:block\b/,
  );

  const clearFilters = sliceBetween(
    /function\s+clearTaskFilters\(\)\s*\{/,
    /const\s+taskDragEnabled\s*=/,
    "clear task filters",
  );
  assert.match(clearFilters, /setTaskQuery\(["']{2}\)/);
  assert.match(clearFilters, /setTaskPriorityFilter\(["']all["']\)/);
  assert.match(clearFilters, /setTaskAssigneeFilter\(["']all["']\)/);
  assert.match(clearFilters, /setTaskArchiveView\(["']active["']\)/);
  assert.match(
    source,
    /activeTaskFilterCount\s*>\s*0\s*\?\s*\([\s\S]{0,500}onClick=\{clearTaskFilters\}[\s\S]{0,200}清除筛选/,
    "active mobile filters need one visible reset action",
  );
});

test("task details expose a permission-aware activity timeline and idempotent comments", () => {
  const editor = sliceBetween(
    /function\s+TaskEditor\(/,
    /function\s+RoleEditor\(/,
    "task editor",
  );
  assert.match(editor, /任务动态/);
  assert.match(editor, /最近 50 条操作与评论/);
  assert.match(editor, /onLoadEvents\(task\.id,\s*signal\)/);
  assert.match(editor, /events\.map\(\(event\)\s*=>/);
  assert.match(editor, /event\.eventType\s*===\s*["']commented["']/);
  assert.match(editor, /canUpdate\s*&&\s*!task\.archivedAt/);
  assert.match(editor, /maxLength=\{2000\}/);
  assert.match(editor, /createClientMutationOperationId\(["']enterprise-task-comment["']\)/);
  assert.match(editor, /commentMutationRef\.current\?\.text\s*!==\s*text/);
  assert.match(editor, /onComment\([\s\S]{0,180}commentMutationRef\.current\.operationId/);

  assert.match(
    source,
    /apiFetch\(`\/api\/merchant-enterprise\/task-events\?\$\{params\.toString\(\)\}`/,
  );
  assert.match(
    source,
    /apiFetch\(["']\/api\/merchant-enterprise\/task-events["'][\s\S]{0,350}method:\s*["']POST["'][\s\S]{0,350}operationId/,
  );
  assert.match(source, /onLoadEvents=\{loadTaskEvents\}/);
  assert.match(source, /onComment=\{createTaskComment\}/);
});
