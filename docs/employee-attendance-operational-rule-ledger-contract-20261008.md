# C07／240 八字段核准台账：独立 SQL／HTTP 合同初稿

日期：2026-10-08。状态：**第10／10.1节已由主线程审核冻结并批准240实施，第11节为已核准目录补充**。本文不是已安装迁移或真实验收记录。238 已通过的文件继续冻结；240独立新增迁移191，不改旧 SQL、旧四字段 DTO、既有发布或业务消费路径。

依据：[八字段纯合同](employee-attendance-operational-rules-contract-20261008.md)、[剩余规则消费边界](employee-attendance-remaining-rules-boundary-20261008.md)。本包交付目标仅为三层配置的草稿、明确未来发布、撤销未生效发布、分页历史和原号最小恢复。核准台账完成不等于八项已被打卡、申请、审批、周期或提醒消费，不据此宣布 C07 完成。

## 1. 复用什么，不改变什么

- 127 `faolla_attendance_rules_v1` 的当前 owner 核验、merchant SHARE → settings UPDATE 串行、原号先于新写资格、CAS，以及 `faolla_attendance_rule_day_start_v1` 的真实民事日下界可复用思路；见 `202610040127_merchant_attendance_rule_versions.sql:50–70,269–327`。不向 `faolla_attendance_rule_values_v1` 的四键形状塞入八字段。
- 129 的 worker／employee／Auth 保存身份、负责人核准个人例外、有限区间和未来撤销可复用；见 `202610040129_merchant_attendance_personal_rules.sql:87–118,245–315`。不能直接复用其“一个 worker 永久一个身份 stream”后在换绑时覆盖旧身份；新合同明确按保存身份分流。
- 128 按生效时间索引找前驱，而非只看最近 25 个操作，是正确的来源选择思路；见 `202610040128_merchant_attendance_sources.sql:185–206`。其全区间候选上限和不断反查撤销的查询不能直接当成任意历史长度下的常数工作量保证。
- 124 的精确组、单 worker 分配历史和 25+1 目录可复用；见 `202610030124_merchant_attendance_groups.sql:94–118,187–218,350–360`。既有分配没有保存 employee Auth，不能倒填“当时 Auth 已核验”。
- 八字段值对象全部交给新的 `parseOperationalRules`／`parseOperationalRulesJson`；三层值解析交给 `resolveOperationalRules`。位置：`src/lib/merchantAttendanceOperationalRules.ts`。其纯预览仍是 `candidateOnly:true, applied:false, authorityChecked:false`，不因被放入已发布台账就篡改这三个标记。

主线程已为本包预留新迁移191；所有建议对象使用新的 `operational_rule` 命名空间。第8节只保留未来接口方向，本包明确不实现来源消费 helper，不挂接任何旧 writer。

## 2. 统一 scope 与身份

新协议名建议为 `attendance-operational-rule-ledger-v1`；与值对象的 `attendance-operational-rules-v1` 常量分开。值对象仍 exact 八键，不新增 protocol 字段。

```ts
type OperationalRuleScope =
  | { kind: 'enterprise' }
  | { kind: 'group'; groupId: string }
  | { kind: 'personal'; workerId: string; employeeId: string; employeeAuthUserId: string };
```

每个分支 exact keys。`siteId` 是外层八位商户号；所有 UUID 沿现有严格 canonical 格式，不接受空串、大小写变体或隐式 null。后台从此对象生成内部 stream key，禁止客户端提供自选 key。

- enterprise 一商户一条 stream；group 一商户一 group 一条；personal 一商户加完整 worker／employee／Auth 三元组一条。同 worker 后来换绑只可能建立新的身份 stream，旧记录与旧规则绝不继承为新身份。
- 所有 fresh 读写先核验真实当前 `merchants.user_id = actualAuth`。不提供员工自行核准、角色名代替 owner、委托写入或 owner 冒充。actor 来自真实 Auth 上下文，不在请求 body 中接受。
- owner 可以明确查看同商户保存的旧 personal stream，并撤销尚未生效的旧身份发布；不能因此为已换绑、离职或停用身份发布新规则。UI 要显示保存身份与当前绑定是否一致。
- group 的规则作用于未来实际消费时证明属于该组的 worker，不保存“全员名单”也不自动复制到成员个人 stream。地点、路由或选中的人员都只是配置引用，不是访问凭证。
- 本期 personal 仍限已有真实 membership 双身份。C04 无会员独立 worker 不塞 null／假 Auth；将来若支持应新增明确的 subject 分支并版本化，而非放宽本分支。

## 3. HTTP／RPC 最小入口

建议新路由 `/api/merchant-enterprise/attendance/operational-rules`，新 service-only RPC：

```text
faolla_attendance_operational_rules_v1(
  p_query jsonb, p_auth_user_id uuid,
  p_command jsonb default null, p_allow_write boolean default false
) -> jsonb
```

RPC `p_auth_user_id` 不从请求 JSON 采信。所有私有校验、来源和投影 helper 对 PUBLIC／anon／authenticated／service_role 均撤销直接执行；新表启用 RLS 且无直接客户端读写。仅顶层 RPC 授予 service_role。迁移首装／重入都核对 owner、ACL、RLS、触发器与精确签名，不能自动修复异常既有对象。

GET exact 判别联合：

```ts
{ siteId, mode: 'detail', scope }
{ siteId, mode: 'history', scope, cursor: null | HistoryCursor }
{ siteId, mode: 'preview', scope, sourceDraftRevision, effectiveOn, endsOn }
{ siteId, mode: 'recover', operationId }
```

`scope`／`cursor` 使用严格 JSON 查询参数；拒绝重复 URL 参数、未知键、重复 JSON 键及多余 body。preview 只针对**已保存**的 exact draft，不从浏览器临时字段伪造已核准预览；未保存本地八字段用纯 resolver 预览。detail／history 不自动连取其他层、全员或所有历史。

POST 固定 `{query,command}`；`query` 必须严格等于 `{siteId,mode:'detail',scope}`，与 command 同 site／scope。recover 只接受 GET，不能以恢复按钮自动重送 POST。

共同 command 字段：`siteId, scope, action, operationId, expectedRevision, reason`。分支附加键：

| action | 唯一附加字段 | 含义 |
| --- | --- | --- |
| `save_draft` | `expectedContext, rules` | 完整八键文档；不是 patch；旧草稿由新操作取代，不 UPDATE 旧正文 |
| `publish` | `sourceDraftRevision, effectiveOn, endsOn, previewFingerprint` | 只能发布 stream 当前草稿；正文由数据库取保存草稿，不接受替换 rules |
| `withdraw` | `publishedRevision` | 精确指向本 stream 尚未生效、尚未撤销的发布；不能撤销整个 stream 或追溯撤销生效事实 |

`expectedContext` 是 exact `{settingsVersion,timeZone,subject}`；subject 为 enterprise 的 null、group 的 `{groupRevision}`，或 personal 的 `{workerVersion,employeeVersion}`。身份已经包含在 scope，不能把版本正确当作身份正确。subject 不放隐式默认值或“当前员工”的晚绑定别名。

序号用 PostgreSQL bigint，JSON 整数范围 `0..9007199254740990`；新的 command `expectedRevision` 必须小于上界。0 表示尚无 stream。只拒绝真实溢出，不照抄 100／20 这样的永久历史容量上限。`reason` 1..200 字符，明确去首尾空白／控制字符政策；不默默改用户正文后复用原号。

独立新写开关建议 `FAOLLA_ATTENDANCE_OPERATIONAL_RULES_ENABLED` + `SITE_IDS`，缺省关闭；前台对应入口默认关闭。开启新写只授权访问台账，不开启八项实际消费。已授权 owner 的 detail／history 和未来撤销、原 actor 的最小 recover 在新写开关关闭后仍可达；fresh save／publish 不可达。

HTTP 必须真实认证、同源 POST、密码登录规则沿当前 owner 管理入口、GET/POST `no-store`，不回显 SQL／未知异常。主线程确认正文 40 KiB（内含单 rules 仍必须 ≤32 KiB）、响应 256 KiB；建议请求 12 秒有界读取。八字段没有任意长文本，25条历史的正常严格值远低于响应上限，但最终仍按实际 UTF-8 字节拒绝超限，不能按行数假定必定够用。拒绝非 200 成功、重定向、非 JSON、无效 UTF-8、超限和重复键，不截断历史或字段。最终超时常量在实现前同 parser／route／client 冻结，不能为适配超限行临时提高。

## 4. 返回值、历史与最小回执

外层 exact：`{protocol,siteId,actorId,readAt,canWrite,data,receipt}`。UTC 时间保留 6 位微秒。`canWrite` 只代表本次可发起 fresh 配置写入，不给历史页／回执赋予新写权。

- detail 的 data：`{kind:'detail',scope,revision,context,draft,currentPublication,nextPublication,canWithdraw}`。draft 是完整保存的 SaveDraftItem；current/next 是至多各一个完整 PublishItem，不嵌全历史。个人有限区间过期时 current 为 null，不自动回到更旧、已过期的个人例外。context 为当前保存 scope 仍能匹配的上下文；历史个人已换绑则 null。`canWithdraw` 仅提示下一尚未生效发布可撤销，提交仍重新锁内授权。
- preview 的 data：`{kind:'preview',scope,revision,sourceDraftRevision,context,rulesFingerprint,references,referenceFingerprint,effectiveOn,endsOn,effectiveAt,endsAt,previewFingerprint,applied:false}`。references 检查说明地点与路由身份引用，不输出 `allWorkersAuthorized:true`，不声称给企业／组扫描过所有人的最终交集、截止或 grant。
- history 的 data：`{kind:'history',scope,atRevision,items,nextCursor}`；单页 25+1，items 最多 25，严格 revision 降序，无累计数组。每项为 `{item,withdrawnByRevision}`，item 保存 actor、operationId、revision、action、recordedAt、commandFingerprint 和对应固定事实，不重复附完整 command。首次以锁内 head revision 固定 atRevision；cursor exact `{siteId,scope,atRevision,beforeRevision}`，后续 `revision <= atRevision AND revision < beforeRevision`。cursor 绑定范围但不是权限，每页重验 owner。withdrawnByRevision 只表示该 atRevision 快照中已经发生的撤销，不污染不可变 item，也不混用后来当前投影状态。
- POST／recover 的 data 只 `{kind:'receipt'}`，`canWrite:false`。receipt exact `{operationId,actorId,scope,action,revision,recordedAt,commandFingerprint}`；不带 rules、姓名、地点、路由成员、完整 command 或当前 head。未找到原号返回 `receipt:null`，只表示未找到，不足以安全遗弃本地原意图。

原号 hash 绑定协议域、site、真实 actor、完整 canonical scope 和完整 command。主线程明确采用**仅标量／递归数组**的固定 tuple：scope 三分支、rules 八字段、route 四类和 reminder 三类均固定次序；PostgreSQL `jsonb_build_array(...)::text` 对应 JS 递归数组以 `', '` 拼接，标量用严格 JSON 序列化，UTF-8 SHA-256。完整映射见第10节。不得将任何嵌套 JSON 对象放入 hash tuple，不能依赖对象键顺序、纯 parser 输出顺序或普通数组 `JSON.stringify` 的无空格格式。客户端／service／SQL 共用测试向量；未达成前不能仅凭 operationId 清 pending。

原号全商户唯一；同 actor 同 scope 同完整 command 精确重放只返回原 receipt，不受新 CAS、草稿、时间或开关变化影响。同号不同 body／scope 明确 conflict，另一 actor 不得读取或重放他人回执。POST 原号命中不得自动刷新全部来源或扫描历史。

本地 pending 存储仅按 site+真实 actor 独立槽保存 versioned 原 query/command/hash；首次 POST 前落盘。initialize／scan 不发 HTTP，恢复只有用户明确 GET；未知／null／坏正文／晚到响应保留原 bytes。变 scope、Auth、请求器、隐藏及关闭同步使旧 lease 失效，存储读取／删除都比较原 bytes，不能删除并发替换的新意图。无 pending 时关闭不留下正文；有 pending 的退出确认只离开，不丢原号。

## 5. 两个事实对象与一个严格派生索引

建议三张**新**表，不接旧127／129：

1. `merchant_attendance_operational_rule_streams`：scope 的固定身份、head revision、draft revision、创建／更新时间。只有此 head 可以 CAS 更新；范围身份不可变。缺失 stream 读为 revision0，不在 GET 偷建行。
2. `merchant_attendance_operational_rule_operations`：全商户 operation 唯一、scope+revision 唯一、actor、完整 command、规范 hash、保存规则／引用、固定时区及发布区间、sourceDraftRevision／publishedRevision。append-only，拒绝 UPDATE／DELETE／TRUNCATE；跨商户／跨 scope 引用以精确 FK 和 checker 拒绝。
3. `merchant_attendance_operational_rule_publications`：每个 publish 一条派生索引，绑定不可变 publish operation／revision、有效范围和可空 withdrawnRevision；撤销只能由同事务相应 withdraw 条目证明后单次填入，其他列不可变。事实来源始终是 operations，不把 projection 当无凭证授权。

第三表的理由不是增加业务状态：仅靠 `publish NOT EXISTS withdraw`，大量已撤销未来条目会令选择“最近仍有效发布”不断跨过历史，LIMIT1 不保证扫描恒定有界。新投影用未撤销 partial index `(site,stream,effective_at DESC,revision DESC)`；personal 另需同 stream 的有限区间交叠索引／排他约束。原号 PK 点查、history B-tree 25+1，与整段历史长度无关。

精确外键／deferred constraint 应证明：head 对应最后操作、draft 只指 save_draft、publish 指同 stream 的保存 draft、withdraw 只指同 stream publish、projection 与原发布／撤销逐字段相等。helper 点查必要前驱和所引用的行，不递归重放整个历史。首装和重入对派生投影的完整一致性可执行有界批次诊断，但不能默默重建或修复既有异常；运行时异常 fail closed。

## 6. 发布、撤销与锁内再验证

统一锁序建议：当前 merchant SHARE → settings UPDATE（纯读 SHARE）→ 精确 scope worker（若有）→ 涉及员工按 UUID 升序 → group（若有）→ 地点按 UUID 升序 → 新 stream／publication 投影。所有新写在同商户 settings 锁后串行；实现时必须核对实际地点／员工独立 writer 的锁序，不能仅凭此文臆称无死锁。不使用 GUC 授权、临时修改配置、伪 owner 或禁用 trigger。

处理步骤：

1. 严格解析 query/body 和真实 Auth；POST 在锁内核 current owner。先以 site+op 点读原操作，精确 actor/scope/body 相同则返回保存 receipt；不重跑 fresh 发布规则。
2. 新写读取 head/CAS，检查 overflow。save/publish 才检查新写开关、scope 当前身份／活动与 context；撤销只检查 current owner、保存 scope、CAS、精确原发布与尚未生效，不因组停用／个人换绑／配置开关关闭剥夺安全撤销。
3. save_draft 完整严格解析八字段并锁验有限 references，保存 rules、context 和 reference snapshot；原有 draft 不改。允许 inherit／disabled 的真实含义，不自填默认“已启用”值。
4. preview 重新取保存 draft、context、地点和路由身份引用；计算固定日期下界和 fingerprint。fingerprint 包含 scope/head/draft revision、完整 rules hash、context、依赖引用、effectiveOn/endsOn 与转换后的边界；不包含每次变化的 readAt，否则下一次提交永远不相等。
5. publish 锁内重算同一 preview fingerprint，并核 sourceDraftRevision 仍为当前 draft；任何身份／版本／引用／日期变化都 changed，须显式重读、重新核对，不自动更新 command 后重发。publish 从原 draft 复制固定事实，清当前 draft 指针；旧 draft 和 publish 原文都保留。
6. 所有等待锁后用 `clock_timestamp()` 再验时间：`effectiveOn > 当地今天` 且 `effectiveAt > 锁后现在`；有效时区来自保存并再验的 settings。复用127的重复／跳过午夜算法，不能简单 UTC+24小时。被跳过的开始民事日拒绝；结束日使用129的次日下界逻辑。
7. enterprise/group 采用依次递增 effectiveAt，不能插入已有未撤销发布之前／同点；新版本在其开始前不覆盖旧版本。personal 采用不重叠有限区间，结束后回退组／企业继承，不复活旧 personal 条目。撤销必须 `lockedNow < target.effectiveAt`，等于时已经不能撤；不回写原 publish。

日期技术域与八字段 anchorDate 分开：纯 `timesheetCycle.anchorDate` 已接受真实四位民事日 `0001..9999`，不得把它收紧成旧2000..2100。台账 effectiveOn／endsOn 若复用127／129 helper，则沿该 helper 支持的2000..2100真实日期并明示为实施边界，不改变纯字段合同、不凭空推导自动周期或追溯日期。

## 7. 地点、路由及发布的承诺边界

- locationScope value 至多25个 ID，按规范排序逐项 `(merchant_id,id)` 点查并锁定。不存在／外商户引用整个拒绝，不隐藏掉再发布；draft 可显示同商户停用地点，publish 要求引用地点当前有效并重验版本。保存仅 id/version/name/active 等最小管理信息，**不采 GPS、经纬度、围栏或设备密钥**。
- reviewRouting 最多四个成员引用，按 distinct employee IDs 点查同商户真实 employee+Auth，保存双身份／版本／状态；跨商户或换绑引用拒绝。是否同一人多类复用可按纯值合同，不造重复授权。
- 配置里写 `owner` 表示未来业务消费时的真实 owner 路由选择，不把当前 owner 永久写成所有未来任务的自动收件人。具体任务一旦保存 recipient，仍按任务自己的固定收件／明确交接合同，不动态转投。
- 配置指向 delegate 不等于对所有组成员拥有 grant。企业／组发布不枚举全部 worker，也不检查“所有人都有可用 grant”。预览明确 `routingAuthority:'not_evaluated_for_all_workers'` 的说明语义；最终 exact DTO 不用字符串冒充 grant proof。
- 单 worker 真正消费时才由该业务真实 guard 核验 grantId、动作、worker/employee/Auth、历史地点、有效期、includePending／includeExisting、双方 epoch、暂停与角色；首次补正 grant 绝不覆盖补正修订。没有可用授权则明确不可用，不自动 owner 回退／补授权／改路由。
- 发布只表示该范围的值文档被核准；不能声称企业／组“所有员工新开始均可用”。个人预览也不能只看本层解除上层地点交集、原通路资格或企业独立申请窗口。全员影响分析不是此次发布事务的隐式副作用。

## 8. 为未来真实消费保留稳定接口

建议只冻结一个私有、单 worker、单时点的来源接口，不在本台账包挂接旧 writer：

```text
faolla_attendance_operational_rule_source_v1(
  site, workerId, employeeId, employeeAuthUserId, atUtc
) -> validated source JSON
```

调用者必须先完成所属业务真实身份／动作授权并持有一致锁；helper 本身没有任何对外 EXECUTE 授权，不接受“authorized:true”、浏览器自报 grant 或任意 GUC。source 只回答规则来源和值，不授予打卡／审批／封存等能力。

稳定 source 输出建议包含：`protocol,siteId,workerIdentity,at,settingsRef,groupAssignmentRef,layers,baselineCorrectionPolicyRef,sourceFingerprint`。

- `workerIdentity` 固定当前真实三元组与必要版本；`layers` exact enterprise/group/personal，每层为 null（有数据库完整性证明的无生效发布）或 `{scope,operationId,revision,effectiveAt,endsAt,rulesFingerprint,rules}`。missing／too_large／身份错误不得转换成 null 或继承成功。
- groupAssignmentRef 引用124保存 assignmentId/revision/operationId/workerId/employeeId/原时区和区间。旧事实不含历史 Auth 时明确不宣称含有；当前消费的 Auth 另由 workerIdentity 证明，不 UPDATE 旧 assignment。
- 先按**单 worker／单时点**的索引查实际组分配，至多2候选用于检出歧义；再点查至多三层有效 publication，不翻 history 页。若旧分组数据有大量无法有界证明的候选，明确 too_large／ambiguous，不能遍历到找到一个就假定完整。将来跨期间审计使用独立有界区间接口，不能让单时点接口悄悄扫全历史。
- 原企业补正政策缺失仍明确 baselineMissing，不无限期；来源选择完成后交纯 `resolveOperationalRules` 得值与trace，再在业务锁内做真正资格交集和动作决策。纯 resolver 的 false 标记不改成 true；真实使用结果放独立 proof 对象。
- 每个未来使用旁证至少固定 `sourceProtocol/sourceFingerprint`、三层精确 publication 引用、worker 三元组、group assignment 引用、原独立配置版本、所用字段及真实来源操作号；审批路由另有真实 grant proof。保存 proof 必须同一次业务写入原子提交，不先写候选再声称业务已采用。
- 当前台账包只定义可验证引用接口，不创建消费旁证空表冒充已接线，不调用134/137等旧打卡包装器，不改申请期限、周期范围、既有归档或任何通知 recipient。

## 9. 有限验证与待主线程冻结项

实施后最小验证建议：三层各一次真实 save→preview→publish；一个个人有限区间；同号精确重放／改正文 conflict；开关关闭时安全撤未来发布及原号最小恢复；25+1 history 不漏重且额外 draft 不遮住更早有效发布；一个地点外商户、一个个人换绑、一个路由双身份变化均全事务零写；一条等待跨民事午夜／生效点的竞争验证不追溯发布或撤销。旧127/129/128函数、旧四字段事实、事件和固定归档逐行／原文保持，全部新环境数据由 owned 合成作用域清理。

纯层复用239已冻结测试，不再造第二套八字段值语义。新 SQL 必须独立严格校验完整值形状，Node service 必须经过真实纯 parser；纯测试不能替代地点／双身份／锁内时间实际 SQL 证据。浏览器只需一个真实草稿／发布／丢回复恢复闭环，不重复既有全委托或周期容量矩阵。

以下三项已获主线程确认，不再作为待用户问题：

1. personal 沿129使用必填有限 `endsOn`，enterprise/group 的 `endsOn` 必须 null；三类共用 publish，而不另造个人 approve writer。
2. recover 对原 actor 开放**仅已知原号最小收据**，即使其后来失去 owner；不查当前员工目录、不给规则正文／历史，独立真实 Auth 恢复入口不可依赖进入当前 owner Admin。fresh 读写仍 current owner。
3. 采用第5节第三张严格派生 publication 索引，避免无限撤销历史扫描；不是允许修改事实台账。

发布预览明确只证明配置与有限引用，不保证全员授权；真实单 worker 来源接口和五类后续消费按 remaining-rules 分包实现。若主线程决定本包就实现 source helper，应另冻结其 exact 输出和当时组分配的有界取法，而不是临时扩此 HTTP 到全员试算。

## 10. 已冻结的 exact wire 类型

以下是新接口建议的完整字段清单。没有 index signature、可省略属性或附加未知键；`| null` 必须显式 null。`Rules` 原样引用239 `OperationalRules`，不得建立第二套宽松 parser。实际代码实现前以主线程审核后的本节为唯一 ledger wire，不以散落的文字摘要增加字段。

```ts
type UUID = string;       // canonical UUID，规则同现有 attendance 新协议
type SiteId = string;    // exact 8 decimal digits
type Hash = string;      // exact 64 lowercase hex
type Day = string;       // YYYY-MM-DD，真实民事日，发布边界2000..2100
type Instant = string;   // canonical UTC6: YYYY-MM-DDTHH:mm:ss.ffffffZ
type Revision = number;  // safe integer 0..9007199254740990
type PositiveRevision = number; // safe integer 1..9007199254740990
type Scope = OperationalRuleScope;
type Rules = OperationalRules;
type Context = {
  settingsVersion: PositiveRevision;
  timeZone: string; // 服务端验证的权威 IANA zone；不是任意长字符串
  subject: null | { groupRevision: PositiveRevision }
    | { workerVersion: PositiveRevision; employeeVersion: PositiveRevision };
}; // subject 分支必须与 scope.kind 对应，不能交换
type References = {
  subject: null | { groupActive: boolean }
    | { workerActive: boolean; employeeActive: boolean };
  locations: { locationId: UUID; version: PositiveRevision; active: boolean }[];
  routes: {
    category: 'correction'|'missing'|'leave'|'work_arrangement';
    employeeId: UUID; employeeAuthUserId: UUID;
    employeeVersion: PositiveRevision; active: boolean;
  }[];
};
// subject分支同scope；locations恰等rules.locationScope value的逐项映射，
// 非value必须[]，按locationId升序且≤25；routes恰等reviewRouting value中
// 非owner目标的映射，按四类固定顺序且≤4，不夹带目录或grant正文。
type HistoryCursor = {
  siteId: SiteId; scope: Scope;
  atRevision: PositiveRevision; beforeRevision: PositiveRevision;
};
type Query =
  | { siteId: SiteId; mode: 'detail'; scope: Scope }
  | { siteId: SiteId; mode: 'history'; scope: Scope; cursor: HistoryCursor|null }
  | { siteId: SiteId; mode: 'preview'; scope: Scope;
      sourceDraftRevision: PositiveRevision; effectiveOn: Day; endsOn: Day|null }
  | { siteId: SiteId; mode: 'recover'; operationId: UUID };
type CommandBase = {
  siteId: SiteId; scope: Scope; operationId: UUID;
  expectedRevision: Revision; reason: string;
}; // expectedRevision严格<MAX，reason1..200，不接受客户端actor
type Command =
  | CommandBase & { action:'save_draft'; expectedContext:Context; rules:Rules }
  | CommandBase & { action:'publish'; sourceDraftRevision:PositiveRevision;
      effectiveOn:Day; endsOn:Day|null; previewFingerprint:Hash }
  | CommandBase & { action:'withdraw'; publishedRevision:PositiveRevision };
type Body = { query:Extract<Query,{mode:'detail'}>; command:Command };
type ItemBase = {
  scope:Scope; operationId:UUID; actorId:UUID; revision:PositiveRevision;
  reason:string; recordedAt:Instant; commandFingerprint:Hash;
};
type SaveDraftItem = ItemBase & {
  action:'save_draft'; context:Context; rules:Rules; rulesFingerprint:Hash;
  references:References; referenceFingerprint:Hash;
};
type PublishItem = ItemBase & {
  action:'publish'; sourceDraftRevision:PositiveRevision;
  context:Context; rules:Rules; rulesFingerprint:Hash;
  references:References; referenceFingerprint:Hash;
  effectiveOn:Day; endsOn:Day|null; effectiveAt:Instant; endsAt:Instant|null;
  previewFingerprint:Hash;
};
type WithdrawItem = ItemBase & {
  action:'withdraw'; publishedRevision:PositiveRevision;
};
type Item = SaveDraftItem|PublishItem|WithdrawItem;
type Receipt = {
  operationId:UUID; actorId:UUID; scope:Scope;
  action:'save_draft'|'publish'|'withdraw'; revision:PositiveRevision;
  recordedAt:Instant; commandFingerprint:Hash;
};
type Data =
  | { kind:'detail'; scope:Scope; revision:Revision; context:Context|null;
      draft:SaveDraftItem|null; currentPublication:PublishItem|null;
      nextPublication:PublishItem|null; canWithdraw:boolean }
  | { kind:'preview'; scope:Scope; revision:PositiveRevision;
      sourceDraftRevision:PositiveRevision; context:Context;
      rulesFingerprint:Hash; references:References; referenceFingerprint:Hash;
      effectiveOn:Day; endsOn:Day|null; effectiveAt:Instant; endsAt:Instant|null;
      previewFingerprint:Hash; applied:false }
  | { kind:'history'; scope:Scope; atRevision:Revision;
      items:{item:Item; withdrawnByRevision:PositiveRevision|null}[];
      nextCursor:HistoryCursor|null }
  | { kind:'receipt' };
type Result = {
  protocol:'attendance-operational-rule-ledger-v1';
  siteId:SiteId; actorId:UUID; readAt:Instant;
  canWrite:boolean; data:Data; receipt:Receipt|null;
};
type ErrorCode = 'attendance_invalid_request'|'attendance_access_denied'
  | 'attendance_settings_required'|'attendance_operation_conflict'
  | 'attendance_operational_rule_changed'|'attendance_operational_rule_future_required'
  | 'attendance_operational_rule_overlap'|'attendance_operational_rule_disabled'
  | 'attendance_operational_rule_not_found'|'attendance_operational_rule_too_large'
  | 'attendance_operational_rule_limit'|'attendance_operational_rule_invalid';
type Response =
  | { ok:true; data:Result }
  | { ok:false; error:{ code:ErrorCode; message:string } };
```

成功外层不另重复一个可能不一致的 canWrite。error code 必须限定到冻结错误表，message 为安全固定文案而非任意服务端字符串。建议沿用 `attendance_invalid_request`400、`attendance_access_denied`403、`attendance_settings_required`409、`attendance_operation_conflict`409；新增前缀 `attendance_operational_rule_` 的 `changed`409、`future_required`409、`overlap`409、`disabled`403、`not_found`404、`too_large`422、`limit`422、`invalid`503。地点／路由错误公开为统一不可用引用，不泄露另一商户数据；unknown 错误映射安全503。实现前补齐 exact code 数组，不接受任意字符串 success／error DTO。

必要交叉校验：

- POST结果只能receipt分支且receipt非null；GETrecover只能receipt分支但允许null；普通GET receipt必须null，data.kind严格对应mode。detail／preview是否canWrite必须由同次锁内资格决定；history／recover／POST一律false。关闭新写开关，detail仍可返回nextPublication和canWithdraw，不把canWritefalse当禁止撤销。
- 所有内嵌scope逐字段等于query scope，外层site/actor等于真实上下文。receipt原actor等于当前恢复者，不能由UI展示名推导。draft／publication item.revision不超过detail revision，发布的sourceDraftRevision严格小于自身revision，withdraw引用严格小于自身revision。
- publish从保存draft复制rules/context/references，hash逐项相等；当前草稿context／reference已变时preview直接changed，不能静默替换旧草稿引用。个人endsOn非null且≥effectiveOn，endsAt>effectiveAt；企业／组endsOn/endsAt均null。UTC6和民事日往返按固定timezone校验。
- history为空时cursor必须null；超过25则拒绝。非空时严格连续revision降序，首项为min(atRevision,beforeRevision−1)，末页到revision1；只有真实第26行存在才给nextCursor，其beforeRevision等于本页最后项revision。withdrawnByRevision仅对publish可非null，必须大于该publish且≤atRevision，并由精确withdraw操作点查证明。不存在的future cursor／范围错配不能返回伪完整空页。
- 不把history item／最小receipt当作新写context。恢复完不会自动load其他scope、重新publish或丢弃草稿；用户要新写必须明确fresh detail／preview。

### 10.1 固定 tuple 摘要映射

`encode(x)` 只接受 null／boolean／安全整数／严格字符串／数组；数组编码为 `'[' + children.map(encode).join(', ') + ']'`，标量为标准 JSON 编码。没有对象、浮点、undefined、隐式键排序。SQL构造相同嵌套jsonb数组再取`::text`；UTC时间和UUID先规范成合同字符串。禁止NUL和不合法Unicode；两端都必须有中文、转义、null、边界整数测试向量。

```text
S(enterprise) = ['enterprise']
S(group)      = ['group', groupId]
S(personal)   = ['personal', workerId, employeeId, employeeAuthUserId]
C(context)   = [settingsVersion, timeZone,
                null | ['group',groupRevision] | ['personal',workerVersion,employeeVersion]]
choice        = ['inherit'] | ['disabled'] | ['value', valueTuple]
channel/location valueTuple = 原canonical数组
shift valueTuple            = published_selection | unplanned 字符串
break valueTuple            = [allowed数组,selection]
window valueTuple           = days整数
route targetTuple           = ['owner'] | ['delegate',delegateEmployeeId,delegateAuthUserId]
route valueTuple            = [correctionTarget,missingTarget,leaveTarget,workArrangementTarget]
cycle valueTuple            = ['weekly',weekStartsOn] | ['fortnightly',anchorDate]
                              | ['monthly'] | ['manual']
reminder choiceTuple        = ['disabled'] | ['enabled',afterMinutes,repeatMinutes,maxOccurrences]
reminder valueTuple         = [openSessionChoice,pendingReviewChoice,periodDueChoice]
R(rules)                    = [choice(allowedChannels),choice(locationScope),choice(shiftSource),
                               choice(breakTypes),choice(correctionWindow),choice(reviewRouting),
                               choice(timesheetCycle),choice(reminders)]
F(references)               = [null | ['group',groupActive] | ['personal',workerActive,employeeActive],
                               [[locationId,version,active],...],
                               [[category,employeeId,employeeAuthUserId,employeeVersion,active],...]]
commonCommand               = [siteId,S(scope),action,operationId,expectedRevision,reason]
K(save_draft)               = commonCommand追加[C(expectedContext),R(rules)]
K(publish)                  = commonCommand追加[sourceDraftRevision,effectiveOn,endsOn,previewFingerprint]
K(withdraw)                 = commonCommand追加[publishedRevision]
commandFingerprint          = SHA256_UTF8(encode(['attendance-operational-rule-command-v1',actualActor,K(command)]))
rulesFingerprint            = SHA256_UTF8(encode(['attendance-operational-rule-values-v1',R(rules)]))
referenceFingerprint        = SHA256_UTF8(encode(['attendance-operational-rule-references-v1',
                                                siteId,S(scope),C(context),F(references)]))
previewFingerprint          = SHA256_UTF8(encode(['attendance-operational-rule-publish-preview-v1',
                              siteId,S(scope),headRevision,sourceDraftRevision,rulesFingerprint,
                              referenceFingerprint,effectiveOn,endsOn,effectiveAt,endsAt]))
```

这里的“追加”是同一个平面外层数组的尾部元素，不能有的实现把commonCommand再嵌套一层。command已经包括site/scope，不因外层另有query而省略；实际actor不可由command传入。rules／reference／preview hash不是grant，也不能替代权限或锁内再次核验。保存command和规范tuple/hash都由SQL验证产生，不接收客户端宣称的“已认证hash”。

已获准进入 SQL／HTTP／UI 实施；是否通过本地验收另以实际报告为准，本文不更改原计划分母或完成计数。

## 11. 已核准的最小目录补充（240实施接线）

主线程2026-10-08核准第10／10.1节开始实施，迁移191。UI核查发现旧人员目录没有Auth，不能从姓名或员工ID猜测双身份；另需让负责人找到换绑前尚未生效的个人发布并安全撤销。仅增加下列当前owner只读目录，不依赖其他委托模块开关，不修改旧目录；组和地点仍复用已有25+1目录。

```ts
type CatalogQuery =
  | {siteId:SiteId;mode:'catalog';catalog:'workers'|'routes';afterId:UUID|null}
  | {siteId:SiteId;mode:'catalog';catalog:'saved_personal';afterScope:Extract<Scope,{kind:'personal'}>|null};
type CatalogData =
  | {kind:'catalog';catalog:'workers';items:{workerId:UUID;workerName:string;employeeId:UUID;employeeAuthUserId:UUID}[];nextId:UUID|null}
  | {kind:'catalog';catalog:'routes';items:{employeeId:UUID;employeeName:string;employeeAuthUserId:UUID}[];nextId:UUID|null}
  | {kind:'catalog';catalog:'saved_personal';items:{scope:Extract<Scope,{kind:'personal'}>;revision:PositiveRevision;updatedAt:Instant}[];nextScope:Extract<Scope,{kind:'personal'}>|null};
```

将CatalogQuery并入Query、CatalogData并入Data；Result其他字段不变，canWrite恒false、receipt恒null。目录必须GET、每次真实当前owner核验；新写关闭后仍能读取安全撤销所需目录，但原actor失去owner只能recover，不得读目录。

workers列同商户active worker且关联同商户status=active、有真实非null Auth的employee，按workerId升序；routes列同商户status=active且有真实Auth的employee，按employeeId升序，不声明拥有审批授权。名称来自已有display_name，1..120 Unicode字符（不为旧标签做silent trim）；仅展示，不作为身份。目录不宣称当前暂停或职责授权可用，保存／核准仍重验状态和身份。只取25+1、最多返回25，nextId是该页末ID且仅第26行存在时有值，不累计全表。

saved_personal按保存scope的固定tuple序列字符串，以数据库C排序及相同JS字符串序升序；afterScope必须personal且生成相同内部key。建立对应(merchant_id,scope.kind,stream_key COLLATE C)索引；只列scope、revision、updatedAt，不从当前绑定倒填旧姓名／Auth。nextScope仅第26行存在时返回末项scope。所有cursor都只是定位条件，不能作为授权。不存在的旧personal scope仍按detail身份／stream规则拒绝，不凭目录伪造当前context。

本补充只解决实际配置／安全撤销的可达性，不加全员影响分析、名册导出、授权或其他运行时规则消费。

## 12. 已核准的本次明确拒绝结束（仅浏览器内存证明）

主线程核准一项有限可用性补充：客户端已经先保存完整原意图并发出**唯一一次 POST**，且在其当前有效 Auth／scope lease 内收齐严格 JSON 错误、固定安全文案、匹配 HTTP status／code 时，仅以下五种错误可以产生不持久化的“本次明确未写入”证明：`attendance_operational_rule_changed`、`attendance_operational_rule_disabled`、`attendance_operational_rule_not_found`、`attendance_operational_rule_future_required`、`attendance_operational_rule_overlap`。后两项经主线程核对191的发布区间和锁后时间检查，防止正常的跨生效点或日期重叠拒绝永久锁住本浏览器。

依据191的真实控制流：这些错误及所调用 context／references／preview helper 的同码拒绝均发生在首条新事实 INSERT 之前；原号命中先返回已保存回执。写入后的 checker、receipt、响应校验不以这五个码报告成功后的异常；Node 成功响应校验失败统一为 `attendance_operational_rule_invalid`。此结论不推广到其他错误，也不把 HTTP 409／403／404 本身当成证明。

- Client state 新增 `canEndRejectedAttempt:boolean`，方法 `endRejectedAttempt():boolean`。UI 仅在该内存证明仍有效时显示“结束本次已拒绝尝试”，用户须明确确认；不自动结束、不自动重读、不自动再 POST。
- 证明绑定本实例的实际 site／Auth、generation、完整不可变原 command／query／fingerprint 和 exact 原 storage bytes；不能从 localStorage 或 GET 响应重新制造。执行时必须当前身份未变、没有 in-flight、证明仍指向同一原意图、storage 前后精确 CAS 一致；否则不删除。成功只清这一已拒绝的本地原号，同时清空 detail／preview／新写上下文，后续只能由用户显式 fresh 读取后重新核对。
- 隐藏、关闭、暂停、Auth／scope／requester 变更、initialize、开始新的 transport 或任何 transport 异常均撤掉该内存证明，但保留未确认原号。`GET recover` 返回 null、回执不匹配、冲突、鉴权失败、invalid、超时、网络中断、坏／超大／迟到响应都不能启用此动作。
- 证明不会持久化；刷新后只能原号 GET 恢复，即使旧浏览器此前曾收到明确拒绝也不能从保存文本推断未写入。本补充不增 SQL 操作、不改回执或权限协议、不改变已成功的事实与历史。
