# C15-A：明确日历豁免与有限出勤分类合同草案

日期：2026-10-08。状态：已开始协议与私有采源实现，尚无本包完整迁移、产品接线或运行验收；不是已经上线的功能。

依据：用户已在237对有限缺口Q4回复“继续”。本包落实该边界，不追加工资规则、历史重算、自动审批或外部通知；不把原计划全部异常类型压缩成下面几类后宣称全部P1完成。

## 1. 已有能力与确定缺口

| 已核代码接点 | 现状与本包边界 |
| --- | --- |
| [有限缺口C15-A](employee-attendance-finite-completion-gaps-20261008.md#c15-a日历影响与完整日计划异常分类)、[原计划§10—12](employee-attendance-plan-20260929.md) | 要区分未工作、漏记录、未关联与资料不足；关联子集不能代表全天。原计划271—275另列定位、设备序号、离线等问题，本包不重新制造这些事实或另设处罚规则。 |
| [123日历](../scripts/supabase-migrations/202610030123_merchant_attendance_calendar.sql)，`faolla_attendance_calendar_summary_v1`、`faolla_attendance_calendar_v1` | `holiday/closure`、企业或地点范围、保存时区/日期、创建与撤销原号已有；创建日历本身不是出勤豁免。29—46行保存时区、日期和两步不可变操作，240—248行列表仍按保存日期标签。 |
| [159来源](../scripts/supabase-migrations/202610060159_merchant_attendance_work_arrangement_exceptions.sql)155—177行 | 同时收集企业日历和**原排班地点**日历，核原操作，按每条保存IANA转换`fromAt/toAt`，不是当前默认地点；101条探针后明确不足，不偷截前100条。 |
| [173正式来源](../scripts/supabase-migrations/202610060173_merchant_attendance_plan_posthoc_formal_source.sql)139行、[PosthocEvaluation](../src/lib/merchantAttendancePlanPosthocEvaluation.ts)139及191—201行 | 任一有效日历仍是`calendar_entry`阻断；可计算项仍为late/early。获批请假边缘、整段请假不适用已完成，不属于本包缺项。 |
| [174处理](../scripts/supabase-migrations/202610060174_merchant_attendance_plan_posthoc_reviews.sql)130—153、449—518、567—598行；[TS合同](../src/lib/merchantAttendancePlanExceptionContract.ts) | 现有五outcome和三种证据policy均有严格含义；来源SHA＋revision CAS、本人note/ack、原号恢复已存在。`not_applicable`特指获批整段请假；不能把停业日伪装成请假或放宽旧`excused`。 |
| [当前工作区](../src/components/enterprise/MerchantAttendancePlanExceptionWorkspace.tsx)149、239—248、279行 | 已明确日历/安排不自动减免、已读不等于同意、未关联不等于缺勤；本人看保存决定，不冒称重新核查当前来源。 |

因此建议新增独立“出勤情况核查”，复用可信来源及生命周期模式，**不替换174的决定writer或旧late/early算法**。它产生可由本人查看、提出异议的明确行政判断，不产生新工时，也不将已有迟到结论静默改写为免除。

## 2. 首版范围：一类日历、一个完整日发现范围、逐目标判断

只选`closure`（负责人登记的停业事项）。`holiday`不自动带入法定休假、工资或出勤义务含义。

- 负责人通过既有可信人员目录选择worker和一个本地日期。日期使用服务器返回的IANA及真实UTC日边界；不由浏览器猜DST，不接受用户输入UTC边界。
- 一次发现必须包含与该日真实相交的全部已发布/已取消计划、原始及核定记录、未关联记录、获批整段漏卡和待审来源；不只读某计划的已关联子集。
- 界面以“本日来源清单＋各计划＋计划外记录”呈现。全天仅汇总数量/未处理问题，不生成“全天正常/旷工/零工时”标记。
- 保存对象是`day`或单个真实`plan`：`day`表示整日资料核查，`plan`表示该排班的**完整保存UTC区间**。跨午夜计划不能只用这一天的裁剪片段作结论；选择计划后再读取其完整来源。
- 无计划的日期仍可核查记录或说明；“没有正式计划”不得推导没有工作义务/工作事实，也不能生成迟到、早退或旷工判断。

### 停业豁免的精确含义

负责人明确选择一条当前有效、已严格核验的`closure`原号，只有以下条件全部满足才能保存`calendar_exempt`：

1. 目标为未取消的真实已发布计划，保存的worker/employee/Auth与计划发布及来源相符；负责人不是该目标本人。
2. 日历属于同商户，范围为企业级，或恰好是**该计划保存地点**。不使用worker当前默认地点，不允许另一地点日历。
3. 日历保存时区的区间为`[fromDate本地日界, throughDate次日本地日界)`；完整覆盖计划`[startAt,endAt)`。相交、同日期标签、部分覆盖、多条拼接都不足以满足本版条件。
4. 当前来源完整、计划已结束；没有待审补正/再次修订/漏卡/请假/安排、未解决故障或无法证明的身份。存在多条日历时完整展示；本版不排序推定优先级，选择的一条必须独立满足完整覆盖。
5. 新决定记录所选`entryId/operationId/revision`、范围、理由和完整来源指纹。确认文案明确“仅本计划的应到要求因该停业事项豁免，不抵消实际工作、休息、工资或其他异常”。

已有真实工作并不因此消失：可以同时显示`recorded_work`和停业豁免，必须展示“停业期间存在记录”；本包不据此扣掉记录或撤销其他处理。开放记录、相互矛盾记录仍须原路径核对，不能被豁免按钮清掉。日历撤销/新增实际来源后，旧豁免保留原文并标记需重核，不批量改旧判断。

## 3. 有限分类：机器观察与人工决定分开

机器观察是固定顺序、可并存的标签，不是违规结论。先完整性，再事实与归属；没有一条“未发现问题”可以充当全天正常证明。

| 观察标签 | 确定输入 | 唯一可声称的输出/后续 |
| --- | --- | --- |
| `evidence_insufficient` | 超界/资料截断、不能证明历史身份、来源失效，或目标尚未结束 | 资料不足，待核对；禁止豁免和实质性确认。鉴权失败仍直接拒绝，不能包装成可见资料。 |
| `pending_source` | 适用来源有真实尚待决定的申请/修订，或故障尚未解决 | 等待原流程；不把申请时段计成已核定工作。 |
| `open_record` | 原始实际working/break链无真实终止/获准闭合事实 | 记录未闭合，不能认定漏下班成立，更不能补造clock_out。 |
| `source_conflict` | 已验证的记录互相重叠/矛盾，或工作与获批请假等存在真实冲突 | 指明相冲突的来源，继续核查，不任选一条求“正常”。 |
| `unassociated_record` | 本日/计划区间内有事实，但没有可信计划关联或明确采用 | 记录存在但归属未核定；不是未出勤，也不是已经证明“未排班工作”。导航既有采用/核查流程。 |
| `no_record` | 已结束范围、完整适用来源，无原始/核定/获批漏卡事实 | 未发现记录，待本人说明；**不输出未工作、旷工或零工时**。 |
| `recorded_work` | 至少一条完整可信原始/核定/获批漏卡事实 | 已有记录；保留原始/核定来源身份及真实端点，不能说明计划或全天全部正常。 |

已取消计划、无正式计划、适用日历及获批工作安排作为独立背景展示，不能改变上述标签的证据要求。工作安排不产生工时。旧late/early、定位核查、设备/离线等结果以已有来源链接展示，不在此重算。

人工决定仅四种：

- `follow_up`：继续核查。包括`no_record`的首次保存；没有数据也不能选择“未工作”。
- `calendar_exempt`：严格满足§2，仅作用于所选完整计划的应到要求。
- `not_worked_reported`：本人在一条已保存决定后，真实提交结构化`claim:'not_worked'`说明；必须是同case/固定范围内最新的本人说明，且之后没有新的异议或相反说明。负责人重新取得完整来源，确认范围内仍无相反工作事实、无待审来源并明确引用该说明原号。显示“据本人说明，经负责人核对为未工作”，不是旷工/工资判断；只有owner口头描述或选择被后来说明替代的旧原号不满足前提。
- `recorded_work_reviewed`：来源完整、已结束，无开放/冲突/待审/未关联项，负责人明确核对已有事实；显示“这些记录已核对”，不是全天正常，也不改旧late/early结论。

本人说明的`claim`只允许`worked_missing_records | not_worked | uncertain`；另可对任一保存决定提交明确`dispute`。前者第一类仍为“本人报告可能漏记，待原补正/漏卡流程”，绝不创建工时。沉默、已读或旧说明不视为认可新决定。

## 4. 来源快照、CAS和保存数据

建议新两表：不可变case frame＋只追加decision/self-statement/dispute entries。不复用147表上的严格outcome约束，不扩169/188通知类别，不增提醒/后台任务。第一版不新增已读账本；“本人打开”不写任何状态。

case固定`siteId, workerId, employeeId, employeeAuthUserId, kind:day|plan, workDate, timeZone, fromAt, toAt, slotId|null`和创建时间。计划frame取原发布；日frame首次读取由服务端确定。每个版本保存actor、operationId、精确command及其SHA、理由、依据原号、服务器UTC6时间。决定还保存严格版本化证据、实际canonical来源文本及UTF8 SHA；私有正文最多1MiB，过限明确失败，不截断。本人可见的是固定公开投影，不下发原Auth集合、私有来源文本或GPS原值。

建议最小独立API `/api/merchant-enterprise/attendance/day-reviews`，service-only新RPC；命名待实施冻结，不提前占迁移号。

- owner显式`candidates(workerId,workDate)`发现完整范围；`preview(workerId,workDate,slotId|null)`读取一个目标的新依据。
- owner/self显式`list`读取已保存case，每页25＋1、`openedAt/caseId`降序keyset；self由真实Auth解析保存目标身份，不必知道case UUID，也不依赖尚未实现的通知入口。
- owner/self `detail(caseId)`、`history(caseId,beforeRevision|null)`只读保存记录；owner detail可另显式核验当前来源。历史25＋1降序keyset，不能读全部历史后截取。
- `recover(operationId)`只读原号；不得借它返回当前来源/所有员工资料。
- owner `decide`携带精确目标、目标双身份、`expectedRevision`、`expectedFingerprint`、outcome、所需calendar/self-statement原号和理由。没有“客户端自填分类结果/快照”入口。
- self `explain/dispute`携带当前`expectedRevision`和所见`decisionOperationId`；explain再带上述固定claim。本人不能替自己作owner决定。

保存按既有稳定锁序`merchant SHARE → settings UPDATE → worker UPDATE → employee SHARE → 新case`，核实实际身份/当前资格；同一事务重取完整source、比较fingerprint和head再只追加。日历、补正/漏卡、批准/撤销等已持settings序列化的原writer继续使用原锁，不另改它们。原始打卡仍可能在读取后新增：决定表示保存时已核验的快照，后续显式核验须准确返回`sourceChanged`，不得承诺一个永久“当前有效”状态。

本人新说明/异议使case head前进，旧决定保留并显示`needsResponse`；下次owner决定必须含新head及当前source。来源改变使`sourceChanged=true`，只新建决定版本，不自动修改、自动撤销、追溯重算原决定。GET、历史查看、日历变更本身都零本包写入。

客户端先持久化精确query/command/actor/摘要，再唯一POST。丢响应、超时、损坏正文、GET未找到、刷新/关闭均保留原号；仅GET取得匹配原actor、operationId、command SHA的最小receipt后CAS清理。不得根据动态detail清原号，不自动重POST；原号异体/异actor冲突零写。

## 5. 真正可复用的接点与不能假复用的地方

1. 完整日发现以[179 `faolla_attendance_period_closure_source_v1`](../scripts/supabase-migrations/202610070179_merchant_attendance_outage_periods.sql)的真实owner、单日、`periodId:null`来源为现成基础：检查`complete`、canonical文本及SHA。其base收全原始/核定、原计划归属、pending、calendar、reviews，wrapper补工作安排和故障；不用128公开摘要补历史Auth，不以UI的一个列表页冒充全日。
2. 179的入口遇不到保存period时回退当前日界；它**不能**替一个新的日核查case自动固定历史frame。新source适配层需从本包case取已存日界，并只在私有内部复用155固定frame报表/对应有界上下文收集。不得临时创建period、伪造periodId、改会话时区或让浏览器提交frame。第一次current-day发现可直接复用；保存后重新核验须验证固定frame分支，不能声称无代码即可复用。
3. 跨日plan详情另用[173正式来源](../src/lib/merchantAttendancePlanPosthocFormalSource.server.ts)`projectPlanPosthocFormalSource`及159完整slot来源，逐目标一次，不对日内100个计划逐一收集100份大正文。日发现只列身份和范围，保存前才核目标完整区间。
4. 既有来源遇too_large、身份不能证明或真实冲突会直接抛错，不保证返回一个`eligible:false`DTO。新适配层只能把有限、明确的完整性错误转成**无部分正文**的`evidence_insufficient`/冲突说明；权限/站点错误仍拒绝，数据库内部错误仍unavailable，绝不能把catch(any)当完整空日。第一版这种失败只显示待核对，不允许保存实质性结论。
5. 保存来源各集合沿现有硬界：最多100 session，且报表session＋获批missing合计最多100；适用context或plan各自沿原100条界，单session2002事件/全日4000事件，采用关联最多10；101/2003探针失败不作为空集合。页面25条导航不能改变source集合完整性。不能假定公开report中的employeeId:null是历史身份，必须由私有证明链完成核验。
6. [174](../scripts/supabase-migrations/202610060174_merchant_attendance_plan_posthoc_reviews.sql)提供精确receipt先于current-source、head CAS、saved self投影、本人note定位最新决定的模式；仅借模式，不调用旧decide保存新枚举，不把self请求伪装owner去采源。
7. 旧149/175/179/183/186/187周期source及归档合同**不纳入新case**。新判断不消除旧period blockers，不自动reopen或解除sealed。界面并列说明“独立出勤判断；旧异常/周期状态未改变”。若未来让其参与周期结案，必须另作明确的向前协议兼容包，本包不隐含该效果。

## 6. 权限与实际页面闭环

新写独立默认关闭＋精确site白名单；不从240规则草稿/已核准账本推导本包已启用。现任真实owner才能发现当前全日、作决定；不授予现有delegate新权限。本人只能读取保存给自己双身份的case及提交针对它的说明/异议，不能枚举别人、不能作决定。

借现有入口组织方式：[Admin](../src/components/enterprise/MerchantAttendanceAdminPanel.tsx)188—189/268—278行的日历与异常入口、[SelfPanel](../src/components/enterprise/MerchantAttendanceSelfPanel.tsx)152—155/202—203行本人处理入口。新增独立工作区，旧按钮、旧writer、旧pending key不变；不用新判断替换旧异常文案。可从真实计划/日期选择进入，任何传入target仍需fresh GET核完整身份与保存frame。

换绑/暂停：不把旧case转交worker的新绑定人；新源读取和新决定拒绝身份不符。暂停/失权不创造提交actor继续写的资格，暂停本人不能新提说明／异议；当前合法owner仍可在完整历史来源、双身份和source/head CAS校验后处理暂停／停用目标的行政核查，不恢复该目标的打卡资格、不生成工时。旧真实actor只允许独立最小GET receipt恢复，不能因此取得当前正文；历史正文按保存目标身份和当前授权核验。owner换人不转投旧决定的actor身份，新owner可在正常owner权限下核同商户case并追加新决定，旧actor不能凭旧receipt继续处理。

UI至少具备：明确读取本日、选完整计划、逐来源/固定区间展示、停业选择及理由、继续核查、本人的三种说明/异议、负责人再次新版本处理、每页25条历史、原号GET恢复。无自动GET/POST/重新决定；hide/pagehide/身份或requester变化同步清正文草稿并保留原号，关闭/跨页有dirty/pending guard，确认弹窗前后重新验证scope/草稿/快照。只读旧资料/恢复与新写开关分别处理，不能因关闭新写把原号入口隐藏。

## 7. 有限完整验收终点

以下八组通过即可收口**本C15-A限定包**，不要求全渠道任意组合、更多全年数据或重复228—238已验证业务：

1. 一个真实已发布计划＋真实123 `closure`完整覆盖，owner显式豁免→self保存结果可读→self异议→owner重读并新决定；旧决定/原号永久相同，已读/未读不等于同意。
2. 无记录＋完整来源仅`no_record/follow_up`；本人`worked_missing_records`仍待原申请，无工时；另一案本人`not_worked`后owner明确引用保存，仅行政说明。没有本人说明、存在反向记录时禁止`not_worked_reported`。
3. 真实开放working/break、未关联事实、真实冲突/待审来源各准确显示对应标签；前后原事件、原始/核定合计完全一致；没有伪造clock_out/整段漏卡/采用操作。
4. 企业/正确地点停业可选；异地点、holiday、已撤销、部分覆盖、跨午夜只盖一日、DST边界各拒实质豁免。触及但不相交的半开端点不算覆盖。
5. 一日本身有两计划＋计划外记录，UI与source全部纳入；选其中一个计划不掩盖另一计划或未关联事实。101项/未知历史身份等明确资料不足，不回退完整空日。
6. 快照后真实calendar cancel、新说明、补正/漏卡状态改变、新原始记录分别触发适当source/head失效；并发两决定只有匹配CAS者保存。旧版本与新版本分别可读，不历史重算。
7. 丢POST回复只GET原号；同号异体/异actor、失权/换绑/新写关旗、scope切换晚响应均不误清/不泄正文；原actor最小receipt恢复不依赖当前来源可用。25＋1历史真实分页不漏重。
8. 一个实际父入口owner→self闭环＋390px布局/dirty guard/隐藏换身份，精确记录合成API与真实SQL各自范围；本地native只既有归属隔离schema、有界事务/回滚，完整旧表与旧归档UTF8/SHA/封存状态保护。

不要求本轮给真实账号/硬件下P1最终结论；也不以“尚可再增加组合”阻止这个有限包完成。任何实施中发现不能满足固定frame、完整来源或身份证明的具体阻断，应报告具体缺口，不用弱化完整性/修改旧数据来凑验收。

## 8. 本地实现与验收状态（未收口）

新增 `merchantAttendanceDayReviewContract`：owner 的完整日发现／逐目标预览、owner/self 的25条列表与历史、独立最小原号恢复，以及四种owner决定和本人三种说明／异议。查询按mode精确校验；HTTP游标两个组成部分必须同时出现，拒绝重复／未知字段和非法修订序号；不接受浏览器UTC边界、时区或来源正文。完整非秘密命令以规范标量数组绑定实际actor／目标／修订／依据原号形成SHA；最小receipt只证明该命令原号，不替代当前来源。5项协议测试通过；加既有及本次扩展分类测试共20项通过。全项目非增量TypeScript检查已通过（此后新增的行政结案分类桥接另有定向测试与lint，仍需最后一次全量检查）。

纯分类器现在可明确承载既有195的行政结案旁证：原始／选定endAt仍为null，不补造clock_out或核定时长；已批准行政闭合不误报仍开放，也不把其无下班事件无限延伸至后续真实班次而误判重叠。资料显示待核工时，三个实质性候选都受 `administrative_hours_unassessed` 阻断。该字段仍是调用方元数据，不自行证明真实SQL结案／完整采源或授权。

新增惰性的 `merchant-attendance-day-review-source.mjs`：严格pin当前195后的179完整采源body与wrapper，构造独立DAY私有采源函数正文。它从本包自己的不可变case读取保存UTC边界和双身份；指定case不存在时明确拒绝，不回退当前时区。仅第一次未保存DAY使用服务器当前IANA日界；保留旧有完整日候选、101／2003／11探针、100会话／4000事件／1MiB来源及工作安排／故障／行政结案来源。不会改旧函数，不创建或读取假period，不接收客户端frame，也不把该DAY适配器用于裁剪计划。3项精确源码转换／无旧period依赖／保存frame测试通过、定向lint零警告。

199 SQL 已有完整173 v1/v2/v3计划采源、两表不可变case账本、15个新函数、完整日／完整计划来源规范化、负责人决定、本人说明／异议、独立最小原号恢复、来源指纹及head CAS；原有函数和周期归档协议不改。SQL及严格安装／重入模板目前仅SOURCE检查，尚未实际安装或执行，不能把源码测试计作八组原生通过。下述早期测试状态保留为实施过程，当前验收以本节末尾为准。

补充：已实现严格的保存结果公开投影 `merchantAttendanceDayReviewResult`，含不可变目标、负责人决定、本人说明／异议、待回应head、25条case keyset与连续历史revision分页，以及独立最小receipt。本人只能接收保存给当前Auth的目标，负责人不能作为本人作决定；拒绝跳过中间历史、伪造“已回应”、来源不足却给实质判断等不相容字段。保存时区作为历史标签校验，保留UTC几何，不依赖浏览器当前tzdata重新解释；不下发私有来源或GPS。8项保存协议测试通过。

新增 `merchantAttendanceDayReviewRecovery`：只管理单标签页非秘密待确认命令，先深拷冻结、完整命令SHA及持久化，初始化零网络；已有／损坏／异身份原号不覆盖。唯一清理路径是明确GET原号，严格匹配实际actor／命令SHA／case／revision之后比较原存储字节再删除。404、超时、损坏正文、异回执、动态detail替代、切换身份／隐藏后的晚响应、存储换号均保留原号，不自动POST、重试或以未查到为失败。7项恢复测试通过。

### 当前证据与实际未完成事项

- 传输／页面已接线：真实Auth及同源入口的 `day-reviews` GET/POST、一次RPC server adapter、显式只读Reader、一次POST后仅GET核验的Attempt、惰性Launcher和Workspace；Admin按实际员工入口、SelfPanel本人入口和宿主Auth／离开guard已接通。保存结果9项、恢复7项、Attempt7项、server4项、API6项、Reader6项、真实组件静态渲染4项测试通过。这些是单元／模拟HTTP／SSR证据，不是实际浏览器或真实Auth验收。
- Node私有来源投影9项测试通过：核对旧完整DAY／173 PLAN来源及规范SHA，再独立对照排班、日历、待审事项、工作安排、冲突和current状态；每条DAY原始会话也必须唯一匹配完整计划context内的原始child，防止新外层自洽SHA掩盖来源漏项。包含有效日历及获批请假重叠的正向映射，不仅是拒绝案例。未审故障的原声明operation不在旧DTO内，仍由SQL核对不可变声明账本，不虚构Node已独立证明该原号。记录的排他计划归属及旧compact缺少的地点等字段，由SQL199重采可信context及source CAS证明；Node不声称复制了这些全部业务证明。POST不接收浏览器来源正文。
- 实际旧report允许单会话2002事件／合计4000事件；新来源路径用显式完整来源树profile接通，1002事件合成案例通过。旧归档入口的默认1000数组guard没有全局放宽；27项新旧来源／行政／故障／事后采用回归通过。
- 界面明确展示固定UTC／保存时区、完整计划、原始及选定记录、日历原号、待审／故障、工作安排和冲突；负责人明确理由、依据和确认，本人说明／异议，25条历史和原号GET核验分别操作。初始化不发HTTP，hide/pagehide清正文草稿并保留原号，稳定Auth回调失效也同步撤下正文。下面记录实际有限浏览器结果。
- 本轮全项目非增量TSC实际退出0，随后仅增加界面详情与中文阻断原因，定向10项Reader／SSR及UI lint通过；最终源码冻结后再统一类型复核。不得用较早TSC替代最终变化的证据。
- **已知有限兼容边界**：159/173旧compact session没有195行政结束旁证；若其NULL end把实际已在目标前行政结束的旧班次纳入，199首版整次返回 `attendance_day_review_ineligible`，不伪造完整空来源、不延伸工时、也不保存follow_up见证。DAY已支持195旁证；尚不能称PLAN所有195历史情况通过。
- 尚欠：199一次实际安装／重入及固定八组原生验证、独立竞争与回滚保护；C15-B审批接手和统一提醒不在本包。C15和总体固定台账仍是部分完成，未部署、未触碰生产数据、未建立真实试点账号。

本轮分类／DayReview全族及API共73项定向测试串行通过（4.00秒）；它们仍按上面证据类别区分，不替代真实SQL／浏览器终点。

### 实际有限浏览器验收

`attendance-day-review-browser.mjs`第二次实际运行8组全部通过，6.762秒，34次API（31 GET／3 POST）、37次HTTP，390px无横向溢出，外部请求0、磁盘bundle0。使用真实Admin／SelfPanel父组件和Launcher／Workspace；身份、API数据和25＋1历史均为明确合成夹具，`actualAuth:false / actualSql:false`。覆盖负责人取消、一次POST丢响应、关闭新写后null／异回执保留及原actor GET精确清理、保存caseId重读、本人说明／异议、隐藏／换身份／晚POST保留原号、晚GET requester隔离及稳定Auth回调失效清正文。finally已断言browser关闭、owned listener停止。

首轮在第6组因夹具的非唯一label选择器停止，前5组实际通过；修正为唯一combobox role后才执行上述完整第二轮，产品未因夹具问题改动。浏览器通过不替代尚未执行的199 SQL业务验收。
