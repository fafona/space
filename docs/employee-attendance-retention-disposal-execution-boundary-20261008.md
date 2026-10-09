# C23：真实来源与三字段受控执行接点

2026-10-08，只读接点设计。未修改 SQL／产品，未启动环境；不指定下一迁移号。沿已批准的本地合成首包：单个 `location_results.event_id`，仅将 `captured_at / accuracy_meters / distance_meters` 置 NULL；旧事件、版本、定位分类、归档字节均不改。纯候选模块不是可信来源或执行器。

## 1. 已证实的现状与缺口

- 072 `merchant_attendance_location_results` 以 event_id 为 PK；第 18–21 行 CHECK 要求 inside 等 measured reason 三字段非空，第 27–30 行禁止 UPDATE／DELETE／TRUNCATE。因此不能直接 UPDATE NULL，也不能只新增墓碑后宣称已经清理。
- 061 `merchant_attendance_events` 第 97–107 行已有 `(merchant_id,worker_id,sequence)` 唯一索引及 worker/time 索引。定位结果、原事件可以点查；闭合原班次可按序列有界取得。
- 074 reviews 与 075 discussion 均有 `(merchant_id,event_id,revision)` PK；182 preservation_operations 第 96 行有 `(merchant_id,category,record_id,revision)` 唯一索引。存在性、最后保全头均可点查，不需要翻完历史。定位记录只要存在任意 preservation 行就阻断，release 不例外。
- 149 第 74–111 行 artifacts/versions/entries 为互相有创建旁证的不可变归档。183 第 252–254 行新增的是周期范围／日期索引，不是 event → artifact 索引；artifact_metadata 只保存人员显示名。当前没有能够完整、有界反查事件的关系表。
- 148 `faolla_attendance_period_session_v1` 第 180–207 行采原始 events，单班次 probe2003、上限2002；其返回 events 不包含定位三个精度字段。179 第 299、331、738 行同时存在 report 的班次与 `context.plans.sessions`（包括报表时间范围以外的关联班次）。所以不能只按 event 时间所在周期、当前 version 或 report 第一页寻找保全。

结论：已有索引足够“事件→原班次”和保全头，不足以证明“所有历史归档反向引用”。直接扫 artifact_text、GIN 命中后 LIMIT26，均不能把整个执行成本声称为最多 26 行；尤其 GIN bitmap 可先处理大量命中。第一版应使用真实前向关系映射，并对未覆盖的旧事件明确拒绝。

## 2. 最窄可证明的前向覆盖，不自动补旧库

建议三个私有 metadata 表，全部 RLS／无客户端直读写／不可变；不是新的正文副本：

1. `merchant_attendance_disposal_event_coverage(event_id PK FK events, merchant_id, worker_id, sequence, coverage_version=1, recorded_at)`：新增 events AFTER INSERT trigger 在原事务登记**新原始事件**，不修改任何旧 event。安装时不为旧行补证，也不以 received_at 或机器时钟猜测新旧。
2. `merchant_attendance_disposal_artifact_coverage(merchant_id,artifact_id PK FK artifacts, artifact_sha256, source_fingerprint, coverage_version, status, reference_count, references_fingerprint)`：每个新 artifact INSERT 同事务产生完整覆盖旁证；status 为 complete 或 incomplete。另建 `(merchant_id,artifact_id)` 的 incomplete 部分索引。旧 artifact 没有旁证不伪造 complete。
3. `merchant_attendance_disposal_artifact_event_refs(merchant_id,event_id,artifact_id PK, coverage_version)`：FK 指向原事件及 artifact coverage；索引主键顺序必须是 site/event/artifact。同一正文多版本复用只有一份 refs，不按 version 重复计数。

前向 capture 挂 artifacts 新增的独立约束 trigger，不改 183／186 的配额 trigger，不改周期 writer。完整校验安排在事务末，避免 186 v2 的 artifact→version→entry→delegation sidecar 先后依赖：复用 `faolla_attendance_period_artifact_checked_v1`，此时创建旁证已齐全；旧 v1 与新 v2 都覆盖。仍保留原完整归档 checker／deferred authority trigger。

安装必须在同一迁移事务中取得 events/artifacts 的 DDL 锁后一起建立 capture 与完整性约束，不能先给新 event 发覆盖证、稍后才安装 artifact capture。已有进行中的写入须先完成或按原有 lock_timeout 安全失败；不延长超时或关闭原 writer。这样新 event 旁证的存在才表示跨过了同一个完整覆盖边界。

提取器须遍历**完整已支持格式**的 source 及 report，至少包含 `source.report.base.items[].events[]` 和 `source.context.plans.sessions[].item.events[]`；同一 source 内 `startEventId`、端点及其他结构化事件引用也不能遗漏。建议在已核支持格式上保守收集所有 UUID 字符串值，再按原 events PK 验证并归属 merchant，允许多收导致拒绝，不允许漏收。若某嵌套 sourceText 的格式不能证明不含事件引用，必须按其已知格式解析，或标 incomplete；不能靠“字段不叫 eventId”跳过。对未知 sourceVersion／格式、树深度或正文资源超界，保存 incomplete 而不是截断成 complete；既有合法 writer 的正文大小上限不扩大。提取上限由实际已有最大合法格式核准，不能借本模块的 25 个候选依赖上限限制正常周期写入。

可执行来源的覆盖证明是：

- 目标 event 有真实 AFTER INSERT coverage，且 schema 中 capture trigger／函数定义和 ACL 均符合安装契约；它不是“旧事件现在加个标记”。
- 安装前已经存在的不可变归档不可能经现有真实 source→writer 收录尚不存在的新 event。这个结论依赖已核原 writer 与 source 契约，不把手造归档或任意 SQL 当业务来源。
- 安装后的每个 artifact 有事务内覆盖旁证；site 上任何 incomplete artifact 存在时直接拒绝，部分索引 EXISTS/LIMIT1 即可发现。缺旁证必须由始终启用的约束完整性 trigger 在写入事务阻断，不能仅相信应用调用了提取器。
- `(site,event,artifact)` B-tree 按 artifactId 顺序 probe26；超过25直接拒绝，不给第1页 complete。取得至多25个完整集合后，逐 artifact 点核其 coverage、正文 SHA／source 摘要与最后 preservation 头。所有历史版本复用同 artifact 不会漏掉保全。

因此首版**旧 event 没覆盖旁证一律 dependency_coverage_unknown**。不提供自动回填、生产扫描或人工勾选 complete。此限制仍满足已批准有限终点：先安装独立候选，再用正常定位写入产生新的合成 inside 班次，正常 send 生成真实引用该 event 的归档，验证有保全会阻断、无保全可处置。它不承诺现有旧资料普遍可清；如要开放旧资料，需另行实现有界分段索引构建及完整性终点，不能本次顺手省略。

## 3. 可信单条来源与锁内复核

私有建议 ABI（不授予 service_role 直接执行）：

```
faolla_attendance_retention_disposal_source_v1(
  p_site text, p_event uuid, p_observed_at timestamptz
) returns jsonb
```

由外层真实 owner RPC 在 merchant SHARE → settings UPDATE → worker UPDATE → location row UPDATE 后调用。所有参数 false/null、UUID／UTC／长度均显式验，不依赖 NULL 的三值比较。锁后再点读当前 owner、政策、来源与保全。182 的 hold/release 已先 settings UPDATE（第 317–319 行），183/187 周期写入也先 settings UPDATE（183:442/761，187:154）；因此保全和新归档不能在 execute 检查后插队。074/075 已在 settings SHARE 后锁 location row，其新动作还要求 needs_review=true；inside 目标本来不可讨论／核查，但依然做实际 EXISTS 检查。

班次闭合证明：以目标 sequence 向前最多2003条找原 clock_in，再向后最多2003条验证完整、连续 FSM 到 clock_out，目标 event 必须在该序列内，时间单调且不晚于观察时点；超过2002或未闭合拒绝。复用 148 的状态／字段规则，但不要为 owner 的历史资料审查调用当前员工 Auth 的完整 period source 再冒充旧身份。可以新增只验证原事件的 private helper，不改 148 成功路径；不得把 correction effect 当原始 clock_out。原班次摘要只存哈希／首尾 ID，不复制定位精度明文。

来源返回 existing 182 location source 的真实 SHA、当前 policy、闭合原事件摘要、实际 review/discussion/history-snapshot 结果、完整 artifact refs 和相关保全头，并计算 policy/dependency/hold 指纹。可信来源必须自行采集这些项；不接受客户端提交的 coverage=true 来替代查询。纯模块的 sourceFingerprintVerified=false 不得被调用者手改为 true，真正 source 使用独立 versioned DTO。

## 4. 真实三字段更新与最少执行账本

另增两个不可变业务表：

- `merchant_attendance_disposal_approvals`：site、approval operation ID、真实 owner Auth、event ID、固定三字段、previewAt、来源／政策／依赖／保全／preview 摘要、reason、approvedAt、commandFingerprint。仅元数据，不存旧 sourceText 或三个待清字段明文。
- `merchant_attendance_disposal_executions`：site、execution operation ID、approval ID、event ID（unique，防二次处置）、真实 actor、executedAt、commandFingerprint、before/after source 摘要、其余列摘要；内部事务标识只用于当前事务 guard，不公开。执行唯一引用 approval，失败不能留下“已执行”账本。

location_results 新增 nullable `disposal_operation_id`，未处置一律 NULL。072 measured CHECK 的精确前向替换仅增加另一合法分支：reason=inside、needs_review=false、三个精度字段全 NULL、disposal_operation_id 非 NULL。原未处置分支原样保留。不是允许任意 inside+NULL。

仅该表的 `merchant_attendance_location_results_no_rewrite` 改挂专用 guard；共享 `faolla_attendance_events_append_only_v1` 和 no_truncate trigger 完全不改。guard 拒 DELETE，UPDATE 只允许 OLD 未处置→NEW 处置、恰好三个字段归 NULL 与 disposal_operation_id 从 NULL 变成该执行号，其他字段逐值相同；执行账本必须是本事务插入、同 site/event/owner/approval/指纹。service 无表 UPDATE 权限。再加 deferred constraint trigger：提交时执行账本和实际已 NULL 行互相有且仅有一份，来源前后摘要及不变列摘要吻合。只有审批／回执而没有真实 NULL 更新也必须整事务回滚。

迁移需识别原 CHECK 的真实表达式／列依赖而非猜自动名称，精确保存并核对旧定义、trigger、owner、ACL；首装和重入都拒绝漂移。不能 `DISABLE TRIGGER`、drop/recreate 共享 append-only、改 WAL、delete archive 或放宽正文配额。

最少新增函数分工：纯 exact command/hash；original-event coverage trigger；完整 artifact 引用提取器及其 capture/完整性 trigger；可信单条 source；disposal row guard／deferred execution proof；disposed location read projection；下节唯一公开 RPC。可以把同一对象的 capture 与完整性检查合成一个 deferred trigger，但不能删除“缺覆盖时拒绝”的数据库约束。没有第二个通用删除 RPC。

## 5. 单条 RPC 与原号边界

建议独立 service-only ABI：

```
faolla_attendance_retention_disposal_v1(
  p_query jsonb, p_auth_user_id uuid,
  p_command jsonb default null, p_allow_write boolean default false
) returns jsonb
```

query exact `{siteId,mode:'preview'|'recover',eventId,operationId}`：preview 为 eventId 非空、operationId=null；recover 反之，最小原 actor 回执不依赖当前 owner／新写旗。普通 preview 和新 approve/execute 都需当前真实 owner，默认关且仅配置的本地合成 site；不开生产入口。

approve command exact `{action:'approve',operationId,eventId,fields,previewAt,expectedSourceFingerprint,expectedPolicyFingerprint,expectedDependencyFingerprint,expectedHoldFingerprint,expectedPreviewFingerprint,reason}`；execute exact `{action:'execute',operationId,eventId,approvalOperationId}`。真实 actor 仅来自 p_auth_user_id；command hash 必须绑定 actor、site、完整 command。approve/execute 对应 preview query 的同 event。审批只记批准，不自动执行。

注意纯 preview 指纹含 asOf：审批时不能用新的 clock_timestamp 重算另一个 asOf 然后必然拒绝旧 preview。应保存并验证 previewAt，锁内重采当前真实来源及四个稳定摘要，与原批准范围精确比较；用原 previewAt 重建原摘要，另用当前服务器时刻判断到期。新增政策／保全或依赖变化都拒绝，不把旧 snapshot 当当前事实。

执行锁内重新确认批准 owner 仍是当前 owner，event/source/policy/完整依赖/所有 holds 与批准一致且当前到期；owner 转移不默继承批准。相同 actor/site/query/完整 command 的原号精确重放只返回原 receipt，绝不再清字段；不同 command 同号冲突。失去 owner／旗关闭后的恢复只走 authenticated GET 原号最小回执；GET null 不是执行失败证明，客户端不自动 POST。

最小 receipt 建议 `{operationId,action,eventId,approvalOperationId,actorId,recordedAt,commandFingerprint}`，approve 的 approvalOperationId 等于自身号；不返回待清值或完整来源。新 POST 的结果也为 receipt-only；execute 的真实更新与 receipt 同事务。

## 6. 必须兼容的精确旧读取位置

| 位置 | 必要变化／保持 |
| --- | --- |
| 072 `faolla_attendance_location_clock_v1` 第 177–183 行 locationResult 构造 | 只在 disposed 行附加严格 `disposal:{protocol,operationId,disposedAt,fields}`；原未处置 JSON 原样。用新 private read helper 点核 execution 旁证，不重造原测量值。 |
| 113 `faolla_attendance_location_clock_v2`；134 `...location_clock_bound_v1`；141 `...location_schedule_v1` | 已透传 clock JSON，原则上不改 body。保留当前 membership、原 receipt actor、notice、safeFinish、原 command 比对；不能用处置 marker 绕过这些检查。 |
| `src/lib/merchantAttendanceLocationClock.ts:13–15,65–80` | 新 exact disposed union：仍 inside／needsReview=false、三字段 NULL、有效 marker；旧 measured 分支保留。当前分支会因 NULL 拒绝，必须先兼容后允许执行。 |
| `src/lib/merchantAttendanceLocationSchedule.ts:110–129` | 嵌套 strictClock 的 locationResult exact keys 同样增加仅 disposed 分支，再调用上述 parser；不能仅改公共 clock parser 而漏掉外层 exact。 |
| `merchantAttendanceLocationClock.server.ts:31–38,66` 和 `merchantAttendanceLocationSchedule.server.ts:68` | 通过更新后的严格 parser，原号 GET/replay 返回已处置摘要，不重新定位、重复写 event 或修改原 receiptGate。服务流程通常无需改。 |
| 当前 183 `faolla_attendance_retention_source_v1` 第 316 行起，location 分支沿 182:127–133 | 仅 disposed location source 附加同 marker。events/artifact 来源形状原样。182 record/guard 的快照相等规则不放宽；首次执行前已有任何 location snapshot 都拒绝，因此不会破坏旧快照。处置后新 hold 可保存新的 NULL+marker 来源，后续 release 仍原样校验。 |
| `merchantAttendanceRetentionContract.ts:27–31`、`merchantAttendanceRetention.ts:91–101` | 增严格 disposed location union；`Retention.server.ts:14–20` 仍验证实际 sourceText SHA，不用 parser 特例略过摘要。 |
| `MerchantAttendanceLocationClockPanel.tsx:54,88`、`MerchantAttendanceLocationScheduleClock.tsx:35`、`MerchantAttendanceRetentionPanel.tsx` 的 record 展示 | 明示“该笔定位精度字段已按批准处置，原动作／分类保留”，不能显示成“未提供位置”或重复宣称现有测量精度。 |
| 074 SQL detail:87–94、`merchantAttendanceLocationReview.ts:91–98`；075 discussion:132–133 | 当前均要求 needs_review，因此 inside 已处置对象不进入此 detail。首包不改其 parser／扩大访问；实际兼容测试钉住仍拒绝，不把此不可达读取遗漏成兼容承诺。 |
| 141 `faolla_attendance_location_schedule_receipt_v1:59–86` 与 178 original location proof:190 起 | 核的是行存在、版本、notice/identity，不消费三个精度字段；保持原函数，实际前后验证。148 session/179 source 与所有归档 checker 也不为处置修改。 |

## 7. 有限实际验收终点与保护

在唯一 owned 合成 schema 中，通过正常定位 RPC 产生覆盖登记后的 inside 闭合班次，再正常 send 生成至少两个历史版本／真实 artifact 引用（可包含一次同正文复用）。证明关联集合来自反向索引、无旧未覆盖事件混入；artifact/event hold 与 release 后 location snapshot 分别阻断。正常批准后真实执行三 NULL，旧原 event 全行、所有 archive bytes/SHA、period/source 不变，原 clock 与 schedule receipt 可严格读取并显示处置。

仅补新接点必要反例：覆盖缺失／incomplete／26个依赖拒绝；审批后 source/policy/hold/新artifact变化拒绝；回执插入或 UPDATE 后故障整事务回滚；owner 交接不继承批准；丢响应 GET 原号与精确同号 replay 不重复清理；真实 settings 锁下 hold/execute 两种顺序。无需重新跑与处置无关的 C19 全矩阵。

第一版不覆盖旧 event 的反向补证，不处置存在历史 location 快照的对象，也不声称 WAL/MVCC/备份物理擦除。这是可实现的“新本地合成资料一次真实三字段处置”终点；不是无限延期，也不是完整生产保留政策。任何线上发行仍须单独审查新增 trigger 对已有正常 clock／send 的影响，并遵守项目 no-maintenance 发布规则。

## 8. 242 新规则打卡接入后的兼容补记

242 候选193将原072定位主体移入 `faolla_attendance_operational_punch_core_location_v1`，原同名072函数成为保持原签名的包装器。实施本包时须以当时已经验收的193定义为准确前置，不能再假定修改072旧文件或只改包装器就能改变实际读取。新处置投影应接**实际共享core的locationResult构造**；所有旧/新定位入口继续共用，不另复制一份写入逻辑。原113与193 core_location_v2的告知、收尾和原号证明仍保留。

`merchantAttendanceOperationalPunch.ts` 的 `clockData` 对嵌套 `locationResult` 再做 exact keys 校验，必须同步接受第6节同一个严格 disposed union；只改 `merchantAttendanceLocationClock.ts` 会使新规则原号恢复仍拒绝已处置回执。新共享Workspace目前未展示三个精度值，但结果文案需准确区分已处置，而不是测量缺失。新增兼容不改变完整原意图的command hash。

193 `faolla_attendance_operational_punch_origin_v1` 的定位旁证仅保存 eventId、noticeRevision 与 safeFinish，不复制三个待清精度字段；`operation_v1` 还对原notice command做精确比对。处置不能修改该notice、原event、session/source_ref、operation/origin_ref。原号读取须在三字段NULL之后实际复验，不能以“旁证不含精度值”替代兼容测试。其余三个通路保持未处置分支；本补记仅更新实施接点，不表示C23 SQL执行器已经实现或获准处理真实资料。

## 9. 已实现的读取兼容基础，不是处置执行

新增 `merchantAttendanceLocationDisposal.ts` 的 exact marker 与三字段 NULL 分支；只允许 inside/needsReview=false，保留旧测量分支校验。marker 时间不得早于原事件，在有 readAt/asOf 的新打卡及保留来源中也不得晚于读取时刻。字段数组、UTC、UUID、原型及 getter 按新分支严格验证；marker 本身不证明已获处置许可。

旧定位、排班定位、新规则定位原号和保留来源均同步接受同一 union；保留来源仍验证完整 sourceText SHA。四个结果页面明示“定位精度已按批准处置”，不冒充未提供定位或新测量。相关纯测试与旧路径回归已运行；SQL execution proof、反向依赖覆盖、人工批准/执行和真实三字段清除尚未实现，因此 C23 仍为部分完成，未清理任何真实或合成业务资料。

## 10. 新执行协议与本地界面接线，实际 SQL 尚待验收

新增独立 `merchantAttendanceRetentionDisposalExecution` 协议、server、route、durable client、owner 工作区与最小原号恢复。新预览／批准／执行硬限制为合成商户 `99990197`，环境开关默认关闭且不能用 allowlist 扩到真实商户；原 actor 的 GET 回执恢复不依赖当前 owner／新写开关。preview 携带真实来源应提供的 metadata basis，Node 独立重算 policy／dependencies／holds／最终预览指纹，不接收三个精度明文或客户端“已授权”标记。

界面首次打开不发 HTTP；明确读取后才允许分别批准和执行，两步均有确认，批准不会自动执行。完整非秘密意图先写 sessionStorage，再至多一个 POST；丢响应、拒绝或 GET null 保留原编号，仅完整命令匹配的最小回执可以 CAS 清槽。同步身份失效／页面隐藏清除正文但不丢编号；共享恢复总额仍为64个槽。

29 个新增协议／service／route／client／recovery／SSR测试通过；共享恢复和相邻行政结案／审批路由回归共26项通过。上述 HTTP／Auth 均为明确合成前提，SSR不是实际浏览器。SQL197已开始实现但尚未实际安装或运行；反向覆盖、真实三字段NULL、原子回滚及实际页面仍待验收。本段不将候选代码计作 C23 完成，也未处置任何业务资料。

## 11. 实际浏览器四组通过，数据库执行仍单列

`attendance-retention-disposal-browser.mjs --run-local` 已执行：真实 Admin 父入口、Launcher、Panel 和独立原号恢复页，4组通过，耗时5.43秒。共11次合成API请求（9 GET／2 POST）、17次本地HTTP，390px无横向溢出；无外网请求、下载、弹窗或落盘bundle，浏览器和监听已关闭。另2项模型／资源边界测试通过，定向lint无错误或警告。

实际操作覆盖父设置草稿阻止打开、取消批准不发POST、批准丢响应后不自动执行、独立恢复页本地扫描零HTTP、服务端新写关闭时GET null保留及匹配批准回执清槽；执行必须重新明确读取预览并另行确认。执行响应体延迟期间切换Auth，宿主立即卸载正文，原执行编号保留；回原账号仅GET核验。处置后的阻断展示、隐藏清草稿但零自动HTTP及关闭草稿确认也通过。

这是合成Auth／API下的实际组件验收，`actualAuth:false / actualSql:false`。数据库安装、真实来源采集、真实三字段NULL、原子回滚和双连接必要竞争尚在独立原生验收，不能用页面模型代替，也不据此更新C23为完成；没有访问生产或处理真实资料。

## 12. 串行迁移联验发现与窄修（仍未完成197执行验收）

2026-10-08，owned native session98067按195→196→197顺序执行。195完整有限验收与196八组函数均返回通过；197在实际安装前被`disposal_prerequisite_body_pins`拦截。准确失败为定位共享core期待193→195后的`119ae50…`，实际196已合法前向更新为`ef07a7…`。没有绕过guard、退回旧函数、变更ACL或执行处置；parent finally报告`stopped:true`。

197新候选现在明确要求196精确registry，前置body使用196的完整SHA；按原来唯一的处置投影替换计算后完整新SHA为`4c4335d63408ada61d869321c20745f081caa8635df4359b56d5b977d92a3b8c`。SOURCE测试从原193 body依次应用195、196和197的精确替换，逐次核对SHA和唯一命中；所有OID／ACL／默认参数／元数据检查保持。独立197 runner也明确先验196，避免隐含倒序安装。30项197 SOURCE／夹具测试通过；不是实际197执行成功。

此前容量组已经实际形成同一周期27版本、26份归档和26条反向引用；内部计数诊断曾误用业务service_role读取私有表，实际42501后只把该条只读诊断恢复为owned postgres，不给业务角色加权限。完整处置、原号兼容、原子故障和必要竞争仍须串行联验通过后才能计完成。

## 13. 九组原生执行实际通过

2026-10-08，session90615按195→196→197实际运行后，197安装／重入及九组验收全部返回通过，189逻辑步。包括正常新定位来源及未到期拒绝、同周期两版／正文复用的准确反向引用、关联event／artifact保全、解除后的历史location快照阻断、26反向依赖上限、审批后变化／交接／新写关闭、三字段NULL、UPDATE后故障完整回滚、193新规则定位原号读取，以及settings锁下hold／execute两种真实竞争顺序。旧原始事实、周期来源与固定归档bytes均保持。

成功结果只适用于既定本地合成处置范围；没有处理真实资料，也不是物理擦除。外层后续198合成角色setup失败，不能把整条联验称为成功。既有四组实际组件浏览器证据继续有效；全体候选源码冻结后的完整TypeScript及固定台账收尾尚待，不先宣称生产可用。

收口更新：后续session15195与36110再次通过197九组／189逻辑步及旧事实／归档保护；全量TypeScript在session82532退出码0。连同本文件第11节四组实际组件浏览器，已达到Q3批准的精确合成资料处置终点，固定台账C23更新为本地已有。后续199／200联验失败另列，不把整链写成通过；真实期限、真实资料处置、历史快照传播和备份物理擦除仍不获此本地完成结论授权。
