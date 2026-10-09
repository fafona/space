# C07 剩余八字段：复用边界与有限实施合同

日期：2026-10-08。状态：只读研究后的实施设计，不是功能已交付／真实环境验收记录。本次仅新增本文，未改产品、SQL、进度台账，未启动数据库或浏览器。

依据为[原计划 §10.3](employee-attendance-plan-20260929.md#103-规则字段)（223–229 行）及[有限缺口 C07／Q4](employee-attendance-finite-completion-gaps-20261008.md)（26–30、54–60 行）。Q4 已批准：明确核准后生效、不追溯重算、地点只收紧、不阻止正常收尾、提醒仅站内且合并限频。下面八项都保留在交付范围内，不以“已有同名配置”或未经用户确认的延期消掉缺项。

## 1. 已有能力与未完成边界

四个阈值仍由原链处理；不把这次新目录塞进旧严格 DTO，更不重跑旧四阈值矩阵冒充八字段完成。

- `src/lib/merchantAttendanceRuleDraft.ts:5–16` 仅定义迟到、早退、未结束时段提醒阈值、已结束休息下限；其 `inherit / disabled / value` 是可借鉴的表达方式，不是八项已有实现。
- `src/lib/merchantAttendanceThreeLayerRules.ts:34–38` 的解析结果仍标 `formalReady:false / applied:false`；`merchantAttendanceRuleCaptures.ts:11` 的独立候选快照也不能充当生效凭证。
- `src/lib/merchantAttendancePlanRuleApprovals.ts:12–31` 的正式核准只含迟到／早退两项。已核准计划和已有采用证据不因新目录重写。
- `scripts/supabase-migrations/202610040134_merchant_attendance_bound_clocks.sql:36–118` 四个 wrapper 仅对 fresh `clock_in` 绑定原规则；原号重放不重绑。PIN 分支 82–87 行明确不能用异常子事务改变凭证 lease 的消费语义。

| 字段 | 已有可复用事实／配置（仓库依据） | 仍须新增的实际消费 |
| --- | --- | --- |
| 允许方式 | `merchantAttendanceRuleBindingDispatch.server.ts:1–22` 已有 self/location/pin/onsite 四通路及精确商户开关；`merchantAttendanceAdmin.ts:4` 有企业开关与 webClockEnabled | 组／个人规则约束新开始所用通路；不能只隐藏按钮，也不能由规则启用未开通、未授权或未验证的通路 |
| 地点范围 | `merchantAttendanceAdmin.ts:6` 每 worker 有 locationId；111 SQL 109–120 行仍检查 default_location_id、地点有效及雇佣；112 SQL 64–69 行检查 terminal 与 worker 地点；LocationSetup 的 prepare/enable/pause、通知与围栏版本已有独立流程 | 三层地点限制与原通路实际授权取交集。现有单默认地点并不是“任意地点列表授权”；新规则不得借此增加可打卡地点 |
| 班次来源 | `merchantAttendanceSelfSchedule.ts:5–14` 已有已发布 slot、明确 selection、linked/unselected/unverified；137–144 各通路实际关联及核准采用已有实现 | 规则决定是否提供／采用已发布计划作为班次依据，并固定来源。无计划仍记录事实；不默认选最近班次、不生成缺勤 |
| 休息类型 | `merchantAttendance.ts:18,80,167–177,208–216` 原事实区分 paid/unpaid；Admin 的 webBreakPaid 和111 SQL131、112 SQL79 当前由企业设置决定新 break_start 的布尔值 | 新规则可明确允许的两类及选择方式，并把实际选择写入事件；不能只改显示名称或事后 UPDATE 原 breakPaid |
| 申请窗口 | `merchantAttendanceCorrectionControls.ts:4–14,34–35` 已有 0..365 天企业政策；085 SQL40–61、109–115 固定补正政策与本地日截止；103 SQL141、221–227 对漏卡／漏卡修订采用该政策；`merchantAttendanceWorkArrangement.ts:18–25,136` 另有 retrospectiveDays | 为补正／漏卡新增组／个人约束及提交时固定证据。企业现有政策继续是独立基线；工作安排不悄悄套补正期限，请假不凭空增加期限 |
| 审批人 | MissingDelegation 的精确 worker/location/期限 grant；ApplicationDelegation 的 leave/work_arrangement/kinds；新的 CorrectionDelegation 精确 correction/location/includePending；均有实际决定 RPC，不是角色名称 | 三层路由必须解析为当前真正可用的精确 grant／负责人，并保存选择证据。路由配置不发 grant、不授角色、不允许自批，不取代写入时重新授权 |
| 工时表周期 | `merchantAttendancePeriodClosure.ts:66–73,89–93` 范围至多31个民事日；V2.ts:14–34、V2.server.ts:50–72 已有固定范围预览、发送、版本、历史与导出 | 新规则生成明确的民事日期窗口，并固定采用版本；不自动 send/confirm/seal，不改已有 periodId 的保存范围或旧归档 |
| 提醒 | RuleDraft 的 openSpanWarningMinutes 是阈值，不是发送任务；EventNotifications.ts:11–24 是排班／安排／事后判断事件；OwnerNotifications.ts:11–21 是新说明／争议事件。169 SQL40、188 SQL50 的去重键是来源操作号 | 新增到期扫描、提醒身份／规则版本、合并限频与发送回执；不能把一次事件通知当成重复催办引擎 |

以上简称 SQL 均指 `scripts/supabase-migrations/` 中对应编号文件，TS 均指 `src/lib/`。最后一项的新提醒不能写成旧169／188不支持的枚举值；须独立存储或严格的新协议分支。

## 2. 最小字段合同（新协议，不扩大旧 DTO）

建议独立 `attendance-operational-rules-v1`，八个固定键，不开放任意 JSON 插件。企业、组、经负责人核准的个人例外共用严格字段形状。每个字段明确 `inherit / disabled / value`，无省略键、无把 null 当零。所有技术边界在新协议中声明；它们不是推荐管理政策或法律期限。

| 新键 | value 的最小值域／确定语义 | disabled 的语义 |
| --- | --- | --- |
| `allowedChannels` | 非空、去重、规范排序的 `self / location / pin / onsite` 子集；先解析三层选择，再与原通路当前资格相交 | 不施加本目录的额外通路限制，原开关、资格、验证仍全部生效；不是启用所有通路 |
| `locationScope` | 非空的同商户 locationId 集合，建议一次最多25个；企业、组、个人所有生效集合与原授权共同取交集，不采用上层覆盖来扩地点 | 本层不增加地点约束，不能解除别层或原通路约束；解析结果列出全部交集来源 |
| `shiftSource` | `published_selection` 或 `unplanned`；前者允许员工明确选已发布 slot，未选择仍明确记 unselected；后者不把计划关联作新班次依据 | 与 unplanned 的执行效果相同，但保留明确停用来源；不删除已有班次关联 |
| `breakTypes` | `{allowed:[paid\|unpaid…], selection:explicit\|fixed}`；fixed 只允许单项，explicit 由员工明确选。仅复用现有两种事实类型，不虚构午餐／工资类别 | 退回原企业 webBreakPaid 的类型供给，不改原事件；展示为“使用独立企业休息设置”，不是默认 unpaid |
| `correctionWindow` | `{days:0..365}`；补正、补正修订、漏卡及漏卡修订共用本地自然日截止算法。新截止与企业政策截止取较早者，修订继续保留原链的最早根期限限制 | 不增加三层额外期限，仍使用原企业政策；政策缺失仍明确阻断新申请，不等于无限期限 |
| `reviewRouting` | 固定 category 为 correction/missing/leave/work_arrangement；每类 `owner` 或 `{delegateEmployeeId,delegateAuthUserId}`。解析到目标 worker 的有效精确 grant，保存 grantId／generation 等旁证 | 由原负责人处理；不撤销现有 grant、不夺取旧处理者已打开的申请、不自动交接历史任务 |
| `timesheetCycle` | `weekly {weekStartsOn:1..7}`、`fortnightly {anchorDate}`、`monthly` 或 `manual`；以权威 IANA 区域生成完整民事范围，最长31日；不提供工资结算含义 | manual：沿已有明确起止日期工作区，不创建默认周期 |
| `reminders` | 固定三类 `open_session / pending_review / period_due`；每类显式开关及 `{afterMinutes,repeatMinutes,maxOccurrences}`。建议技术边界1..44640分钟、repeatMinutes至少60、maxOccurrences1..10；负责人自行填写，不预填“合理期限” | 不建立新提醒；已保存事件消息、已读状态和原号回执仍可查 |

补充解释：

1. 一般字段逐字段个人→组→企业解析；`locationScope` 是显式安全交集例外，`correctionWindow` 是对独立政策的收紧例外，不能复用通用 first-value-wins 产生扩权。
2. 全部 inherit 且无发布来源是 `unconfigured`，维持当前路径并准确显示；不是“八项默认已启用”。启用新规则的明确批准记录必须存在，规则更新不能偷偷迁移旧独立设置。
3. `reviewRouting` 的 category 是有限业务路由，不是四个新权限。新 correction 路由依赖238正式审批委托链完成；既有补正修订审批仍走其真实 owner 路径，不能借首次补正 grant 自动覆盖修订。
4. 原计划用词是“补正申请窗口”，因此此键含现有同政策的补正／漏卡族，不擅自把已实现的工作安排 retrospectiveDays 和无同类期限的请假改成统一限制。工作安排独立设置应在同页明确显示出处、版本和“不由此键控制”。
5. `timesheetCycle` 是日期选择和到期提示规则，不是自动封账。跨月／DST 均按民事日边界生成；已存在同日期周期继续原 periodId，不另开重叠周期。

## 3. 生效、固定和真实消费点

新台账只保存八字段的草稿、核准发布、撤销未来发布、个人例外核准及使用旁证。沿原 Rules／PersonalRules 的操作者、原因、CAS、原操作号、时区、effectiveOn/effectiveAt 和双身份约束，但不改变旧127／129表的严格规则形状。首包沿现有未来民事日生效，不能把过去日期当新生效点；若后续支持即时生效须明确服务器时刻和仍进行中对象的规则，不改旧发布函数。

每次实际消费保存 `ruleRevision/sourceHash/effectiveAt/worker双身份/groupAssignment版本/各字段来源/原独立配置版本`。发布预览先列出被收紧的方式／地点、可能无可用新开始方式、申请新截止、真实可用审批人和具体日期窗口；陈旧预览不得发布。历史归档不动态追读“今天的有效规则”。

### A. 新开始、班次来源、休息（四字段）

- 四通路服务 `merchantAttendanceSelfScheduleAdoption.server.ts:41`、LocationSchedule.server.ts:51、PinSchedule.server.ts:55、OnsiteSchedule.server.ts:52 是组合规则与排班采用的真实接点；基础无排班接口也须同一 opt-in dispatcher，不能留下可绕过新限制的另一条新开始入口。
- 锁内先验证原身份、通路与地点资格，再选择新规则。fresh clock_in 与新规则旁证／原四阈值绑定／选班次关联同一事务。成功结果新增独立协议，不向旧精确响应混入额外键；关闭新开关直走原成功链。
- `breakTypes` 必须在实际事件 INSERT 前决定 `break_paid`。现有 writer 直接取 settings.web_break_paid，单纯外包 wrapper、保存候选或事后改标签不能交付此项。需要窄的新 writer／受控私有 helper，把类型作为严格新命令与同事务旁证验证，四通路均消费；不得临时 UPDATE 企业 setting、篡改事件或放宽 append-only trigger。
- 一个新班次固定其开始时规则；规则更新不改变进行中班次的休息政策。既有无新旁证班次继续原规则。break_end、clock_out、定位 safeFinish、同身份暂停补尾及原号恢复不因新方法／地点限制被挡；也不借“收尾”跳过旧身份、序列、状态、凭证或实际结束地点检查。
- `unplanned`／没有已发布班次只影响关联依据，不拒绝保留真实工作，不生成迟到／缺勤。已核准迟早规则及旧采用记录原文不变。

### B. 申请窗口与审批路由（两字段）

- 新提交接点为 correction self v3（`merchantAttendanceCorrection.server.ts:13`）、revision self v1（094 SQL259起）、missing v1（`merchantAttendanceMissing.server.ts:12`）；补正／漏卡修订也要用相同规则，不能只覆盖首次申请。
- 新 request 绑定三层期限及原政策、最终截止。旧已提交申请、撤回、审批、恢复继续原保存依据，不因新政策重新判逾期。091／094／096等旧成功审批不能只在前端换期限；若旧审查 helper需要新绑定分支，用精确前向新 helper，旧分支原样保留，原号旧命令照原协议恢复。
- 申请提交时保存负责人／指定委托人的处理路由；实际 approve/reject 仍走各自真实 owner／delegate RPC，以当前 role、精确 grant、地点、双方双身份、暂停代际及当前 evidence/CAS 重新授权。选中了人但没有可用 grant，配置预览和待审任务都显示不可用，不暗发授权、不自动换人。
- 撤权／人员变更后的接手由 Q4 的明确 handover 动作保存旧处理者、新处理者、原因、操作者及权限复核。旧通知不改 recipient、不把旧正文转发给新接手者；它与 C15 接手共用一次实现，不为规则目录另造第二条交接系统。

### C. 周期与提醒（两字段）

- 新周期选择器输出既有V2的 fromDate/throughDate，首次显式 preview/send 固定本次 cycle 版本旁证；183的 worker、范围、重叠、源指纹、员工确认、版本、64 MiB预算全部不变。人工修改日期必须明示 manual，而非谎称仍匹配该自动周期；已保存周期详情／重开／导出只用保存范围。
- 提醒不是页面重新打开时自动补发。新增单独、默认关闭的服务端有界到期任务：按 next_due_at 索引和游标每批最多25个来源，不扫全商户历史；只接启用后新建立的提醒计划，无历史批量补发。
- 三类源各自固定来源版本：进行中 startEventId、待审 requestId+revision+处理路由、明确周期范围+cycle版本。open_session 可复用已固定的 openSpanWarningMinutes，但旧阈值本身不自动开启提醒；来源关闭／已处理／已发送或资格失效时停止对应提醒。
- 只写站内专用提醒条目；同商户、收件真实身份、来源版本、提醒次数唯一，按收件人与类别合并。同一到期轮次重试只得同一回执，按数据库原子频控避免并发重复；不依赖前端计时，不把浏览器页签在线视作交付。
- 实际收件者为当时合法本人或已固定且仍合格的处理路由；失效时留“待负责人明确接手”状态，不擅自转投当前新 owner／另一个 delegate。每个提醒只有最小跳转标识，到审批页仍 fresh GET 授权，不带申请正文、不自动审批。

## 4. 有限实施顺序与验收终点

建议五个有限交付包，以下不是五轮旧矩阵重复运行：

1. **八字段配置／解析／核准台账**：八键 strict DTO；一名合成人员的企业、组、个人来源及未来生效；地点交集和窗口收紧例外；未核准不生效；旧四字段发布／快照／已核准计划完全不动。只有此包通过不能标 C07 完成。
2. **四字段 clock 消费**：同一小场景验证新 clock_in 的通路与地点确实受限、选班／无计划不伪造出勤、两类 break_start 的真实事件与计时、规则改后仍能正常 break_end／clock_out；四通路各做一条真实最小调用，PIN拒绝后的凭证消费沿旧合同。这里不重复旧迟到／早退全矩阵。
3. **窗口＋路由**：一个未来规则收紧案例覆盖补正／补正修订／漏卡族真实提交截止；一个指定有效 grant 的真实审批及一次撤权后明确接手。旧申请按原保存版本处理、恢复只查原号；配置本身不能审批或扩权。
4. **周期**：周／双周／月各一条纯日期生成，含一个DST边界；一个真实新周期固定规则并沿现V2发送、员工确认、归档；改规则后旧同 periodId 仍用原范围、固定版本原文不改。无需再复制已完成C19续办／配额矩阵。
5. **提醒**：三类新来源各一次真实到期站内条目；一个同轮重试＋两并发触发仅一条、一个合并限频边界、一个处理后停止、一个授权失效待明确接手。无历史补发、无邮件／推送、无自动审批。

每包只用既有 owned 合成环境与当前批准范围，检查相应原始行、旧归档、函数／权限保护和回滚／清理；不是为了“更多组合”继续扩大测试。真实员工试点、生产定时任务启用及实际管理参数选择仍另行配置验证；它们不能替代本地缺失消费代码，也不影响这里八项有限功能终点。

C07 收口条件：八字段均能显示精确来源、经明确核准生效、在上述真实消费点产生可核对效果并保留使用版本，旧路径与正常收尾不被改变。仅有配置表、候选预览、角色名、UI标签或测试模型一律不算执行链完成。

## 5. 201 提醒 SOURCE 冻结（不是实际发送验收）

2026-10-08：新增 `202610080201_merchant_attendance_reminders.sql`，SHA256 `1E61908CB726BE7B3F88FC956E38964122776EFDF7FC755E26A36DDD3D3DCED9`。本节记录本地源码和轻量检查，不表示已安装、已上线、已运行任务或已有真实员工提醒。

- 五张独立私有表为 plans／heads／events／batches／operations；十八个新函数，仅 `faolla_attendance_reminders_v1(jsonb,uuid,jsonb,boolean)` 与 `faolla_attendance_reminders_run_v1(jsonb,boolean)` 授予 service_role。七个索引含到期、收件人、首次已读、同源／同计划发送次数唯一索引，以及回执事件的有界证明索引。
- 唯一已有函数 body 前向变更是当前200的 consumer activation 两处 allowlist 加入 reminders；精确旧／新 SHA 为 `47c615dc8b28428b158efd3ea31bb551335bc95ba10ffd70555358f702a7877c`／`cc1997523546034ef0c6fc4d94a1adce530275871ef6ac7f01f7271f5c066a7e`，保留 OID／原 ACL／默认值和其他元数据。169／188消息、正文、recipient、原已读状态、Auth 和原成功 writer 不改。
- 新源注册只挂193真实 session INSERT、198真实责任 head INSERT／UPDATE、200真实 intent accept／cancel／link（后者 deferred）。不扫描已有来源，不补造工时或历史发布。注册与源动作同事务，证明失败全部回滚。
- 每个计划保存实际源、规则快照、双身份、明确收件路由、activation revision 和完整指纹。待审明确接手沿同 request＋submittedRevision 的预算，继承实际已发次数／最后发送时间，不因换负责人清零；失权先进入 handover_needed，不自动授 grant 或转投新 owner。
- run 仅取 `(merchant_id,next_due_at,plan_id)` 索引上的25＋1个当前 active 来源；原号回执与完整 command SHA 绑定。continuation 仅接受上次实际保存 cursor，保留 cutoff，位置严格前进。以实际数据库时间按 UTC 整小时、真实收件人和类别保存不可变摘要；已有该小时摘要的来源延后，不消耗次数，不修改旧摘要。
- heads 每次变更必须有同事务不可变 event，deferred proof 校对原／新 head、预算、原 plan、摘要条目和 run operation；未知来源整批 failclosed。PK／FK／CHECK、列、索引、触发器、RLS、函数 body／metadata／ACL 在安装和重入均精确校验，不“修复”未知漂移。
- SQL consumer activation 是注册与永久停止的权威开关；deactivation／revision 变化使旧计划停止，后来仅开启环境变量不复活或回填旧计划。Node 环境开关／精确 site allowlist 默认关闭，只阻止新的 run／mark／runner，不假称环境变量可直接阻止数据库触发器注册：SQL consumer 仍激活而暂关 runner 期间已合法注册的计划会保留待处理。需要停止新注册时必须明确停用 SQL consumer。
- Auth RPC 只有本人／真实当前收件路由读取、明确 owner 检查到期和 mark_read；system 域仅服务端独立 runner 常量，无浏览器 system 标识、伪 owner 或公开 system 路由。原号 GET 仅最小 receipt／null；列表25条，8KiB请求／128KiB响应。每条公开目标只有最小标识，实际审批／查看仍经原业务 fresh Auth／scope GET，不授审批权、不自动 send／confirm／seal。

Auth mark 在 settings 锁等待后、任何当前 recipient／allow gate 之前，重新查原 operation 并完整核 actor／command／SHA；若等待期间原 mark 已提交，只返回原最小回执，不因后来旗标关闭而误判失败。新编号／不同 actor／改写 command 仍保持原 gate／冲突规则。这是201自有新 RPC 的恢复顺序修正，不改旧 writer。

`merchant-attendance-reminder-installation.test.mjs` 十三个 SOURCE 测试通过，机械渲染检查和定向 ESLint 通过；另有严格 DTO 十九个纯测试、Node adapter 二十个 mock 测试。它们不能证明 PostgreSQL 安装、并发锁、真实到期发送、真实 Auth、浏览器、生产定时任务或硬件打卡。下一步仍为同 owned context 的有限八组实际验收、最小站内入口及无生产调度的本地接线；不得据此将 C07／C15 标记为完成。

201 native 源码计划只复用父 owned 集群，新的合成 site `99990201` 及全部固定 UUID 先查不存在。八组预测78次实际 RPC／176次业务 SQL，硬上限120 RPC／180 SQL／120秒／3连接；安装、catalog、全部旧行／函数 OID／ACL／两份 archive 证明另限64次调度。一次最多真实等待60秒，不能声称已实测 repeat60分钟到期；一个明确披露、实际私有191规范重验的历史 SOURCE 模板不能声称真实历史 publish。仅初始新site源／activation获准微提交供两场真实 PID 锁竞争，其余案例必须先全部回滚至初始源保存点。第二场并发由 distinct-op run/run 替换为同号 mark/mark（waiter allow=false），以复现上述原号锁后恢复风险；不同编号同小时 run 并发不在本包实际声称范围。跨 UTC 小时依法形成新摘要，不假改时间或额外等待。父 finally 必须清理并确认 owned PG 停止，方可称实际验收完成。
