# C07／194：实际申请窗口消费 exact ABI

2026-10-08。主线程已批准实施 application_window；194仅新增共享activation与窗口proof两表，前向保护四个旧内部／公共提交函数，不修改历史migration文件。其他consumer尚未实现，不能激活。本文冻结供SQL与Node并行实现，真实验收记录另列。

## 1. 共享activation

RPC `faolla_attendance_operational_consumer_activation_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb=null,p_allow_activate boolean=false)`。

Consumer为`application_window | review_routing | timesheet_cycle | reminders`，194只允许application_window的activate；其余current可返回默认off，不能假装已生效。可安全deactivate已有记录，recover不重核当前owner。

```ts
Query = {siteId,consumer,mode:'current'} | {siteId,consumer,mode:'recover',operationId}
Command = {siteId,consumer,action:'activate'|'deactivate',operationId,expectedRevision,reason}
Item = {siteId,consumer,operationId,revision,actorId,action,reason,recordedAt,commandFingerprint}
Result = {protocol:'attendance-operational-consumer-activation-v1',siteId,consumer,actorId,readAt,
 canActivate,canDeactivate,current:Item|null,receipt:Item|null}
```

HTTP `/api/merchant-enterprise/attendance/operational-consumer-activation`，POST exact`{query,command}`，GET严格scalar参数。write/recover的两can均false；recover current=null，未知或非原actor原号receipt=null。current由当前canonical owner读；activate需server允许且settings.enabled；deactivate不依赖新开关。商户SHARE→settingsUPDATE串行，原号原actor/body先查后CAS。reason沿group_text，trim不改变正文、1..200 Unicode codepoints、C0/C1拒。revision为0..9007199254740990，command expectedRevision必须<上限。

SHA固定tuple：`['attendance-operational-consumer-activation-command-v1',siteId,consumer,actualActor,[operationId,action,expectedRevision,reason]]`。PG jsonb数组::text与JS递归数组`, `序列化UTF8 SHA256，禁止依赖object顺序。

## 2. 窗口RPC与HTTP

RPC **`faolla_attendance_application_window_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb=null,p_allow_write boolean=false)`**。公开仅service_role；内部core/helper、两表均撤销public/anon/authenticated/service直读写权限。

HTTP `/api/merchant-enterprise/attendance/application-window`。GET query是下列exact对象的scalar参数；null字段以字面`null`传输，拒重复／未知键。最大query 4KiB，不传完整proposal或reason。POST exact`{query,command}`，16KiB body，真实Auth+password认证、same-origin、no-store，沿原12秒服务上限；禁止GET执行业务写。

```ts
Family = 'correction'|'correction_revision'|'missing'|'missing_revision'
Query =
 | {siteId,mode:'prepare',family:'correction',workerId,startEventId}
 | {siteId,mode:'prepare',family:'correction_revision',workerId,baseRequestId}
 | {siteId,mode:'prepare',family:'missing'|'missing_revision',workerId,
    fromDate,throughDate,proposedStartAt,supersedesRequestId:null|string}
 | {siteId,mode:'detail',family,workerId,requestId}
 | {siteId,mode:'recover',family,operationId}
Command = {command:OldSubmitCommand,expectedWindowFingerprint}
```

prepare missing严格≤31 UTC提交日期范围，仅提供一个规范UTC6 proposedStartAt。missing的supersedesRequestId=null；missing_revision必为原真实current已批准请求。correction/revision沿真实原basis起点，不由浏览器改anchor。proposedStartAt和随后command.proposal.startAt必须完全相等。

POST仅prepare query；command只对应family的submit/revise，旧withdraw／审批不进入此新协议：

- correction：原CorrectionCommand submit，expectedPolicyRevision必填；startEventId=query.startEventId，expectedWorkerId由query固定。
- correction_revision：原RevisionCycleCommand submit，expectedEffectiveOperationId必填；baseRequestId=query.baseRequestId。
- missing：原MissingCommand submit；expectedWorkerId=query.workerId。
- missing_revision：原MissingCommand revise；supersedesRequestId=query.supersedesRequestId，expectedWorkerId=query.workerId。

原核心仍验证所有proposal、原权限、政策CAS、基线／当前效果、范围冲突及有效期；新consumer不是旁路。新POST只允许已启用application_window、当前源匹配且未过新截止。旧wrapper处于activated时对**新**submit/revise拒`attendance_application_window_protocol_required`；旧原号重放、withdraw优先并保持旧响应。

## 3. 返回、raw source与窗口

SQL raw恰`{result,source}`；source为完整严格192 source，仅prepare/fresh POST内部验证使用，HTTP剥除。detail内部从保存的compact source_ref重建固定source；recover无source，不能重采当前资格。

```ts
Result = {protocol:'attendance-application-window-v1',siteId,actorId,family,
 mode:'prepare'|'detail'|'receipt'|'recover',readAt,canSubmit,
 application:CorrectionResult|RevisionCycleResult|MissingResult|null,
 window:Window|null,receipt:Receipt|null}
Window = {workerId,employeeId,employeeAuthUserId,observedAt,activationRevision,
 sourceFingerprint,windowFingerprint,baselinePolicy,selectedDays:null|number,
 anchorAt,rootRequestId:null|string,rootDeadlineAt:null|string,
 baselineDeadlineAt,operationalDeadlineAt:null|string,effectiveDeadlineAt}
BaselinePolicy = {operationId,revision,recordedAt,submissionWindowDays,timeZone}
Receipt = {operationId,requestId,family,workerId,employeeId,employeeAuthUserId,
 actorId,recordedAt,commandFingerprint,windowFingerprint,effectiveDeadlineAt}
```

prepare：application是实际旧GET结果；window为当前证明；receipt=null。canSubmit必须旧canRequest/canSubmit AND已activate AND p_allow_write AND readAt<effectiveDeadlineAt。不把旧nestedcan改写成新资格；UI只用外层canSubmit。

detail：实际旧detail GET＋该请求的保存window（旧未绑定请求window=null）；canSubmit=false，receipt=null。correction_revision由真实请求点查baseRequestId构造旧v2 detail，missing按保存submittedAt的UTC单日查询。严格核原保存Auth和worker，不借此跨身份读。

POST：mode=receipt，application/window=null，唯一匹配receipt；source只内部返回并校验其对应window？为避免无window不能交叉校验，fresh POST raw source=null，receipt通过完整commandSHA＋数据库proof一致性验证。POST不能赋下一次CAS。

recover：application/window/source=null、canSubmit=false；只按site+family+operation+真实原actor点查新proof，未知null。旧格式pending仍先走原协议查原操作，不转成新proof；新consumer缺proof不能“恢复成功”或清旧槽。关闭新flag、当前owner变更或原成员已离职不阻原actor最小receipt。禁止自动POST。

响应上限：raw≤512KiB（原basis与192 source均有界），HTTP≤256KiB；超限拒绝，不截断旧申请正文。源对象只给server重算，不把其他员工目录／route引用泄到浏览器。

## 4. 截止、根与固定hash

三层个人→组→企业取correctionWindow首个非inherit；value的selectedDays=0..365，disabled／全部inherit为null。baseline缺失仍原`attendance_correction_policy_required`，不是无限期。

anchor按真实旧basis或本次missing proposal起点。baselineDeadline沿旧084保存timeZone与days。operationalDeadline仅selectedDays非null时按同zone计算。missing_revision还保留旧根proposal在**本次独立政策**下的截止；所有修订再取原根新proof的effectiveDeadline作为不可延长上限。rootDeadlineAt为这些根上限的最小值；无根证据不回填。最终min各非null截止。等于截止已过期。

missing_revision 的 rootRequestId 必须等于真实 detail.lineage.rootRequestId，rootDeadlineAt 非 null；correction_revision 的 rootRequestId 等于真实 application.rootRequestId，旧根无新 proof 时 rootDeadlineAt 可为 null。anchor 输入仍遵守旧 2000..2100 范围，但派生截止由 PostgreSQL `control_day_boundary` 按保存时区真实计算，可越过 2100（例如 UTC 的 2100-12-31 加 365 天窗口截止为 2102-01-01）。Node 不对超出旧日界工具范围的派生日期重复计算，但仍严格核 UTC6、最小截止、baseline 绑定及完整 hash；不得截断或强造 2100 截止。

保存source_ref只含192验证所需的固定身份/settings/groupAssignment、3条191 publish点、1条084 policy点和原at；不保存整份规则body，不以后来的绑定冒认旧身份。独立sourceFingerprint包含原at。

令T为192 `operational_source_tuple_v1(source)`，T去索引3的本次at仍保留其他所有字段，记为T0。windowFingerprint为：

```text
['attendance-application-window-v1',family,activationRevision,T0,
 anchorAt,rootRequestId,rootDeadlineAt,selectedDays,
 baselineDeadlineAt,operationalDeadlineAt,effectiveDeadlineAt]
```

QueryTuple：correction `[siteId,'prepare',family,workerId,startEventId]`；revision `[siteId,'prepare',family,workerId,baseRequestId]`；missing族 `[siteId,'prepare',family,workerId,fromDate,throughDate,proposedStartAt,supersedesRequestId]`。

ProposalTuple=`[startAt,endAt,breaks.map(b=>[startAt,endAt,paid])]`。
OldCommandTuple：correction `[action,operationId,expectedRevision,reason,startEventId,expectedLastEventId,expectedPolicyRevision,ProposalTuple]`；revision `[action,operationId,expectedRevision,reason,expectedBaseOperationId,expectedPolicyRevision,expectedEffectiveOperationId,ProposalTuple]`；missing族 `[action,operationId,reason,expectedWorkerId,expectedSettingsVersion,expectedPolicyRevision,locationId,timeZone,ProposalTuple,supersedesRequestId|null,expectedApprovalOperationId|null]`。

commandFingerprint=`SHA256(['attendance-application-window-command-v1',actualActor,QueryTuple,OldCommandTuple,expectedWindowFingerprint])`。保存原query＋完整command，原号冲突同时核actor/family/scope/fullbody，不能只看proposal。

## 5. SQL原子性与防绕过

新POST持原merchant/settings锁；先点查新proof原号，已有则完整匹配返回，不调用当前source。未知原号调用有意图的私有原core，新旧所有检查正常执行；取得实际写入行的worker/employee/Auth/submittedAt后以该时刻采192、核activation及指纹、截止，追加proof。同一事务里任何规则／旁证错误使旧提交及proof全回滚。

四个旧来源函数通过固定source SHA、signature/defaults/owner/config/ACL和精确替换点提取共享core；旧公共wrapper原OID／权限不变，传legacy=false，新RPC传managed=true。core无service EXECUTE，不用GUC、不造owner。新proof的deferred约束必须验证真实旧request/binding/entry、原command、actor、root、source引用和截止，immutable／no truncate／RLS齐备；重入不修复异常ACL或trigger。

withdraw和已保存receipt不调用192，不因新增配置延期或提前到期。新body与已有旧operation冲突拒绝，不能在旧请求上补proof并冒认已消费。新proof只绑定真实本次提交，不改旧policy_revision／deadline字段、原始event或固定归档。

关闭consumer后，已固定根的截止仍是历史约束：095两revision入口和103 missing-revise的新提交，在旧fresh分支以实际提交now_at点查根proof，只验证固定证据、零当前source；到期仍报原`attendance_correction_window_expired`。未到期走原legacy成功流程、不强制重开新协议、不补新proof。没有新根proof的旧历史完全保持原逻辑。

## 6. 错误与验证边界

新错误统一前缀`attendance_application_window_`：invalid503、changed409、protocol_required409、disabled403、expired409、too_large422、not_found404。activation另用`attendance_operational_consumer_`：invalid503、changed409、disabled403、unchanged409。原业务已知错误保留原code/status，未知SQL／transport不披露。

仅本次完整有效POST的changed/disabled/expired是原子零提交拒绝，若client需要结束，须当前内存lease＋原槽原bytes＋匹配code/status后用户明确确认；GET错误／null不产生该能力。约束／连接／超时未知保持原号。

本包最小实际验证：3族4提交分支、当前revision-v2与旧v1防绕过；企业基线不放宽／0天／根proof不延长；同号无source、同号异body冲突；off后withdraw/recover；旁证故障旧事实零新行；权限／旧函数metadata／归档保护。SQL由root独占启动验收，静态测试不冒充真实消费。
