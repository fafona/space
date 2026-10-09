# C07：其余四字段实际消费合同草案

2026-10-08。状态：**只读调查后的实施草案，尚未冻结 SQL／HTTP exact wire**。承接已批准 Q4；没有重新申请同一业务范围，也不把设计计为交付。本次仅新增本文。193 由主线程统一原生验证，本文不修改193、旧 SQL、业务组件或环境。

依据：[剩余八字段边界](employee-attendance-remaining-rules-boundary-20261008.md)、[239值合同](employee-attendance-operational-rules-contract-20261008.md)、[191核准台账§8](employee-attendance-operational-rule-ledger-contract-20261008.md)、[192来源合同](employee-attendance-operational-rule-source-draft-20261008.md)、[242打卡消费](employee-attendance-operational-punch-consumer-boundary-20261008.md)、[C15-B接手／提醒§7](employee-attendance-review-handover-reminder-boundary-20261008.md)。这里仅补 `correctionWindow / reviewRouting / timesheetCycle / reminders`，不重做四通路、周期分页配额或旧通知矩阵。

## 1. 真实入口与不能省掉的接点

| 字段 | 现有实际实现 | 有限新增效果／必要接点 |
| --- | --- | --- |
| correctionWindow | 085 `faolla_attendance_correction_rules_v1`，40–61行：084独立政策、保存时区与本地日截止；086:192 `correction_self_v3`只是装饰085 self_v2。095:34 `revision_self_v2`才是当前再次修订服务入口，095:327仍保留self_v1。103:97 missing_v1同时处理submit/revise，221–227行保留根期限 | 四条可执行提交入口都必须守新期限；不是只改首次补正 UI。085内部共同包装层可负责首次补正，095两版及103各保留原成功逻辑 |
| reviewRouting | 189首次补正、160漏卡、162请假／工作安排分别有真实授权与决定；164:184–194包装旧grant usable并核双方epoch；189:183自身核当前双方身份、角色、代次、地点与期限 | 新提交只固定办理路由与授权观察。配置值不产生grant、不代替当前审批资格、不把再次修订冒充首次补正 |
| timesheetCycle | `merchantAttendanceOperationalCycle.ts:1–108`仅纯候选；V2.server.ts:50–72先恢复原号再真实source投影；183:671 closure_v2和187:63 delegated_closure_v1已有实际send | 真正读取192后明确采用完整民事日期；新周期首次send固定采用旁证。旧periodId／范围和所有旧artifact字节不改 |
| reminders | 125原请假消息；169:164/239事件通知；188:196/219/240员工说明／周期争议通知均为特定事件捕获；没有本合同的next_due_at到期引擎 | 一套三类计划、到期检查、站内合并、标读和原号恢复；C15-B的handover_needed是pending_review子原因，不能另建平行消息系统 |

客户端接点分别是 `merchantAttendanceCorrection.server.ts:13`、`merchantAttendanceRevisionCycle.server.ts:17`、兼容 `merchantAttendanceRevision.server.ts:11`、`merchantAttendanceMissing.server.ts:12`；原始 pending key／旧格式必须仍可恢复。请假当前服务选择125 notify包装，工作安排选择169 event包装；新提交接线不能绕过这些包装中原来已启用的捕获功能。

## 2. 共同原则、启用与保存依据

### 2.1 身份与启用

- 192入口只供受保护内部调用。外部prepare必须先沿原业务验证真实Auth、商户、worker、employee、employeeAuth；不能把知道worker UUID当读取全来源的授权。
- 192当前来源用于**新动作**。已保存请求／周期的显示、审批、撤回、重开、导出和原号恢复只读其固定旁证；不得因今天的暂停／换绑重采并改写历史身份。
- 采用191三层优先级及239值语义。继承／disabled按各字段既定语义回到原行为，不把disabled解释为禁止员工正常提交或收尾。无独立084政策仍不能新提交补正／漏卡。
- 193 activation明示只管四打卡字段，不能扩大其旧记录的含义来启用本四字段。建议一个独立、共用的消费activation账本，key为`(siteId, consumer)`，consumer严格为`application_window / review_routing / timesheet_cycle / reminders`；默认没有记录即off，owner明确activate/deactivate、CAS、原因和最小原号恢复。它不是四套设置表，也不改变settings旧DTO。
- 上述activation是本草案的部署安全建议，需实施前统一冻结。不得仅用浏览器开关或HTTP开关声称数据库已防绕过；也不得安装后自动消费以前仅作为候选保存的发布。

### 2.2 共同固定旁证（内部，非通用浏览器授权令牌）

建议四消费者共用私有校验器及固定数组哈希规范，但使用各自严格带版本的body，而非任意JSON：

```ts
ConsumerSourceRef = {
  protocol: 'attendance-operational-consumer-source-v1',
  consumer, siteId,
  workerIdentity: { workerId, employeeId, employeeAuthUserId, workerVersion, employeeVersion },
  observedAt, activationRevision,
  settingsRef, groupAssignment,
  layers: { enterprise: null | {operationId, revision}, group: null | {operationId, revision}, personal: null | {operationId, revision} },
  baselineCorrectionPolicy: null | {operationId, revision},
  sourceFingerprint, consumerFingerprint
}
```

这是待冻结的字段提案，不是允许宽松接受的正式DTO。完整192 source只在真实授权服务内校验；保存compact引用，按三条immutable191 publish点和一条084政策点恢复，不扫描发布历史、不复制申请正文。sourceFingerprint保留原observedAt；prepare/POST CAS另算consumerFingerprint，可排除**本次读取时间**，但不能排除保存身份、实际有效发布、group assignment、settings／baseline版本或activation revision。客户端和SQL都用固定递归scalar-array tuple重算，不依赖对象键顺序。

收到请求先点查原操作号＋原actor＋完整命令，命中则返回已保存最小回执，不重新采规则。只有确认原号不存在后才锁内采源／核有效期。未知、null、坏回复、scope失效都保留原槽，不自动重发POST。原号冲突不能伪装成“新规则不允许”。

## 3. 申请窗口：最小真实接线

### 3.1 算法与旧资料

1. 首次补正anchor沿085保存原始start事件在**本次独立084政策时区**的民事日；补正修订沿091 `revision_rules_v1:30–57`的原始basis起点，不改成当前修订提议的起点。
2. 漏卡submit沿103的新proposal起点；漏卡revise仍取新proposal与最初根proposal的既有较早截止。
3. 三层选择value时，`effectiveDays=min(baselineDays, selectedDays)`；其他状态没有额外收紧。截止仍是`control_day_boundary(anchor + days + 1, baseline.timeZone)`，提交时刻`>= deadline`拒绝。0天不是null，不用24小时加法替代民事日。
4. 修订还取已保存根消费旁证的截止下界；新规则变宽不能延长已固定根上限。旧根没有新旁证时仅沿原根逻辑，不回填新规则。点读根request／proof即可，不扫描整条修订史。
5. 新提交固定`baselineDeadlineAt / operationalDeadlineAt|null / rootDeadlineAt|null / effectiveDeadlineAt`及源引用。085的旧rules、103旧deadline字段保持原意义；新外层明确展示额外收紧截止，不把旧baseline字段改名冒充新截止。审批不再按当前时间或当前规则判断该次提交是否逾期。

### 3.2 SQL／服务 ABI 候选

新增私有 `faolla_attendance_operational_application_window_v1(site, worker, employee, auth, family, anchor_basis, proposal, root_ref, locked_at)`，只返回严格窗口证明；无表写、无单独service权限。family严格区分`correction / correction_revision / missing / missing_revision`，不能扩到leave或work_arrangement.retrospectiveDays。

新增三类版本化service RPC包装（correction、revision、missing），参数保持原业务query/auth并增加外层`p_intent`：

```ts
FreshIntent = { command: OldExactCommand, expectedConsumerFingerprint: string }
Result = { protocol: 'attendance-operational-application-v1', family,
  application: OldStrictResult, preparation: WindowPreparation|null, receipt: ConsumerReceipt|null }
```

新旁证同事务绑定旧submit operation及旧完整command；旧原字段不追加未知键。withdraw仍沿旧command，没有强制新预览。新历史GET显示保存proof；prepare才显示当前候选。新proof故障必须连同旧request／entry回滚。

必须前向改造的旧函数范围：085内部`correction_self_v2`、095 `revision_self_v1`和`revision_self_v2`、103 `missing_v1`。建议提取有来源hash／signature／ACL安装守卫的私有共同core，旧wrapper传legacy-null，新wrapper传已验证intent；activated且fresh submit/revise的legacy-null明确`protocol_required`，**已存原号／withdraw先处理**。086装饰层、旧源basis、决定writer096／095和效果表不复制改写。最终实现时须枚举实际服务授权签名，不仅检查HTTP当前调用者。

新client保留同一site+employee原槽的旧bytes；新格式有判别字段，不能另开并行writer槽。旧pending先用原协议恢复；不能因新版启用丢号或自动重建command。现SelfPanel与相关launcher继续唯一host、原parent leaveGuard、同步Auth/api/scope失效。

## 4. 路由与C15-B：一份责任记录，不是第五种授权

### 4.1 授权核验与有限查找

- correction只含189首次补正approve/reject。再次补正修订保持真实owner路径；新路由不能赋其189权限。
- missing核160＋164，必须保留`enterprise.view + attendance.self.view + attendance.missing.review`及双方epoch；leave/work_arrangement核162＋164，保留对应review权限和kind范围。189只要求其既有`enterprise.view + attendance.correction.review`，不可为了统一而给无self.view主管新增权限。
- 路由值只有delegate双ID，没有grantId。禁止“扫描所有授权取第一条”或把角色名当grant。建议新增必要的目标索引，按完整site／目标双身份／delegate双身份／category定位候选，每页25+1；只对有限候选执行原usable与**实际请求范围**核验。多页未读完不能宣称无grant或唯一grant。
- 最小安全自动绑定规则：有限候选内**唯一**完全可用grant才固定；0条记`unavailable`，多条或sentinel记`needs_explicit_assignment`。不把范围外basis／前后session泄给被指定者；189历史地点、162 kind和includePending、160实际范围都必须验证。
- 配置预览不授予读取grant目录／申请正文的权利。员工提交结果只显示路由状态和必要标签；grant完整scope、双方epoch等内部旁证仅给原业务已授权角色。

### 4.2 提交／接手

建议复用C15-B的责任entries＋head：新申请提交同事务创建初始责任，保存`request family/id/submittedRevision/submittedOperationId`、源引用、desired route、固定recipient真实身份、grantId／generation或明确不可用状态。`owner`固定**提交当时**真实owner，不动态写成今天负责人。

指定主管资格不可用不暗发grant、不自动改投owner；建议保留合法员工事实提交，同时保存明确的`needs_explicit_assignment`，当前owner在独立协调列表中手动处理。此项是待实施冻结的可用性选择：若选择整次拒绝而非保存不可用责任，必须明确给员工可达修正入口，不能形成永久无法提交。

责任不是排他审批锁：其他当前真正合法的owner／delegate仍按096／189／160／162审批；未登记责任的历史申请不制造“原指定者”。新模块只对已登记head提供25+1待协调列表，currentowner显式`register / take_over`沿C15-B保存CAS观察与原因。原grant失权／owner变更后不自动接手、不改旧recipient；接手记录也不保证有权自批。

新提交接点为第3节四类加122 `leave_v1` submit、156 `work_arrangement_v1` submit。只在这些新事实成功写入后同事务保存责任；旧撤回／决定／原号不补登记。125 notify、169 event原包装继续完整调用。无需为了任务路由修改六个原审批writer；到原详情始终fresh GET重新授权。

## 5. 周期：明确日期计划、首次采用、原档兼容

### 5.1 为什么不能只有picker

纯cycle helper已经有周／双周／月和DST民事范围规则，不能再次当完成。还需要实际192来源、明确采用和保存proof。另`period_due`不能在首send之后才创建：当时来源已经送审，应立即停止提醒。因此需要一个有限的**明确待送审周期计划**，不是自动造period，也不是扫员工自动排期。

建议新增独立`cycle_intents`不可变事实及`cycle_intent_operations`（accept/cancel/link，每intent有限生命周期），`period_cycle_adoptions`按period唯一保存首次link。可把accept事实放同一append-only操作表以减少表数，但不能在JSON里伪装任意可修改head。

候选RPC `faolla_attendance_operational_cycle_v1(query, actual_auth, command=null, allow_write=false)`：

- `prepare`精确site、access(owner/self/delegate)、worker完整身份、anchorDate、grantId|null；先沿183／185实际view权限核验，再内部192＋既有纯cycle算法交叉核对。返回完整民事范围、权威settings时区、源指纹；不写表、不算已采用。
- `accept`明确operationId、期望preparation fingerprint、完整日期、目标双身份；锁后重验并保存一个待送审intent。仅允许原有send资格：当前owner，或185精确send grant的delegate。183实际action guard把self限定为confirm/dispute；其`self.request`检查不是送审资格，因此self不能借本包建立或送审计划。仅有view也不许建立别人计划。
- `manual`与规则候选严格区分，人工改日期不仍贴weekly等标签。规则disabled／inherit／manual不默认生成周期。
- `detail/list25/cancel/recover`只给本来有权范围；取消仅未link计划，旧actor失权仅最小原号回执。取消不动已有period。

### 5.2 首send接线与旧成功路径

新外层send intent建议为`{command:OldV2Command, cycleIntentId, expectedCycleIntentFingerprint}`。先原号恢复，再真实179／184源投影，最后与旧183／187 writer在同事务调用；真实archive仍由严格Node投影，不能手造v1/v2或假owner。

第一版最小替换范围是183 `period_closure_v2`和187 `period_delegated_closure_v1`抽取私有有intent core，加上183旧`period_closure_v1`对**已管理cycle intent的新周期创建**防绕过。不能把所有旧manual send强制改成规则周期。所有existing period发送新版本、确认、争议、respond、seal/reopen及export继续保存frame；new managed firstsend的目标范围必须与intent及源proof精确相等。

首次创建原子插入adoption与link；原operation、创建entry/version/artifact/period/triple均一致。sourceFingerprint仍是179工时来源canonical；cycle来源另有独立proof，不把角色／当前规则塞进旧source hash。source相同复用旧body时不能重写其内容；183总64MiB及单body预算不变。

新proof在新detail外层显示或独立GET读取，旧owner/self旧DTO分支不额外加字段；旧artifact_checked／186双分支不宽化。原归档没有cycleproof就显示“未保存此类旁证”，不回填推断。若需让单文件导出也携cycleproof，应另做严格sidecar manifest并单独冻结格式；本包不能悄改旧artifact字节或暗称原档已有该证明。

已有重叠period必须沿183真实查询定位；不能为了匹配新规则建重复周期。选中旧period使用保存fromDate/throughDate，不能用新候选覆盖。独立周期计划与第一次send的消耗关系应唯一，即使两client同时采用／送审也不能重复link。

### 5.3 200 来源投影基础（尚非实际采用）

新增`merchantAttendanceCyclePreparation.ts`，调用既有192来源严格解析及三层解析，再用原cycle helper计算完整民事日期；使用真实来源保存的settings时区，不用发布旧时区或本机时区代替。`preparationFingerprint`固定完整身份、settings／group／publication／baseline引用、activation状态及代次、anchor与完整日期；仅排除本次读取的`source.at`，另保留含该时刻的原`sourceFingerprint`。未启用、未配置、disabled和manual均有不同状态，不生成默认周期。

8项纯测试及两个新文件lint通过，覆盖完整周／双周／月、反向锚点、状态区分、CAS引用变化、微秒读时差、拒绝getter／伪权限字段及异步过程中调用方修改。结果始终`candidateOnly:true / applied:false / authorityChecked:false`；没有SQL、HTTP、实际授权或period写入，不能据此称周期采用完成。200两个有限RPC、原子link及四个精确forward仍在SOURCE实施。首包仅owner／delegate读取私有intent旁证，self继续原period查看、确认／争议，不新增self intent API；当前owner可明确取消未link旧actor计划，但link仍要求原接受actor／access／grant且当前send资格有效。

## 6. 唯一的三类到期提醒核心（与C15-B共用）

### 6.1 新来源与终止条件

| 类型 | 唯一新计划来源／初始时间 | 收件与到期点查 |
| --- | --- | --- |
| open_session | activation后新startEventId；可在193新session成功INSERT同事务捕获，不回填已open旧班次。固定reminders来源及实际occurredAt | 固定当时目标本人双身份；原会话已结束、身份／资格失效则停止。旧openSpan阈值不自动启用提醒 |
| pending_review | 第4节新责任的精确申请版本；起点为submittedAt | 固定当时owner／合法delegate；原请求已决定／撤回停止。grant失效则责任进入待接手，不自动转投他人。handover_needed为同类型子原因 |
| period_due | 第5节显式accept的完整cycle intent；起点为保存时区throughDate下一日权威边界 | 固定有send资格的计划actor；取消／已link且送审／资格失效停止，不自动创建下一周期 |

只针对启用后新来源建立计划，无历史补发／重建。后续有效提醒字段明确disabled或consumer停用可停止旧计划；不能用今天新参数延长／增加旧plan次数。当前source无法验证时fail closed暂停执行，不将其误判成“没有配置”；已发送内容、固定recipient、原发生时间不改。

### 6.2 有界存储与运行

建议统一五类存储：immutable plans、strict-derived due heads、append-only plan events(delivery/stop)、immutable summary batches、operation receipts(含mark_read/run)。不是169／188加宽枚举，也不是为C15-B另建一套batch/item/mark表。具体表合并及exact约束待冻结；每次projection改变都须对应同事务不可变事件，禁止无证据UPDATE。

索引至少`(site,next_due_at,plan_id)`仅active head；同site一次取25+1，处理最多25，用固定keyset和排它锁维护位置。每个source只点读自己的原事实／当前状态，不扫events历史或所有员工。没有可读完整候选时不能把截断当完成。全局调度只遍历明确allowlist最多64site，不能列出全平台商户。

时间按DB锁后clock_timestamp：第n轮理论时间=`anchor + afterMinutes + (n-1)*repeatMinutes`，n为1..maxOccurrences。服务延迟后不补发一串过去提醒：一次最多兑现一轮，后续next_due至少大于本次发送时刻并满足repeatMinutes；实际due/recordedAt及该次ordinal保存，不重写原anchor。唯一约束覆盖`(plan_id,ordinal)`。

合并必须同时保留per-plan频率和固定recipient/category限频。建议统一UTC一小时半开窗（repeatMinutes最小60）作技术合并槽，batch最多25成员、保存后不追加。相同recipient/category已有该窗batch则不重复发送；未纳入的plan不增加occurrence计数，明确defer到后续允许窗，不能丢弃或声称本窗全覆盖。C15-B§3原UTC日窗为旧候选；最终只冻结一种共享合并窗，不并存日窗和小时窗两套幂等。

此合并窗及“延迟不补发”是需主线程在编码前确定的技术语义，不是默认推荐管理期限。maxOccurrences和配置值继续由负责人填写；不暗加合理期限或自动批准判断。

### 6.3 真正自动入口／恢复与通知导航

新增service-only单site有界`run_due` RPC，调用者是显式system身份，不冒owner Auth、不接受浏览器填recipient／dueAt；仅后端已配置的调度路径能调用。增加一个默认off、无import副作用的本地可调用调度runner，使用既有service配置、独立allowlist、单轮上限与唯一run operation，完成一次真实SQL到期调用；不能只测纯模型或人工按钮就宣称自动到期完成。生产cron／服务注册留独立上线门槛，本地不启动常驻进程、不写真实任务或凭据。

owner“现在检查本窗”可以复用同一私有核心，但operation.actorKind明确owner，另存真实Auth；不能复用system伪人。重试原run operation返回固定receipt；同轮并发只一份plan delivery/batch。检查失败整事务不留半份batch／state推进。mark_read是独立操作号、固定首次readAt、零审批／接手副作用。

收件UI为新的严格reminders协议；初挂／scan零HTTP、list25、detail按精确batch、原号GET恢复。既有消息125／169／188不迁移、不修改recipient、不复用它们不含完整原号的旧mark格式。消息只给最小目标，跳原详情必须fresh GET并核保存双身份／原scope；本地pending优先，消息导航不覆盖草稿。失权原actor有独立最小receipt恢复入口。

## 7. 必须精确前向改的成功入口，与可独立新增部分

| 包 | 必要前向接点 | 不应顺手改动 |
| --- | --- | --- |
| 窗口／路由提交 | 085共同包装、095两self提交、103 missing；路由另加122 submit、156 submit。每个函数只fresh成功分支；先保存原号检查，再受保护source与旁证 | 096／095／160／162／189审批权限和决定效果、原政策DTO、所有旧withdraw/replay |
| 周期采用 | 183 owner/self v1/v2和187 delegate firstsend的精确私有intent接点、防已管理计划绕过 | 179／184工时来源算法、149／186旧archive语义、188争议通知、64MiB预算 |
| 提醒来源捕获 | 193新session INSERT接点、第4节新责任、第5节新intent；均仅成功新来源，同事务proof失败不能遗漏计划后假称成功 | 旧event/body、旧open session、既有通知、未启用的legacy提交 |
| 可独立新增 | activation、窗口prepare/外层协议、cycle intent／picker、责任协调、reminder due worker及收件／恢复UI | 不新增自批／资料目录权限，不创建Auth／邮箱，不做薪资、定位追踪、外部消息 |

前向迁移须固定旧body/signature/owner/proconfig/ACL，确切替换并验证重入；旧owner/self/delegate wrapper仍真实actor。不能用GUC宣称内部授权。新共同core不能service直接execute；任何source／sidecar也无客户端表权限。锁序沿原merchant SHARE→settings UPDATE→业务worker／employee／role→原head→新proof/head，实施前逐条核真实core顺序，不能仅凭此表宣称所有旧锁序完全一致。

## 8. 有限实施次序与完成证据

1. **窗口先闭环**：四个真实提交分支各验证一次收紧／根期限，其中一次0天边界；原号恢复无需当前source；旧已提交审批与旧归档不变。只做新关键源变更竞态，不重跑全部补正组合。
2. **路由＋C15-B责任**：四类指定真实grant实际适配；至少首次补正一条真实delegate审批、撤权后明确owner接手、正常另一合法审批者不被责任独占阻挡；不可用／多grant明确状态，不造权限。复用117／229目标导航，不另造待审复制页。
3. **周期采用**：既有cycle纯测试复用；真实source→显式accept→原V2 send/selfconfirm/seal一条完整链，规则后变旧frame／body不变。另一次取消未送审intent证明period_due来源能停止。不重复231容量矩阵。
4. **统一提醒**：三类新source各一次真实到期条目；同轮原号与两个真正竞争事务只一条；一次合并／限频、一次已处理停止、一次资格失效待明确接手。真实本地调度入口有界执行，UI仅核收件→fresh目标与原号恢复，生产调度另列。

这四包均完成才有资格结合前四打卡字段评估C07收口。192来源、239纯解析、191发布、日期picker或本文草案单独均不构成实际消费完成。

主线程已冻结的工程选择：独立共享activation按(site,consumer)默认off；路由不可用仍保留合法提交、唯一grant才绑定；cycle sidecar不改原导出正文；reminder采用UTC小时合并槽、不补发过去串、每批25。194只实施application_window及共享activation，其他消费者留后续包，不混入本次。cycle intent／其余消费者的exact wire仍需在各自实施前冻结。

### 8.1 统一提醒计时基础（仅纯计算）

新增`merchantAttendanceReminderTiming.ts`，供C07三类提醒和C15-B接手子原因共用，不另建第四类提醒。UTC6微秒完整保留；第n次是实际发送次数，不按已经过去的理论轮数补发。下一次时间取“原anchor理论时间”和“上次实际发送＋repeatMinutes”的较晚者；延迟后一次只兑现一轮，达到maxOccurrences立即停止。已有不可变本窗摘要时仅给出下一UTC小时的defer候选，不增加发送次数、不修改旧摘要成员。

8项纯测试及两文件lint通过，含精确到期端点、延迟无补发、单次上限、disabled区别、UTC小时半开边界与DST独立性、Unix纪元前微秒、非法配置／对象、闰日及不可变结果。它不读取数据库、不认证recipient／source、不产生通知或调度任务；数据库锁后时间、每plan／ordinal唯一约束、head旁证与有界runner仍须实际实现，不能据此称自动提醒已完成。
