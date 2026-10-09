# C04-B：开放班次行政结案有限实施合同

2026-10-08。范围来自已批准的 Q2；本合同已由主线程全文审核。独立纯 TS 合同的 12 项测试已通过；195 新增 SQL 候选及精确前向兼容正在静态验收，尚未执行数据库，不是 C04 功能已完成声明。保留此前 [boundary 调查](employee-attendance-administrative-closure-boundary-20261008.md) 为历史依据。旧迁移文件及用户数据未改，无邮箱人员 C04-A 不在本包。

## 1. 唯一业务闭环

当前负责人对一个真实暂停、尾事件仍 working/break 的班次登记 `record_unknown`，或明确核验结束时刻后 `close`。未知不产生操作边界。已关闭仍保持暂停，随后必须显式执行原 166 任职结束、后日同身份再入职、164 恢复，才允许下一次真实上班。

行政关闭不是 clock_out/break_end、本人确认、补正核定或工资结算。原 events、sequence、135/137/145/193 已存旁证及 correction_effect 不修改、不补造。下一次真实上班用真实尾 sequence+1，不占用额外序号。

本包不提供行政边界撤销、修改已关闭时刻、代员工确认、自动恢复、自动取消申请、自动核定时长或薪资。负责人回复不能消除本人异议。错误/有争议的时刻保留原记录和异议，不重新接通旧班次。

## 2. 状态及时间规则

- `record_unknown`：理由必填，`verifiedEndAt=null`；案件为 `pending`。可追加新的未知说明，不能解除 166 的 open_session 阻断。原正常恢复后真实收尾路径不因此被封锁；如果真实尾已变化，旧行政候选失效，不能套用旧 CAS。同一班次恢复、推进真实尾、再次暂停后，可以真实重读新 candidate，在同案追加另一份未知说明或 close；旧说明的暂停代次、尾及来源原文不改。
- `close`：理由和 `verifiedEndAt` 必填。必须原暂停仍有效、同 worker/employee/Auth、同任职期、同真实起点与尾、尚无有效行政边界；尾动作只能 clock_in/break_start/break_end。
- `tailOccurredAt <= verifiedEndAt <= lockedNow`，均 canonical UTC6；锁后用 clock_timestamp 再验。不从暂停时间、排班终点、浏览器当前时间或“现在”默认填值。只接受 2000-01-01 至 2100-12-31 的既有日期技术范围；这是技术输入范围，不是法律期限。
- `close` 后案件为 `closed`，同起点只能一条有效关闭操作。保留原 raw 状态 working/break、raw endAt=null、raw totals=null；额外展示“负责人核验结束时刻，工时未核定”。
- 本人可对 pending/closed 案件追加 `self_dispute`；负责人可对具体异议追加 `owner_respond`。它们不改变操作边界、工时和任职状态。
- 已关闭旧段但尚未合法后日 rejoin 时，164 不得恢复旧任职。166 当日结束、结束日当天不可 rejoin、未来事项须经原入口处置等护栏不变。

## 3. 两张新私有表与三个私有接点

拟命名（新增迁移编号由主线程最终排期，不覆盖旧迁移）：

1. `merchant_attendance_administrative_closures`：案件只固定身份、任职期、真实起点 ID/sequence/time（下节 ClosureCaseScope），不固定暂停代次、尾或当前 source。以 `(merchant_id,start_event_id)` 唯一；固定字段不可更新。新表 head 投影只有 current revision、latest_source_operation_id、唯一 closed_operation_id，可由 RPC 原子推进；latest_source_operation_id 只指本案最近的 record_unknown/close。
2. `merchant_attendance_administrative_closure_entries`：append-only 操作；`(merchant_id,operation_id)` 主键、`(merchant_id,start_event_id,revision)` 唯一。保存原命令、真实 actor、完整 command SHA、recorded_at；每个 record_unknown/close 另保存**当次**完整 frame/context、source 原文/UTF-8 字节数/SHA。self_dispute/owner_respond 不重采来源，以上 source 字段为 null。关闭操作唯一约束。禁止 UPDATE/DELETE/TRUNCATE、客户端直接表访问。

每份来源的固定起点/身份/任职必须等于 case scope，但 suspensionId/generation/tail/timeZone/当前版本允许随合法重采变化。每个历史 entry 自验自己的来源；不能要求旧 record_unknown 仍等于当前暂停状态。close 一旦成功只引用自己的那一份来源，其后不得追加 record_unknown/close；本人意见、负责人回复仍可追加。无需第二种 caseId，也不复用或改写旧来源。

拟私有函数：

- `faolla_attendance_administrative_source_v1(site,worker)`：每次 candidate/新写均从当前事实真实重采有界事件段、暂停/身份/任职与当前版本证据；原起点至尾最多 2002 个事件，2003 sentinel 拒绝。不能从 case.latest_source_operation_id 硬恢复旧候选，也不能调用要求 active/self.view 的公共 self_session 冒充负责人授权。
- `faolla_attendance_administrative_boundary_v1(site,worker,start_event)`：按唯一键读取 closed_operation_id 指向的 close entry，核对**该 entry 自己**的固定 source、真实起尾及 hash 的不可变证明；无案例或尚未 close 为 null，损坏/矛盾必须拒绝，不当作不存在。
- `faolla_attendance_operating_head_v1(site,worker)`：真实 raw tail 和原 sequence 完整保留；仅当严格 boundary 覆盖当前真实尾时，操作状态为 off。无边界沿原状态机；不是修改 raw event。

所有公共 RPC 先 merchant SHARE → settings UPDATE（读按需 SHARE）→ worker UPDATE/SHARE → employee SHARE → case head。写在锁后重核时间、当前 owner/本人绑定、暂停代次、尾、来源和 CAS。沿现有 settings 锁与暂停、恢复、打卡、任职和封存串行，不另造反向锁序。

## 4. 基础类型及固定 source

UUID 必须 canonical 小写；siteId 精确 8 数字。UTC6 长度 27，必须能严格 round-trip。正版本/暂停代次和 revision 最大 9007199254740990；expectedRevision 可 0，但新追加必须可加 1。employmentRevision 也可 0，表示原 166 合法初始单开放任职尚无 close/rejoin 操作，不能将其误拒为缺证据。reason 为 trim 后原样 1..500 Unicode 字符，无控制字符/非法代理对。Hash 为小写 SHA-256。

下列结构 exact keys，无任意 JSON、getter、重复 URL 参数或额外字段；异步摘要前持有自有快照。

```ts
type ClosureIdentity = {
  workerId: UUID; employeeId: UUID; employeeAuthUserId: UUID;
};
type ClosureCaseScope = ClosureIdentity & {
  employmentPeriodId: UUID;
  startEventId: UUID; startSequence: number; startAt: UTC6;
};
type ClosureFrame = ClosureCaseScope & {
  suspensionId: UUID; generation: number;
  tailEventId: UUID; tailSequence: number;
  tailAction: 'clock_in'|'break_start'|'break_end'; tailOccurredAt: UTC6;
  timeZone: string;
};
type ClosureContext = {
  workerVersion: number; employeeVersion: number; settingsVersion: number;
  employmentRevision: number; sourceFingerprint: SHA256;
};
```

`sourceFingerprint` 来自版本化 canonical tuple：site、完整 frame/context（不递归包含 fingerprint）、完整有界 raw 事件字段、暂停保存的原尾身份、对应当次任职与 epoch。元数据来源必须真实读取，不能直接相信输入 frame。每次 record_unknown/close 的固定源均独立保存原文+字节+SHA；历史 detail/回执不重采当前事实代替固定源。case 固定的 ClosureCaseScope 不包含 timeZone，真实时区也属于当次来源快照。

frame 的 employeeAuthUserId 是暂停/行政时真实保存身份，**不是声称原 raw 事件保存过 Auth**。原事件只有 actor_employee_id 时不得倒填 135/137 或伪造 148 identity proof；需要原始 actor_employee_id 与保存员工匹配，不能从姓名、工号或当前 Auth 推断旧归属。

## 5. HTTP/RPC exact 合同

新 API：`/api/merchant-enterprise/attendance/administrative-closures`。新 RPC：`faolla_attendance_administrative_closures_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb=null,p_allow_close boolean=false)`，仅 service_role 可 EXECUTE，真实 Auth 由服务端提供。

Query 使用判别联合，不要求不适用字段占 null：

```ts
type ClosureQuery =
 | {siteId; access:'owner'; mode:'workers'; afterId:UUID|null}
 | {siteId; access:'owner'; mode:'candidate'; workerId:UUID}
 | {siteId; access:'owner'|'self'; mode:'list'; afterId:UUID|null}
 | {siteId; access:'owner'|'self'; mode:'detail'; startEventId:UUID}
 | {siteId; access:'owner'|'self'; mode:'history'; startEventId:UUID; beforeRevision:number|null}
 | {siteId; access:'owner'|'self'; mode:'recover'; operationId:UUID};
```

URL 只接受对应判别分支的键，无重复键/片段；显式 nullable 游标使用字符串 `null`，非空 revision 用无前导零十进制，不把缺键视作 null。

`workers` 是负责人现有分页人员目录的同授权窄适配，25+1、UUID 升序，不全读。`candidate` 只给当前可核查 paused worker 的完整 source 或明确 blocker，不凭 UUID 赋权。`list` 只案件简表，owner 当前商户，self 保存收件 Auth 且当前真实绑定符合；25+1 UUID 升序。history 每页 25+1、revision 降序 exclusive before，终页 next=null，不设永久业务条数 cap；每页核序列、原号和 hash。

Command 共用 exact 字段加各 action 的字段：

```ts
type ClosureCommandBase = {
 operationId:UUID; startEventId:UUID; expectedRevision:number; reason:string;
};
type ClosureCommand =
 | (ClosureCommandBase & {action:'record_unknown'; workerId:UUID;
     expectedSourceFingerprint:SHA256; verifiedEndAt:null})
 | (ClosureCommandBase & {action:'close'; workerId:UUID;
     expectedSourceFingerprint:SHA256; verifiedEndAt:UTC6})
 | (ClosureCommandBase & {action:'self_dispute'; expectedClosedOperationId:UUID|null})
 | (ClosureCommandBase & {action:'owner_respond'; disputeOperationId:UUID});
```

POST exact `{query,command}`：首次/继续 record_unknown、close 使用 owner candidate query，workerId 和真实 source startEventId 必须相符；dispute/respond 使用对应 access detail query，startEventId 相符。任何 POST 不能用 recover mode。`expectedSourceFingerprint` 同时绑定真实尾、身份、暂停、版本，不再复制一大组调用方身份断言。

`Entry` exact：`{operationId,startEventId,revision,action,actorId,actorAccess,reason,verifiedEndAt,disputeOperationId,frame,context,recordedAt,commandFingerprint}`。record_unknown/close 的 frame/context 必须完整且成对存在，并与自身来源 SHA 相符；self_dispute/owner_respond 两者均 null。非 close 的 verifiedEndAt=null；非 respond 的 disputeOperationId=null。self_dispute 的预期关闭引用仍在完整保存 command 中。历史页保留旧版本的真实 frame/context，不用最新来源覆盖。

`Receipt` 是严格最小 exact：`{operationId,startEventId,revision,action,actorId,recordedAt,commandFingerprint}`，不发 reason、source、当前正文或新的权限。

`Summary` exact：`{startEventId,identity,employmentPeriodId,state,revision,verifiedEndAt,closedOperationId,hasDispute,updatedAt}`；state pending/closed，close 前结束时刻及 closedOperationId 均 null。hasDispute 表示已有异议，回复不能把它抹成 false。

`Detail` exact：`{summary,frame,context,evidenceOperationId,currentEntry,closure,capabilities,blockers}`。closure=null 或下节 boundary。capabilities exact 四个 boolean：`canRecordUnknown/canClose/canDispute/canRespond`。

- candidate 的 frame/context 必须是本次真实重采、成对存在或成对 null，evidenceOperationId 恒 null；不能把旧 snapshot 当作当前候选。无合法当前开放段时两者 null、明确 blocker、canRecordUnknown/canClose=false。尚无案件时 summary/currentEntry/closure 均 null、expectedRevision=0；已有同起点案件时显示其实际 summary/currentEntry，不覆盖其旧来源。仅当前合法 candidate 可以给前两项写能力。
- detail 的 frame/context 来自 latest_source_operation_id 指向的已保存 entry，evidenceOperationId 必须为该原号，始终成对存在；currentEntry 可以是较新的异议/回复。前两项写能力恒 false，必须显式转 candidate 重读才能继续行政核查。本人/负责人看历史依据不依赖旧暂停仍有效。history 不夹带 detail 或所有旧正文。

blockers 固定为 `not_paused/identity_changed/employment_changed/suspension_changed/source_changed/session_not_open/already_closed/revision_limit/feature_disabled/period_sealed/source_too_large` 的无重复数组，不接受任意字符串。纯解析检查这些证据的结构/关联，不声称已核实数据库锁、完整 raw source 或 SHA 的真实来源。

Result exact 外层：`{protocol:'attendance-administrative-closures-v1',siteId,access,actorId,readAt,data}`。data 联合：

- workers：`{kind:'workers',items:Worker[],nextAfterId}`；Worker exact `{workerId,employeeId,employeeAuthUserId,workerNo,displayName,paused}`，nullable 身份可展示但不能候选关闭。
- list：`{kind:'list',items:Summary[],nextAfterId}`。
- candidate/detail：`{kind:'candidate'|'detail',detail:Detail}`。
- history：`{kind:'history',startEventId,items:Entry[],nextBeforeRevision}`。
- recover/POST：`{kind:'receipt',receipt:Receipt|null}`；成功 POST receipt 必须非 null。不能从 receipt 推导 CAS，必须显式重读。

HTTP 成功 envelope `{ok:true,data:Result}`；错误 `{ok:false,error:{code,message}}`，严格状态/错误白名单。输入 8 KiB、响应 128 KiB、body 5 秒、客户端含摘要/stream 总 12 秒；Origin、password Auth、限流、no-store 沿现有独立安全入口。

新错误前缀 `attendance_administrative_closure_`：`invalid`503、`changed`409、`blocked`409、`disabled`403、`not_found`404、`too_large`422；沿用 `attendance_invalid_request`400、`attendance_access_denied`403、`attendance_operation_conflict`409、`attendance_period_sealed`409。未知 SQL/网络/解析错误不是零写证明，不能自动清 pending。

## 6. 幂等、权限与暂停后的本人入口

- operationId 在新 entries 中按商户唯一。同号同 actor/完整 command 返回同最小回执，不再写；异命令或异 actor 冲突。commandFingerprint 为版本化、字段顺序固定的 tuple SHA，包含 site、真实 actor、access 和完整 command（reason/时刻/引用也在内）。
- 普通 POST（包括同号）仍要求当前对应 owner/本人资格；失权 actor 使用 GET recover。recover 只按商户+原号+原 actor 查最小回执，不要求当前 owner、active、业务旗或 entitlement，不给正文和新权限。
- 当前 owner 可看到本商户已保存案、回复；owner 换人不改原 actor/回执。新 close/record_unknown 默认关并受新开关+精确站点名单；已经保存案件的 owner detail/history、本人 detail/history/dispute 和 owner respond 不因关闭新结案开关失去可达性。
- 本人入口独立于 active 员工页、attendance.self.view/clock、现任职和打卡恢复。仍要求正常真实 Auth，保存 employee/Auth 与当前 membership/worker 绑定一致；暂停、任职已结束不单独拒绝。换绑不把完整历史给新账号，旧 actor 最小原号恢复独立保留。
- 独立页面允许明确输入公开企业编号后，按实际 Auth 读取本人案件分页；不输入员工 UUID、不从 localStorage 认领资格。企业选择页/概览提供该入口，不能只加“有 pending 才显示”的恢复链接，因为员工可能从未提交过操作。
- Client 初始化只检查当前 Auth 的本地 pending，不自动 GET；保存完整命令和指纹后唯一 POST；未知结果保持原字节，只匹配回执可清。hide/换 Auth/请求器清正文与草稿、取消等待，不删除原号；parent guard 包含脏表单和 pending。

命令摘要精确编码为 PostgreSQL jsonb 风格的 tuple（逗号后一个空格，字符串按 JSON 转义）UTF-8 SHA-256：`["attendance-administrative-closure-command-v1",siteId,actorId,access,[operationId,startEventId,action,expectedRevision,reason,...extra]]`。`extra` 对 unknown/close 是 `[workerId,expectedSourceFingerprint,verifiedEndAt]`，对 self_dispute 是 `[expectedClosedOperationId]`，对 owner_respond 是 `[disputeOperationId]`。历史 Entry 没有 self_dispute 的 expectedClosedOperationId，故纯解析不能仅凭该历史 DTO 独立重算其 command SHA；如实仅核 SHA 形状/序列/身份。POST 与有完整 pending 的 GET recover 必须用完整原命令重算并匹配，null receipt 绝不是已完成或零写证明。其余 action 的历史 Entry 可由已发字段重建命令并核 SHA。

## 7. 操作头、再入职和四通路兼容

Boundary exact：`ClosureFrame` 加 `{protocol:'attendance-administrative-boundary-v1',siteId,operationId,revision,verifiedEndAt,recordedAt,sourceFingerprint}`；只来自有效 close，尾/起点/身份/任职/epoch 与固定 source 逐项相符。recordedAt 为实际关单时间，verifiedEndAt 不等于工时终点。

严格 clock state 只新增有证明分支：真实 lastEvent 与 sequence 原样，`status='off'` 可以由 `administrativeBoundary` 支持；无 boundary 保持原 parser 和 raw 动作推导完全不变。不得发伪 clock_out 或把 lastEvent=null。新上班之后 current state 不再携旧边界，但其前驱分段验证能按上一真实尾点查边界。

必需最小旧接点（在新增迁移内匹配当前函数定义，旧迁移文件不改）：

| 接点 | 必要改变及原样保留 |
| --- | --- |
| 166 `faolla_attendance_employment_detail_v1`，199–202 | 仅严格 boundary 替代 open_session；暂停原尾一致、身份、历史链、未来事项、日期全部保持。不能把 currentAction 改为 clock_out。 |
| 166 包装的 `faolla_attendance_account_detail_v1`，394–413 | 已 close 但尚未完成对应旧任职 close+后日 rejoin 的当前边界，额外阻 restore；同身份合法新任职才放行，164 原真实尾对照不删。 |
| 111 self_v1；072 location_clock_v1；108 onsite_clock_v1；112 pin_clock_v1；143 pin_schedule_v1；113 location_clock_v2 | 六个实际 writer 统一 operating_head；safeFinish 不得再次结束已行政关闭的段。旧同号 replay 优先和真实 PIN begin/KDF/lease 保持。 |
| 当前 193 的五个私有 `operational_punch_core_*`、第六个直接 `pin_schedule_v1` body，以及 `operational_punch_current_start_v1` | 195 对这七处按原/新 body SHA 及原 metadata 精确替换。`legacy_gate_v1`、`before_v1`、`result_v1` 沿用不改；它们依赖的状态/当前真实段已经正确分段。已行政关闭的 managed 段不能再当 active session；新开班仍沿 242 activation/policy/四凭证门槛。 |
| 当前 110 `self_session_v1`、148 `period_session_v1` | 仅有证据时按固定真实 tail 截取旧段；合法后继段严格证明前驱已关闭。没有证据的分支保持原状态机/上限/身份检查。 |
| 当前 143 `shift_check_v1(jsonb,uuid)` 和 184 私有镜像 `pd_shift_v1(jsonb,uuid)` | 在真实 135/184 授权身份检查之后，同样先核完整 boundary/前驱，再按行政 tail 截段；旧 DTO 不加字段。自身行政段仍是原始未闭合段，保留 null end/totals 与原 `session_open` 判断；仅前驱有证明而本段真实完整，必须继续原状态机正常核对，不能永久追加 unresolved。 |
| `merchantAttendanceSelf.ts:85–86`、`merchantAttendancePinClock.ts`、`merchantAttendanceLocationClock.ts`、`merchantAttendanceOperationalPunch.ts:263–280` | 添加 strict boundary 状态分支而非放宽原 off 检查；原 command、pending、receipt/hash不变。 |
| `merchantAttendanceEmploymentLifecycle.ts` 的 `detail()`（当前约115–118）及相应UI | 它现还硬拒 canClose/currentAction非clock_out；必须读取/验 boundary，不能 SQL 放行后 TS 一直报坏数据。原命令及旧已闭合路径不变。 |

行政关闭本身不恢复 worker、账号、PIN 或委托，不直接改任职日期。使用原 166/164 真 RPC 完成后续链；当天 rejoin 仍拒绝。新边界变化在 settings 锁内，四 writer 每次重新读头，旧 prepared sequence 不能绕过 off/break/finish 检查。

195 的准确旧函数白名单是该迁移 `$administrative_recipes$` 内的 28 个 signature，每项固定旧 SHA、新 SHA、替换片段及出现次数；包括本节状态/核查和下节六个 report、四个 source、两个 envelope、两个 artifact checker、一个 retention source。安装保留函数 OID、权限、参数默认值及其余 metadata。没有改周期 send/seal writer、原额度触发器或旧事件/补正 effect。

## 8. 汇总、周期与旧归档

不能仅实现 writer。070 self_session:29 和 148 period_session:101 要求新上班前一事件为真实 clock_out；153 report:123–143 将前开放段读到后续真实下班；TS Session:45–67、Timesheet:91、TimesheetResponse:74、ClosureSourceReport:148 又拒前开放段后接新段。以上必须同步做**有证明的分段**。

新增 affected-report 分支 `raw-and-approved-v3`，仅有行政证据时使用；原 v1/v2 分支继续原形状和算法。每个 v3 原始 item exact 为 `{startEventId,events,effect,administrativeBoundary,predecessorBoundary}`：

两个 boundary 字段在公共 report 中均为 `AdministrativeReportBoundary | null`，不是完整账本的 `AdministrativeClosureBoundary`。公共类型 exact 12 字段：`{protocol:'attendance-administrative-report-boundary-v1',operationId,startEventId,startSequence,startAt,tailEventId,tailSequence,tailAction,tailOccurredAt,verifiedEndAt,recordedAt,sourceFingerprint}`。SQL 必须先从固定账本核验完整身份、原事件前缀和保存来源 SHA，再投影；不得仅靠删字段替代核验。此公共结构不带 employee/Auth、worker、employment、suspension、generation 或 reason，故旧 manager 合法范围报表不会新增这些身份或理由披露，也不因合法行政段而整体拒绝。每条原段和前驱仍严格校验 ID、连续序号、真实尾动作及核验边界。

- 原行政段事件仅截至真实 tailSequence，不添加结束事件；administrativeBoundary 是本段 close proof；effect 必须 null，original/selected endAt、totals、originalInPeriod、selectedInPeriod 均 null。
- 下一真实段 predecessorBoundary 可证明 sequence-1 对应旧尾已行政闭合；本段事件仍按原完整状态机计算。缺/错证明拒绝，不跳过事件。
- 旧段关联区间采用 `[startAt,verifiedEndAt)`（零跨度沿既有一微秒点规则），仅用于归属/分段，不用于时长计算。晚于边界的新日期不再把旧开放段视为延续至 asOf。
- v3 输出新增 `administrativeUnassessedCount`、`totalsComplete`；后者仅在没有相关未知行政段且原完整条件成立时为 true。原已闭合来源照常形成**已知部分小计**；有未知段时 UI 不得把该小计标为完整工时、行政段标零或计算工资。

周期 source 使用新明确版本 `attendance-period-source-v5`，canonical context 增 `administrativeClosures`（按startEventId排序/去重的完整 `AdministrativeClosureBoundary` 固定证明，含当前行或其前驱所需证明），仍不采当前 owner、当前授权或把 Auth 编造成历史。`source.report.base.items` 和 `context.plans.sessions[].item` 的两个 boundary 字段均使用相同公共 12 字段投影；完整身份集中在 `context.administrativeClosures`，逐项核对其公共投影相等。该完整 context 只沿既有 server 授权周期来源路径保留，不能因公共 manager report 合法而将 rawSource 开放给 manager。变更关闭事实会变 fingerprint；本人异议/回复不改变已经固定的边界，也不污染后日新段的指纹。

旧 source v1–v4、旧 artifact 原文/字节/SHA 与保存版本解析保持不变，不重采当前行政账本补成 v5；新 v5 保存时严格验证公共投影与完整固定证据的一致性。无行政证据的旧成功分支仍返回原形状，不添加全 null 的兼容键。

需同步 153 动态 report/source、155 fixed-boundary report、175/179 当前来源和 184 delegate 私有镜像，以及 149/186 artifact checker 对新 sourceVersion 的显式严格分支；旧 artifact/body/sourceText/SHA/version/旧回执/导出均按保存版本解析，不重采、不重写。182 retention 的固定 artifact 验证必须仍可读取旧新保存正文，不改其 hold/release 语义。

Node 接点：`merchantAttendanceSession.ts`、`merchantAttendanceTimesheet.ts`/`Response.ts`、`merchantAttendanceUnifiedTimesheet.ts`、`merchantAttendancePeriodClosureSourceReport.ts`、`merchantAttendancePeriodClosure.server.ts` 的 canonical/source/blocker 检查、`merchantAttendancePeriodClosure.ts` 的 saved artifact 验证及对应展示。新增共享 proof/parser，旧分支不泛放宽。

涉及行政未知工时的周期添加明确 blocker `administrative_hours_unassessed`：可以保存发送供本人核对/异议，但不能 seal，不代本人 confirm。现183:890仅限制进行中周期/未结故障后允许 send、965要求全部blockers空才seal，187同门槛应保持。新 blocker 必须由 Node 对真实 context/行双向核验，不能只相信 SQL 的任意字符串。

首次 close 调用既有 `faolla_attendance_period_assert_open_v1`，检查本段 startAt 至 verifiedEndAt 影响区间；已有封存先按原周期流程 reopen，不自动解封。后续 self_dispute/owner_respond 是追加意见，允许保存，不改任何已封存 artifact 或操作边界。

**明确终点限制：**本包没有核定行政段时长的 writer，所以含该段的周期保持工时未核定/不可封存。这不是将 null 默算0；以后如需形成核定时长属于另一个明确业务决定，本包不伪装已提供。只要求边界之后的新段和新周期能够正常独立完成。

## 9. 新文件/页面接口及有限验收终点

新独立 TS 组拟 `merchantAttendanceAdministrativeClosure.ts`（上述 exact类型/parser/hash）、`.server.ts`、`Client.ts`、`Recovery.ts` 及定向 tests；新 `administrative-closures/{route.ts,route-handler.ts}`。新 `MerchantAttendanceAdministrativeClosurePanel/Launcher`，owner 从 Admin 全局/人员行的已有生命周期入口附近进入；独立本人页和选择页链接，不把全部管理员页开放给暂停成员。原号汇总 recovery 只加新前缀和最小回执，不提供正文越权通道。

有限验收只以下六组，不扩大到所有通路×所有规则×所有补正组合：

1. working 与 break 各一真实暂停案：record_unknown零边界；close真实尾及结束时刻约束；raw event/sequence不变，break不造break_end。其中一案必须经过 record_unknown→真实恢复→真实尾推进→再次真实暂停→新candidate→同案close；旧候选拒绝、旧未知来源字节不变、新close绑定新暂停/尾，同start只一个有效close。
2. 一条完整真实 close→166close→受控后日rejoin→164restore→新真实clock_in；另一个起始状态作边界拒绝。四通路 shared head/read/拒绝旧finish各最小一次，真实凭证前提不伪造。
3. 原员工暂停/离职后独立看案并异议；owner回复；换Auth/换绑/另一商户拒正文，原actor失权只GET最小receipt。
4. 同号相同/冲突、CAS尾或epoch变化、一次写失败全回滚；仅 settings锁上的一对 close↔restore/真实write必要竞争。
5. 旧段null工时且周期可保存/本人异议但不能seal；后日新段不续接旧段，新周期真实send/selfconfirm/seal；旧155/207及后续旧artifact字节/SHA和所有原events精确不变。
6. 实际 owner+独立self页面：显式读/写、确认取消0POST、未知保号GET、隐藏/身份晚响应清正文、脏草稿离开、25/26历史页与390px。

Native 可复用 `runPeriodDelegatedClosureNative(args,after)` 的现有 owned schema及真实193安装，补有限166/164前置；现 `runEmploymentLifecycleNative(args,browserCheck)` **没有after扩展参数**，不能把函数第二参误当新hook。单新owned事务+精确回滚，原parent负责全库/归档校验和停机；不新建集群、不复制数据、不假造原事件结束事实。浏览器只在root统一安排时运行，真实账号/硬件试点仍独立如实列明。

### 9.1 首轮原生夹具的时间证据边界

新增 `scripts/fixtures/attendance-administrative-closure-native.mjs` 的首轮候选明确分为 A/B/C，不声称上述六组均已验收：

- A：新合成商户 `99990195` 内的现时真实打卡、暂停、未知记录、本人异议、负责人回复、恢复、尾推进、再次暂停、行政 close 和166任职 close；当日 rejoin 必须实际拒绝。064已有事件后禁止改商户时区，夹具也实际验证此拒绝，既不修改系统时间，也不绕过这个历史保护。
- B：只从 A 实际输出构造新 worker/employee/Auth、全新操作号的具名历史模板，UTC日期整体移到三日前；重新计算固定 sourceText/字节/SHA、命令摘要，并按 revision1起逐条推进新行政头。普通CHECK/FK/append-only触发器始终启用，显式运行195固定来源和166任职链checker。随后当日166 rejoin、164 restore及四通路新开班/结束使用真实RPC。种子本身不是历史RPC或真实员工同意。
- C：把 B 包含真实 rejoin 和完整后继段的模板复制成第三个独立身份，再整体移到两日前，使事件严格处于该历史任职区间；由真实周期服务/Node严格投影及SQL执行旧未知期的send/本人confirm/拒seal、后继完整期的send/本人confirm/seal。不把当前尚未结束的自然日伪装成已经结束的周期。

每份历史模板至多60行、256KiB；只在同一 owned schema、单个90秒连接、至多120步的最终ROLLBACK事务内使用。定位分支另在savepoint中明示设置新合成商户的location开关和新地点三个围栏字段；告知发布/确认仍走真实RPC，坐标是合成输入，不称真实GPS。整个旧商户集的全表行哈希、函数/表结构、原始事件及155/207归档实际UTF-8字节和SHA均须保持。

此时只完成该夹具9项纯/static测试及语法/定向lint，尚未实际运行SQL。单独break直接close、原子失败/必要竞争和实际页面验收仍须按第9节有限终点另行完成，不能以这份脚本的存在宣称C04-B完成。
