# C15-B：首次补正办理接手与一种站内合并提醒

2026-10-09当前：198显式接手与201统一三类提醒已达到约定有限本地终点。201实际8组、112 SQL／78 RPC、两场精确PID竞争通过，68.666秒含唯一57.925秒真实等待；父级52项检查／baselineRestored=true及停止通过，不以业务回执的cleanupConfirmed代替外层清理。

三类提醒共用有界账本与server-only单次系统runner，默认关闭；三类来源、小时窗合并限频、25＋1、幂等原号、独立标读、失权后显式接手、原子故障回滚及锁后重核已有实际证据。第7节统一方案替代早期独立manual／UTC日窗候选，不再新增第四账本、常驻进程或重复旧审批矩阵。生产调度／真实认证／手机／发布另列，未实施生产cron或部署。

210精确UTC等价快路径保持原ELSE、OID及完整metadata／ACL；25组对照、8个原子变异探针和父级保护通过。同次受控UTC来源表达式＋约束由1722.984降至61.557毫秒（约96.4%），不是全网站同等提速。既有4组及recipient2组实际组件页面证据保留，Auth／API合成；最新完整TypeScript42923及最终115项定向／共享客户端回归通过；本轮210再验与209完成后，最终父级62项保护检查／baselineRestored=true／停止通过。

## 原合同与历史验收依据（以第7节统一方案和当前结论为准）

2026-10-08。用户已批准[有限缺口清单](employee-attendance-finite-completion-gaps-20261008.md)Q4的“负责人明确确认审批接手、提醒仅站内且合并限频”。以下是实施前历史合同，当时**不是已实现／已验收声明**；不重复询问同一许可。238 UI保持冻结。本次只新增本文，未改产品、数据或启动环境。

## 1. 交付终点及真实缺口

[原计划](employee-attendance-plan-20260929.md)292–293要求失权后的明确接手及限频提醒。首包只覆盖**首次补正**，不夹带再次修订、漏卡、请假、计划异常或周期争议；提醒类型只有`correction_handover_needed`（已登记办理责任需要重新接手），不判断工资、旷工、审批超时或默认批准。

现有边界必须保持：

- [189](../scripts/supabase-migrations/202610080189_merchant_attendance_correction_delegation.sql)182–202的`...delegation_usable_v1`证明当前grant资格；543–557按保存身份、地点、includePending和待审状态筛选。**grant是范围内审批资格，不是逐申请的责任分派**，同一请求可能有多个有效grant。不得扫描所有grant后猜测谁是“原负责人”，也不得声称旧授权已产生交接记录。
- [096](../scripts/supabase-migrations/202610010096_merchant_attendance_current_correction_decisions.sql)15–16、99及189的实际decide继续决定是否能批准／驳回；本包不能改变其CAS、封存、身份、自审批和来源规则。
- [169](../scripts/supabase-migrations/202610060169_merchant_attendance_event_notifications.sql)是固定源身份的本人结果消息；[188](../scripts/supabase-migrations/202610080188_merchant_attendance_owner_notifications.sql)44–68、291–330是事件时owner收件及原标读回执。两者类型、recipient、正文、readAt和原号语义不改，本包不塞新类别到旧表／parser。
- [117](../scripts/supabase-migrations/202610030117_merchant_attendance_owner_backlog.sql)及229已经能发现owner待审并fresh GET到原表单；不重做通用待办清单，不要求为了接手改旧成功writer。

完整有限链为：真实189有效grant＋真实待审首次补正 → owner明确登记这条申请的办理责任 → 原指定grant失权 → 当前owner明确接手协调 → 原096／189在fresh GET后照常审批；另明确生成一条本站内待接手摘要，标读独立。登记、接手、提醒均不产生决定、核定工时或原始事件。

## 2. “责任”不是权限，也不是排他任务锁

### 2.1 首次责任登记

owner从已授权的待审申请和189有效grant详情中选择**精确requestId＋grantId**，确认“由此授权员工办理”。这是现在发生的责任登记，不追认此前曾接单；没有这一步的旧申请不自动补建历史。

锁内核验：当前owner；真实submit的worker／employee／Auth及完整保存地点等于grant；当前request仍待审且revision一致；grant当前可用；includePending=false时submit.recorded_at严格晚于grant.recorded_at。登记不要求“当前一定可批准”：即使现有来源限制只允许驳回，也可明确办理，但必须显示限制。没有权限的材料不靠新接口取得。

首记录保存原grant、双身份、暂停代次、原submit操作号／revision、登记actor和时间、理由。界面称“负责人指定办理”，不称“员工已接受”。每request一个当前责任head，历史只追加；其他有效owner／delegate仍可照常审批，**不得因责任head不是自己而被剥夺原权限**。

### 2.2 失权与负责人接手

GET只观察，不写“自动移交”。失权依据针对**已登记的精确grant**，不以浏览器时钟或当前worker默认地点推测：撤销、有效期届满、主管停用／角色能力失效、任一保存身份换绑、任一暂停／代次变化、目标或保存地点停用。服务器给有限原因代码及当前观察时间；不得混称其他grant也失效、不得展示其他范围正文。

当前owner显式`take_over`，使用当前责任revision／operationId和本次观察指纹CAS；等锁后重新读取原grant、请求头和资格。只有仍待审且登记资格仍不可用，或上次接手的owner已经更换，才追加新接手记录；已被批准、驳回或撤回则返回明确状态冲突，零新接手。另一个有效grant并不阻止owner接手协调，但UI明确其正常审批能力未被撤销。

接手后责任是“当前owner负责后续协调”，**不是canApprove保证**。来源员工已暂停／换绑时，owner可以保留协调记录，旧审批仍按原规则拒绝；不得伪造新旧身份一致。若申请属于当前owner本人，接手不允许其自批，必须由另一实际有权delegate按189完成；没有有效delegate时明确“仍待安排”，不能假报已处理。

新owner可按商户权限读取责任元数据并重新明确接手；旧owner失去普通读写资格，仅能按自己的精确原操作号恢复最小回执。旧责任actor、旧消息recipient与已完成决定不改、不转投。旧主管恢复活跃／重新获得角色也不复活失效的原grant代次。

### 2.3 数据最小化和导航

新责任记录只保存办理旁证和有限理由，不复制原始打卡／proposal／附件／GPS。普通列表最多25＋1，按最新责任操作时间／requestId keyset；每次只读当前head及对应一个entry，历史按revision倒序25＋1，不读全历史。不跨页宣称某个总数完整。

owner详情可展示当前责任／资格原因和当前申请元信息；“打开原申请”只传requestId，复用Admin唯一CorrectionReviewPanel及229初始选择。原客户端pending优先：未知原号存在时不得切换新目标或另开第二writer。原详情必须fresh GET，重新核对保存worker／employee／Auth、requestId与申请revision，不能把责任旁证当审批证据token。

delegate普通申请正文仍只经189当前grant读取；责任登记不提供新的授权入口。新提醒仅给当前owner，不借169的self.view／worker资格或伪造owner身份。

## 3. 一种固定窗口的合并提醒

采用**数据库UTC自然日半开窗**`[00:00:00.000000Z, 下一日00:00:00.000000Z)`；这是技术限频口径，不是法定期限或“已逾期”判断。窗口、资格观察和recipient均在数据库锁后用`clock_timestamp()`确定，浏览器不得指定任意时刻／收件人，临近午夜重采后不能跨窗误记。GET预览可返回expectedWindowStart；POST若已跨窗则拒绝并要求重新读取。

显式“生成本窗待接手提醒”只扫描**本包已登记、原申请当前仍待审**的责任head：指定grant失权，或保存的owner接手责任已因owner变更失效；已由当前owner接手协调者不重复列为“待接手”。新功能不回填未登记的旧申请，不证明所有审批类型或所有无人负责事项都已覆盖。

- 同`(siteId, recipientAuthUserId, type, windowStart)`至多一条摘要；收件人为生成锁内当前owner。多个符合条件的request合并为一条，不按worker／grant分别轰炸。
- 一次最多核验100条当前待审责任候选，先有界101探测，超限**整次零新增提醒并明确too_large**，不截断后声称完整。只走新heads索引和原申请／决定PK或唯一索引；不扫描所有grant、全部操作历史或所有原始事件。实际实现须验自然计划，不把LIMIT视为自动有界保证。
- 非空时保存固定batch及精确item集合；单条item仅含requestId、责任revision／operationId、登记原身份旁证和失权原因／观察时间。公开消息不携原申请理由或完整身份正文，只给条数、窗口及精确目标引用。
- 同窗口的摘要内容**不再扩写**。之后才出现的新失权或新责任，可立即从实时待接手列表看到；下一UTC窗口再次显式生成时纳入。不得称为实时推送，也不得悄悄增成员导致已经标读含义改变。
- 若本窗无符合项，保存生成操作的`empty`回执但不占用摘要唯一槽；以后同窗新的明确操作可再生成，原号重放始终保持原empty回执。已有摘要时新明确操作返回`existing`并保存对应操作回执，不新增通知；不同operationId不是幂等键。同号同命令零追加，同号异命令／actor冲突。
- batch内容、recipient和生成资格旁证不可变。标读只针对精确batch，首次readAt保留；追加独立mark操作回执。标读不接手、不批准、不确认员工内容。名单后续已解决时，旧摘要仍是当时观察，不隐藏成“从未提醒”。

新owner可显式生成**自己的新摘要**（即使同日），从当前责任和资格重新采集；这不是转投旧通知。旧owner不得读新摘要，也不能在失权后首次标读旧摘要；只可恢复自己已经保存的mark／generate最小回执。旧188／169消息原样保持。

## 4. 最小新增存储、原号和锁边界

建议独立新增：责任entries（append-only，唯一site/op和request/revision）、责任heads（仅本包CAS投影）、reminder_batches、reminder_items、reminder_operations。不改旧表／旧角色；不硬定尚未分配的migration编号。责任、提醒正文／旁证不可更新或删除；head是可重建的当前投影，不能成为历史证据。标读首次时间从按batch/action/time/op索引的首个成功mark操作点读，不需要扫描全操作账本。

命令族保持有限，不做通用JSON任务系统：

| 明确动作 | 必须绑定的输入 | 固定结果 |
| --- | --- | --- |
| register | operationId、requestId、grantId、expectedRequestRevision、reason | 责任revision1；保存实际actor与原资格旁证 |
| take_over | operationId、requestId、expectedResponsibilityRevision、expectedResponsibilityOperationId、expectedObservationFingerprint、reason | 新责任revision及接手actor；不含审批决定 |
| generate | operationId、expectedWindowStart | generated／existing／empty，batchId可null、窗口、条数；不返回申请正文 |
| mark_read | operationId、batchId | 原batch、真实actor、首次readAt |

普通列表／详情与原号恢复分开；恢复只GET，不重发写入、不重采当前原申请、当前grant或提醒成员。最小回执统一携带operationId、action、actorId、commandFingerprint和对应结果ID／版本／时间。精确保存site＋actor＋原query＋原command；固定标量tuple SHA绑定命令，原字节CAS才清sessionStorage。404／鉴权失败／超时不等于未提交，保持原号。原actor换绑或原号冲突不给他人回执；负责人换人后只给原actor自己的最小回执，无正文、无导航资格。

新fresh写锁序沿189：merchant SHARE固定owner → settings UPDATE → 目标worker → UUID有序employee／role锁 → 新责任head；等待后重核当前owner、身份／代次、期限和source状态。旧096／189也由settings串行保护；它们无需认识责任表即可避免接手与已决定并存的错误观察。**不持有新head后再获取settings**，不调用owner RPC冒充delegate。提醒生成也先merchant／settings，再固定UUID顺序核候选成员，有限100；因原审批可先完成，源已决定必须排除而非发仍待接手新通知。

读标识严格、UTC6精度、UUID小写规范、理由trim及有限字符、响应128KiB／请求8KiB、同源／真实Auth／限流／no-store；前后端独立旗默认关闭＋最多64个精确8位site白名单。新普通读取只当前owner；开关关闭至少保留原actor最小GET恢复，不自动重新调用旧授予或审批。

## 5. 实际入口与执行方式

新独立owner工作区挂现Admin，展示“责任登记／待接手”和“合并提醒”两个有限区域；不替代OwnerBacklog、不修改238的正常授予／审批流程。可从已有待审fresh详情的精确request跳到登记；选择grant仍是189已授权元数据的显式读取。初挂零HTTP、所有读写明确点击；dirty／pending外层guard、隐藏与账号／requester变化同步失效、正文清除、原号保留、390px可用。新client原号槽与旧correction、delegation、188槽分离，聚合恢复只增加新最小格式。

首版生成入口是当前owner的明确POST，**没有setInterval、页面自动生成、常驻worker或邮件／手机推送**。生成核心可抽为私有有界过程，以便以后由已有worker接一个显式受限调度入口：必须保留独立allowlist、单site／单窗／一次最多100、独立system actor来源（不伪装owner Auth）和相同唯一槽；没有该调用者鉴权合同及实际验收前不宣称自动调度已交付。本包的人工生成＋窗口合并限频即为本次站内提醒终点。

## 6. 有限验收后即停止该包

1. 真实189grant＋真实首次补正submit，明确register保存；原grant撤销／主管暂停至少一种真实失权 → 当前owner fresh观察并take_over → 旧096合法决定；原责任、grant、请求、源及消息历史均保留。
2. 另一个有效delegate在别人责任head下仍能依法决定；owner本人申请接手不等于可自批。目标换绑／暂停、代次改变／期限届满不被接手解除，资料越界仍拒绝。
3. 原审批先完成与接手先完成的必要共享锁顺序：前者接手零写冲突，后者责任先存、其后实际决定正常；没有第二决定或虚构处理结果。无需重复所有旧审批排列。
4. 同窗两件待接手合一条；同号重放无新行、异命令冲突；新号同窗existing不新通知；UTC边界新窗可新生成；本窗空后后来有候选可生成；101候选整次不截断。
5. 生成／标读失败整事务回滚；成功丢回复只GET核对；owner换人不读／标旧正文、不转投，旧actor仅原号最小回执，新owner新摘要重新采集；169／188旧行全量保护。
6. 实际Admin入口→责任登记／接手→复用唯一原审批面板，明确生成／标读，原pending优先、取消确认零POST、隐藏／Auth晚响应清屏及390px。原始事件、工时来源／合计、固定周期归档SHA保持。

真实账号、真手机和生产启用另列；此包通过后只收口C15-B选定的一类完整链，不宣称其他C15分类、C03所有管理授权或P1真实试点已完成。若本包某个已冻结上限触发，明确显示限制，不以“更多组合待验”无限扩张范围。

## 7. 与C07统一提醒的实施协调（后续实施以本节为准）

责任entries＋责任heads两表及明确登记／接手可独立实施；它们记录办理责任，不依赖消息系统，也不改变任何已有审批权限。

上文五表拆分方案中的提醒batch／item／operation部分**仅为候选，不是要求另建一套独立提醒系统**。C07已冻结的`open_session`、`pending_review`、`period_due`三类到期提醒，必须与本包合并设计同一个有限提醒存储、资格检查、窗口合并／限频、幂等执行及原号恢复核心。首次补正的`handover_needed`应作为`pending_review`的子原因，不能再另起第四种平行消息账本；上文独立类型名称和表名不作为最终冻结ABI。169／188原消息协议、旧recipient与历史仍不扩张或迁移。

明确生成按钮只是一种管理触发方式，可在共同核心上验收；**manual通过不代表自动到期提醒完成**。C07自动提醒的有限调度入口、当前资格／配置、去重窗口、失败恢复及真实调用路径，须在统一合同中明确并实际验收后才能收口。不得先实现本包独立manual提醒表，再为C07重复建立自动提醒账本或后台常驻进程。设计阶段到此仅保存方案；后续198／201已实际实现与验收，当前不再处于仅设计状态。

## 8. 198／201历史验收进展（已由最终完整验收收口）

当前结果见本文顶部：201完整8组、112 SQL／78 RPC、两PID竞争、父级52项恢复／停止已通过；210精确UTC与最终209父级62项保护再通过。下列“最新／尚待／未收口”均指对应旧批次，不代表当前任务。

2026-10-09最新：新增收件页面及完整TypeScript已通过，以下早期“待验”保留为历史。34304的少量真实来源诊断通过，21 SQL／8 Node RPC、5978毫秒；启用提醒的请假表达式＋约束约1514毫秒，其中旧valid_zone的74次时区目录查询约1443毫秒，旧公共函数尚未改。93352完整201已完成A／F／E／B／C／D／G，H首场真实竞争第101步被原120秒预算拒绝：总123706毫秒、唯一真实等待54754毫秒、SQL64404毫秒；不是整包通过。22829的206／207和8586的208各自八组实际业务及完整回滚已通过；195三条合成events的固定登记已窄修，69481父级收尾51项检查／baseline恢复及停止通过，本次196–208业务明确skip，不据此称201通过。C07／C15仍部分完成。未经公共UTC旧路径优化明确许可，不重复原样等待或放宽预算；提醒仅保留原有限终点。

2026-10-08，198实际安装／重入及八组125逻辑步在owned PG通过，旧事实、函数元数据及固定归档保持。随后199／200具体失败另列，不把外层联验写为全部通过。201统一提醒SQL及其原生夹具已实现，实际运行结果仍待当前串行联验；三类来源捕获、限频、标读与系统actor不以模型代替SQL证据。

201实际组件浏览器第二轮四组全部通过，用时13.223秒、47 API（45 GET／2 POST）、50本地HTTP；390px无横向溢出，外网／落盘bundle为0，owned browser／listener均已关闭。实际Admin／Manager／Launcher／Panel运行，负责人工作安排原详情是一条合法正例，其余五类仅证明fresh198后正确进入旧原授权GET并安全拒绝（503），**不是五条成功审批或完整审批正文的验收**。周期提醒先fresh200详情，再只传真实intentId，原页仍须明确GET；无worker的主管以实际Auth字段而非membership ID读取自己的提醒；原号unknown／null保留、关闭新写后匹配GET清槽、隐藏／换Auth／requester晚响应、StrictMode和关闭零后台请求通过。没有原审批POST，Auth／HTTP均为合成、SQL和真实登录为0。

第一轮在第六类请假原页打开后被提醒modal遮挡，26 API／0 POST／29 HTTP，未完成四组。已定位为新Launcher交接只打开原事项、未关闭自己的modal；仅新增当前Auth／可见／同请求代际双检，host明确返回true才关闭，拒绝／失效不关闭，原编号不变。定向小测试及第二轮实际操作共同确认修复；不改旧审批成功路径。

2026-10-09收敛更新：198接手、199日判断和200周期采用已达到各自本地有限终点，不再重复列为尾项。201已有默认关闭、严格有界的server-only系统runner，尚待完整实际数据库验收；不要求再建cron／常驻进程或第四消息账本。本人开放班次已接单次完整193 GET身份核验后的一次本地打开提示；主管首次补正仅接历史目标指针→原189显式授权选择器，不注入grant、不自动读正文或审批。两入口的30项定向／旧入口小测及lint通过，实际新增两组页面与统一TypeScript仍待串行验收，其余五审批族明确从原工作区读取，不泛化成新增五条成功审批矩阵。C07／C15整体尚未收口；生产cron、真实账号／手机及上线继续独立列出。

后续实际收尾：53271完整TypeScript EXIT0，包含上述新运行时／四个页面夹具及207独立KDF测试。新增两组recipient页面首次实际通过：20 GET／0 POST、23 HTTP、6143毫秒，390px无横溢；真实Manager→Launcher／Panel→本人原OperationalHost及主管原189选择器链通过。错误指针拒绝、普通重绘不取消有效GET、Host初挂零HTTP、一次提示消耗后不重开、主管明确三次GET取授权／列表／详情、dirty关闭取消、原槽保护及隐藏／Auth晚响应隔离均通过。Auth/API合成，0真实SQL／Auth／业务提交；browser、context、listener及inflight已关闭，旧四组未重跑。独立207真实默认成员／独立PIN派生各一次、共六次mockRPC也已通过（729毫秒）；无真实SQL／Auth，不作为提醒或真实设备证据。31888的201整包仍因全夹具120秒预算未完成，详见有限收口记录，C07／C15尚不能改成完成。
