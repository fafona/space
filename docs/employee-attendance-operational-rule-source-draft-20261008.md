# 241 单 worker 八字段来源：有限实施草案

状态：241有限来源实现已获批准；下列ABI及tuple冻结，预留新迁移192，尚未运行数据库。240 台账只保存配置与核准发布；本包也不等于 C07 八字段已被业务消费。旧打卡、申请、审批、周期、提醒及保存归档均不修改。

## 1. 一个私有来源入口，不增加业务权限

建议沿台账合同第8节的签名：

```sql
faolla_attendance_operational_source_v1(
  p_site text, p_worker uuid, p_employee uuid,
  p_employee_auth uuid, p_at timestamptz
) returns jsonb
```

第一版限定现有绑定真实员工/Auth 的 worker：五个参数均非空，site/UUID/时刻严格验证，`p_at` 在现有考勤支持的 2000–2100 范围内。无 membership 的独立 worker 不以假 Auth 或宽松 null 分支加入本版；其未来独立身份协议需显式接入。此限制只约束新私有来源入口，不改变任何旧入口。

调用者须先完成所属业务真实身份、动作及通路授权；写入调用者先取得 merchant SHARE、settings UPDATE，再取得 worker/employee 所需锁。helper 不升级已有 SHARE 为 UPDATE，不接受浏览器给出的“已授权”布尔值、owner 标记或 GUC。不新增浏览器、anon、authenticated、service_role 可直接执行的来源 RPC；全部私有函数撤销这些角色的 EXECUTE。

helper 自己在同一事务核对 `worker.merchant/id/employee_id` 与 `employee.merchant/id/auth_user_id`，不能把输入旧 Auth 替换成当前 Auth。来源不替代 paused/role/employment/location/credential/同号恢复等原业务门槛。原号恢复、既有结束动作和读取旧归档不得重新调用“当前来源”改变保存依据。

`p_at` 是调用者锁后选定的本次真实业务时刻，不是浏览器可任选的历史授权时刻。此入口回答“当前完整配置在该业务时点选中的来源”，不承诺重建后来已取消的历史分组；历史使用必须读当时原子保存的 proof。

## 2. 建议 exact 来源输出

外层只九键，不带姓名、原因、GPS、附件、角色目录或全员数据：

```ts
type Source = {
  protocol: 'attendance-operational-rule-source-v1';
  siteId: SiteId;
  workerIdentity: {
    workerId: UUID; employeeId: UUID; employeeAuthUserId: UUID;
    workerVersion: Revision; employeeVersion: Revision;
  };
  at: Instant;
  settingsRef: { version: Revision; timeZone: string };
  groupAssignmentRef: GroupAssignmentRef | null;
  layers: { enterprise: Layer | null; group: Layer | null; personal: Layer | null };
  baselineCorrectionPolicyRef: BaselinePolicyRef | null;
  sourceFingerprint: Hash;
};
type GroupAssignmentRef = {
  assignmentId: UUID; revision: 1 | 2; operationId: UUID;
  groupId: UUID; currentGroupRevision: Revision;
  workerId: UUID; employeeId: UUID;
  savedWorkerVersion: Revision; savedSettingsVersion: Revision;
  timeZone: string; startsOn: Day; endsOn: Day | null;
  fromAt: Instant; toAt: Instant | null;
};
type Layer = {
  scope: Scope; operationId: UUID; revision: Revision; context: Context;
  effectiveAt: Instant; endsAt: Instant | null;
  rulesFingerprint: Hash; referenceFingerprint: Hash;
  rules: OperationalRules; references: References;
};
type BaselinePolicyRef = {
  operationId: UUID; revision: Revision; recordedAt: Instant;
  submissionWindowDays: number; timeZone: string;
};
```

`Scope/Context/References/OperationalRules` 原样复用240/239 exact定义；不往旧 DTO 白名单混键。Layer 先用191完整条目/投影 checker 验证，再投影上述最小字段；不把当前 settings/context 覆盖保存 publication.context。groupAssignmentRef.employeeId 是124当时保存的身份，必须与当前 workerIdentity.employeeId 一致；124根本没有保存员工 Auth，故不在该 ref 中捏造此字段。当前 Auth 只在 workerIdentity 声明。

建议上限仍256KiB，最多三份32KiB规则；过大明确拒绝，不截断。指纹采用固定标量/数组 tuple，复用191 scope/context/rules/references映射；包含全部上述非 fingerprint 字段，不依赖对象键顺序，不含任意 readAt。Node 必须重算 SHA；纯 resolver 的 `candidateOnly:true/applied:false/authorityChecked:false` 保持原值。

每层 null 只表示有界完整查询证明没有在本时点生效的发布。身份变化、损坏索引/条目、超量、歧义、无法转换日期都不能映射成 null。baseline 为 null 明确表示旧政策缺失，不能解释成无限期。

## 3. 有界分组选择：最多六条候选，不取当前时区捷径

124保存每条 assignment 自己的时区、民事起止日和可空 employee_id；真实 writer 保证同worker未取消的民事日期区间不重叠。但不同保存时区的相邻日期仍可在 UTC 重叠。因此不能用当前 settings.time_zone 选一条组记录。

令 `D = p_at 的 UTC 民事日`、`L=D−2`、`U=D+2`，使用124现有 partial index `(merchant_id,worker_id,starts_on,ends_on) WHERE status<>'cancelled'`：

1. `starts_on < L` 反向取最近一条；必须先 LIMIT，再检查 ends_on，不能先按是否未过期过滤而扫过任意长历史。
2. `L <= starts_on <= U` 正向最多取六条：五个民事日依法最多五条，读到第六条是完整性/容量拒绝，不截为五条继续。
3. 每个候选调用124既有 assignment detail checker，最多读取其三条事实操作（原helper以第4条作拒绝哨兵），核保存身份、原时区、当前 ends_on 与最新 operationId。
4. 用127日首/129含尾日结束 helper 计算每条保存时区的半开 UTC 区间。两者自身使用民事 UTC 零点±36小时有界搜索，因此 D±2 覆盖所有可能命中的日期；更早于最近前驱的区间，按124真实 writer 的民事非重叠不变量已结束。
5. 零个命中才是无组；一个命中才进入组来源；第二个命中立即 ambiguous。命中身份不一致或当前组 inactive 明确拒绝，不能跳过它后宣称无组。

这是对旧台账合同第8节“至多2候选”的具体化修订：最多六条候选，最多两条命中即可检出歧义。主线程已同意此界限。这里依赖124受保护真实 writer 维持的非重叠不变量，并非数据库被超级用户任意篡改后的全表取证。源码/ACL/对应索引与日期helper依赖须在安装、重入、定向测试中固定检查；不能偷偷回退到130最多101条区间收集并声称常数点读。

## 4. 三层和旧独立政策的点读

- enterprise 固定 scope；group 只用上一步唯一保存 groupId；personal 只用本次当前 worker/employee/Auth 三元组组成191 stream_key。不得按 workerId 搜旧个人流再改标签；旧身份 publication 保持原样，不成为新身份的限制或授权。也不因一个旧 personal 流不匹配去扫描所有个人历史。
- 每个 stream 使用191 effective partial index，取 `effective_at <= p_at` 的最近一个未撤销 publication，再检查 `ends_at IS NULL OR ends_at > p_at`。个人不重叠保证最近项已过期即真正空档；不要把 ends_at 条件放到 LIMIT 前。不要翻历史25页或把“最近25操作”当生效规则。
- 对选中 publication 调191 `faolla_attendance_operational_rule_check_v1`，检查完整保存规则/引用/hash及严格派生索引；不从草稿取值，不以当前人员/地点版本重写保存 references。后续业务另核实际可用地点/处理人，失效引用不能自动替换为另一个人。
- baseline 从084的 policy partial index 按 `action='set_policy' AND recorded_at<=p_at ORDER BY recorded_at DESC,revision DESC LIMIT 1` 点读。校验保存 payload、command、时区及0..365天，再输出最小 BaselinePolicyRef；不携带锁期原因/范围。锁期仍由085/103各业务原检查独立执行。
- 不读/重写旧127、129四阈值来源，不把同名新字段宣称已经影响旧规则。

## 5. 解析与后续消费边界

单 worker 来源层不返回 canClock/canApprove/canSeal 或任何 grant。纯计算仍按个人→组→企业选择一般字段；locationScope 是所有已提供 value 集合与业务原通路可用地点的交集，不是覆盖扩权。correctionWindow 仍受独立原 baseline 的最短天数约束，保留其原时区/锚点语义；工作安排 retrospectiveDays 和请假不被暗中纳入此键。

没有任何新生效规则、或相应字段最终 unconfigured，future adapter 继续原业务行为；不能制造“缺少规则流”来阻断原成功请求。为调用现239纯 resolver 而需要 enterprise 全 inherit 文档时，只在适配层合成，并在 source.layers.enterprise 中仍保持 null，不能虚构 publication。纯计算得到的 disabled/value 也只有在各自批准的真实消费包接入后才生效。

实际后续接点及不能外包掩盖的改动：

| 后续包 | 真实接点 | 本来源包不完成的部分 |
| --- | --- | --- |
| 新开始/班次/休息 | SelfScheduleAdoption、LocationSchedule、PinSchedule、OnsiteSchedule 服务；134基础新开始入口；111/112原事件写入 | 同事务保存使用proof；break_start 在 INSERT 前决定 break_paid；PIN lease消费与正常收尾不变，不能临时改settings |
| 申请窗口 | correction self v3、094 revision self v1、103 missing/revise | 新提交固定最终截止和source；旧申请/审批/恢复只读保存依据，不重判逾期 |
| 处理路由 | 原各owner/delegate审批RPC、189补正授权、160/162/185相关授权 | 配置选择不是授权；真实grant、身份/地点/期限/代际逐动作核验；移交须独立明确操作 |
| 新周期 | PeriodClosureV2 preview/send、183 | 固定cycle版本和新选范围；不改既有periodId日期、确认、预算、历史归档；不自动发送 |
| 提醒 | 尚待新增默认关闭的服务端25条到期任务 | 来源固定/频控/原号/合法收件人/站内投递；helper不是调度器，不追溯补发 |

## 6. 建议本包验收与明确未覆盖

有限本地验收仅需：无发布可证明的继承；三层真实发布选择与地点交集/独立窗口纯投影；跨保存时区相邻组导致歧义拒绝；旧个人/assignment身份不重标记；过去多条索引仍只取前驱；未来/已撤/过期个人项不误选；同事务身份/发布锁一致；私有 EXECUTE拒绝；旧事实/函数/归档不变。

需验证六候选/每条三操作/三publication点读的实际查询计划，不用1000次RPC填历史、放宽超时或把截断数据当完整。241只交付真实来源与严格 Node 解析/投影，不标C07完成；四通路真实事件、申请截止、审批接手、周期采用、提醒仍分别待有限消费包交付。真实Auth、生产启用及试点也未由此证明。

## 7. 冻结 ABI、精确数值和摘要 tuple

192全部新函数使用 `faolla_attendance_operational_source_*`（入口为 `faolla_attendance_operational_source_v1`），不占191的 `operational_rule_` 前缀，保持191首装/重入的16函数计数不变。只新增私有函数，无表、公开HTTP、消费者或新增业务权限。

所有 revision/version 均为1..9007199254740990正安全整数。assignment.revision仅1或2；operationId指当前最后一条assign/end操作号，rev1等于assignmentId，rev2不等于assignmentId。rev2的endsOn/toAt必须非null；rev1可以有固定尾日或开放尾日。savedWorkerVersion/savedSettingsVersion不得高于当前版本。Layer.context.settingsVersion不高于settingsRef.version；group context.groupRevision不高于currentGroupRevision；personal context的两版本不高于workerIdentity的当前两版本。层scope必须分别为enterprise、当前唯一groupId、当前精确三元组。

所有Instant为规范UTC六位小数；at在 `[2000-01-01T00:00:00.000000Z,2101-01-01T00:00:00.000000Z)`。Day为2000..2100真实民事日；fromAt/toAt按保存时区的127/129 helper计算，并满足fromAt<=at<toAt（开放尾日除外）。Layer同样effectiveAt<=at<endsAt，个人endsAt必非null，其余层endsAt必null。baseline.recordedAt<=at，submissionWindowDays为0..365整数。baseline本身不含全局锁期/理由，不给予审批权限。

沿240既有映射：`S(scope)`、`C(context)`、`R(rules)`、`F(references)`，不得自行变更四路由/三提醒顺序。

```text
I = [workerId, employeeId, employeeAuthUserId, workerVersion, employeeVersion]
T = [settingsRef.version, settingsRef.timeZone]
G = null | [assignmentId, revision, operationId, groupId, currentGroupRevision,
            workerId, employeeId, savedWorkerVersion, savedSettingsVersion,
            timeZone, startsOn, endsOn, fromAt, toAt]
L = null | [S(scope), operationId, revision, C(context), effectiveAt, endsAt,
            rulesFingerprint, referenceFingerprint, R(rules), F(references)]
B = null | [operationId, revision, recordedAt, submissionWindowDays, timeZone]
sourceTuple = ['attendance-operational-rule-source-v1', siteId, I, at, T, G,
               [Lenterprise, Lgroup, Lpersonal], B]
rulesTuple = ['attendance-operational-rule-values-v1', R(rules)]
referenceTuple = ['attendance-operational-rule-references-v1', siteId,
                  S(scope), C(context), F(references)]
```

三个fingerprint分别对对应tuple使用UTF8 SHA256。PG使用`jsonb::text`；JS只序列化null/string/boolean/safe-integer/递归数组，以 `, ` 分隔数组项，字符串用JSON.stringify，不接受对象、不受原对象键序影响。sourceTuple首项已是独立domain，不另加第二层摘要前缀。

私有getter错误冻结为：`attendance_invalid_request`（参数）、`attendance_settings_required`、`attendance_operational_source_not_found`、`attendance_operational_source_identity_changed`、`attendance_operational_source_ambiguous`、`attendance_operational_source_group_inactive`、`attendance_operational_source_too_large`、`attendance_operational_source_invalid`。被调用旧checker的资料损坏错误统一归source_invalid；不吞数据库连接/取消/锁超时等运行异常，也不返回空成功。
