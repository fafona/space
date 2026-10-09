# 242 四字段在线打卡消费：实现边界与 ABI

日期：2026-10-08。状态：主线程已批准按本文实施，预留新迁移193；ABI及第10节tuple/错误冻结。本文件尚不是产品完成或数据库验收记录。写本文时未改 SQL、旧事件、归档或前台，未启动环境。240 是核准台账，241 是私有来源；两者均不能代替本包的实际消费，更不能据此把 C07 八字段标为完成。

本包消费 `allowedChannels / locationScope / shiftSource / breakTypes`，四通路为 self、location、pin、onsite。申请窗口、审批路由、周期生成、催办不在本包内。原始事实仍只有既有动作和 paid/unpaid，不增加工资、迟到、缺勤含义。

## 1. 已核实的断点和最小替换范围

| 当前实现 | 实际断点 | 本包处理 |
| --- | --- | --- |
| 111 `faolla_attendance_self_v1`，127–133行 | `break_start` INSERT 直接取 `settings.web_break_paid`；旧回执先于新 CAS 判断 | 抽同签名私有 core；原 wrapper 传 legacy-null，新协议在 INSERT 前核定类型 |
| 112 `faolla_attendance_pin_clock_v1`，33–40、70–90行 | 先消费 PIN lease，业务子事务才写事件；类型仍取企业设置 | 新检查只能在原业务子事务内；新增业务拒绝按原形式返回 `{error}`，不能回滚已经消费的 lease |
| 108 `faolla_attendance_onsite_clock_v1`，141–193行 | 先原号，再校验 QR、终端、nonce、地点、雇佣；类型在188行 INSERT | 原 HMAC、45秒窗口、nonce、terminal/current membership 全保留；逻辑 channel 不从 raw `web` 猜测 |
| 072 private `faolla_attendance_location_clock_v1`，89–169行；113公开v2，69–137行 | 内核 INSERT 类型；外层保存 notice command，另有 safeFinish INSERT | 两层各抽 private core、显式传新意图；定位 assertion、notice、record-and-review、safeFinish 原门槛不变 |
| 143 `faolla_attendance_pin_schedule_v1`，471–519行 | 自己直接 INSERT clock_in，不经过112；否则会留下旧选班旁路 | 仅在 finish 后、业务子事务内的 fresh clock_in 分支增加旧协议门闸；不把它重写成另一份新 writer |

因此前向替换的旧函数精确为以上 **6 个**。111、112、108、072、113 提取成5个私有共享 core；143增加一个门闸。旧签名、OID、owner、ACL、原返回形状不变；只编辑新迁移，不改历史迁移文件。旧063、077、107同名定义已被后续版本替换，不再各造一份。

137/141/142/144选班 wrapper 经前五个 core，自然受控；不修改旧选班 DTO、旧采用记录或旧四阈值定义。新选班 recorder 复用167的 slot checker、144的 `faolla_attendance_shift_plan_adoption_v1`、现有 receipt checker/INSERT guards，写入原 relation/adoption 两表。不能先新打卡、再把同号交给旧 wrapper：后者已经是 replay，不会为历史回执补绑。

133 的 `faolla_attendance_bind_shift_rules_v1` 是 best-effort：381–404行故障可留下 unverified 或保留打卡成功。它可以继续原样调用，但**不能充当新四字段强制检查**。新四字段旁证必须与本次事件一起成功或一起回滚；旧133失败语义不被改成“所有旧规则都强制成功”。

## 2. 生效门闸：数据库有事实，旧入口不能绕过

主线程已裁定新增独立、小型 append-only activation ledger，默认没有记录即 off。不向旧 settings DTO 加键，不用 GUC、HTTP header、浏览器布尔值或“已有191发布”推断启用。

### 2.1 最小 owner activation 合同

新表 `merchant_attendance_operational_punch_activations`：

```ts
type ActivationItem = {
  siteId: SiteId; operationId: UUID; revision: Revision; actorId: UUID;
  action: 'activate'|'deactivate'; reason: string; recordedAt: UTC6;
  commandFingerprint: Hash;
};
type ActivationQuery =
  {siteId: SiteId; mode: 'current'} |
  {siteId: SiteId; mode: 'recover'; operationId: UUID};
type ActivationCommand = {
  siteId: SiteId; operationId: UUID; action: 'activate'|'deactivate';
  expectedRevision: NonnegativeRevision; reason: string;
};
type ActivationResult = {
  protocol: 'attendance-operational-punch-activation-v1'; siteId: SiteId;
  actorId: UUID; readAt: UTC6; canActivate: boolean; canDeactivate: boolean;
  current: ActivationItem|null; receipt: ActivationItem|null;
};
```

RPC `faolla_attendance_operational_punch_activation_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_activate boolean default false)`；API `/api/merchant-enterprise/attendance/operational-punch-activation`。POST body exact `{query,command}`，query必须 `current`；GET recover只返回原操作者自己的最小 receipt，`current=null`、两可写标记false。失去owner的原操作者仍可依真实Auth＋site＋原号恢复，不获得列表/配置权限；须提供不依赖当前owner的恢复入口。

当前 canonical owner显式activate/deactivate；merchant SHARE→settings UPDATE串行，先同号、再CAS。revision 1..9007199254740990；命令expectedRevision为0..上限−1。reason沿191的trim不改变正文、1..200 Unicode码点、拒C0/C1。重做当前相同状态但不同号明确 unchanged；同号同完整body返回原receipt，不追加一行。featureoff可读取/安全deactivate/recover，不可activate；暂停的企业不可activate，但可deactivate。

表主键 `(merchant_id,operation_id)`，唯一 `(merchant_id,revision)`；最新记录走该索引 DESC LIMIT1。保存完整 command、实际 actor、严格 tuple hash；no UPDATE/DELETE/TRUNCATE、RLS及所有直接写权限撤销。无历史补行。activate不发角色、不改变员工权限，不自动发布任何191规则。

### 2.2 旧协议门闸精确行为

所有判断在原身份/原号处理后、fresh INSERT之前：

| 请求 | DB当前激活 | 处理 |
| --- | --- | --- |
| legacy-null fresh clock_in，包括143旧PIN选班 | on | `attendance_operational_punch_protocol_required`，零事件；只能用户显式进入新协议 |
| legacy-null fresh clock_in | off | 完整原路径；不补新来源 |
| legacy-null break_start，当前start有新session旁证 | on/off均同 | protocol_required；不能用旧企业类型绕过已经固定的休息政策 |
| legacy-null break_start，当前start无新旁证 | 任意 | 原旧班次路径；不临时采今天规则、不阻旧班次休息 |
| break_end/clock_out/定位safeFinish | 任意 | 原身份/序列/状态/凭证/结束地点检查；不检查新通路或地点规则，不强制新规则可读 |
| 旧格式原号 GET/replay | 任意 | 原协议、原 actor/command 校验，不重新采来源、不转成新意图、不补旁证 |

新协议 fresh clock_in 同时要求 DB on＋服务端新开关on＋原通路允许新开始。服务开关off但DB仍on时明确拒新开始，**不悄悄降级到旧入口**。已按新规则开始的 session，其新协议 break_start 读取固定政策，不依赖今日start开关；原平台是否允许新休息、当前身份/credential检查仍生效。

旧同号若碰到一个新协议创建的event，legacy写重放不能凭旧body较弱比较冒充完整新意图；返回 protocol_required并保留编号，新recover核验完整新command。纯旧event没有此新限制。

发布/回退安排必须保留新recover和managed-session休息界面，直到所有已建立的新session可安全收尾；不能关闭flag就删除新endpoint或部署一个完全不认识新pending的旧前端。此处是默认关闭的候选实施约束，不在本文开启任何真实商户。

## 3. 四个新服务 RPC：原通路认证不统一伪造

以下参数次序冻结。所有public入口仅service_role EXECUTE；来源/core/proof/recorder函数连service_role也不得直接EXECUTE。服务端构造布尔门闸，不接受HTTP同名输入。函数名均使用独立 `operational_punch_` 前缀，不碰191/192函数计数前缀。

```sql
faolla_attendance_operational_punch_self_v1(
 p_site text,p_auth uuid,p_query jsonb,p_command jsonb default null,
 p_allow_new_sessions boolean default false,p_allow_operational_start boolean default false,
 p_allow_schedule boolean default false,p_bind_rules boolean default false) returns jsonb;

faolla_attendance_operational_punch_location_v1(
 p_site text,p_auth uuid,p_expected_worker uuid,p_query jsonb,p_command jsonb default null,
 p_assertion jsonb default null,p_allow_new_sessions boolean default false,p_require_clock boolean default false,
 p_allow_operational_start boolean default false,p_allow_schedule boolean default false,
 p_bind_rules boolean default false) returns jsonb;

faolla_attendance_operational_punch_pin_v1(
 p_site text,p_terminal uuid,p_secret_hash text,p_no text,p_lease uuid,p_verified boolean,
 p_query jsonb,p_command jsonb default null,p_allow_new_sessions boolean default false,
 p_allow_operational_start boolean default false,p_allow_schedule boolean default false,
 p_bind_rules boolean default false) returns jsonb;

faolla_attendance_operational_punch_onsite_v1(
 p_site text,p_auth uuid,p_claims jsonb,p_query jsonb,p_command jsonb default null,
 p_allow_new_sessions boolean default false,p_allow_operational_start boolean default false,
 p_allow_schedule boolean default false,p_bind_rules boolean default false) returns jsonb;
```

`p_query` exact union：`{mode:'prepare'}` 或 `{mode:'recover',operationId:UUID}`。带command只允许recover形状且operationId严格相等；prepare永不写事件。site由独立参数和HTTP绑定，不能内外冲突。recover不采192、不列候选、不把receipt当新CAS；不存在原号返回 receipt=null，不等于已证明未提交。

保留四种原clock结果分别嵌套，禁止造一个宽松统一clock对象：self沿144的clock，location沿LocationClock，pin沿PinClock，onsite沿OnsiteClock。原回执的actor_employee_id不被标成Auth；PIN requestActorAuth始终null，当前membership Auth仅用于192的真实目标身份，不伪称PIN完成了Auth登录。

### 3.1 HTTP 入口及真实权威 preparation

API分别为 `/api/merchant-enterprise/attendance/operational-punch-self`、`operational-punch-location`、`operational-punch-pin`、`operational-punch-onsite`。

- self/location/onsite：GET query为siteId＋mode，recover另带operationId；location另带原expectedWorkerId。真实既有Auth/password/角色门槛不变。self POST body exact `{siteId,query,command}`；location exact `{siteId,query,command,position,positionFailure}`；onsite exact `{siteId,query,command,token}`。location两定位字段及onsite token沿原parser，不接受任意claims JSON。没有secret或latitude的新query参数。
- pin：**prepare/recover也是PIN认证POST，不称零POST/普通GET**。body exact `{workerNo,pin,query,command}`，site/terminal/secret从原合法唯一terminal cookie获取，不是新增body字段；每一次仍真实 begin→KDF→finish。PIN、secret、lease、派生值不进入command、storage、日志或旁证。
- 新location服务沿 `executeAttendanceLocationClock` 的prepare→定位摘要验证→私有assertion路径，仅替换最后RPC dispatch；当前通知/围栏版本和safeFinish不变。摘要允许 record-and-review 的旧原因不被新规则误当强制GPS拒绝。
- 新onsite沿 `verifyOnsiteToken` 验HMAC后才传可信claims；prepare/recover无QR，写操作仍需新鲜同商户/地点/终端claims和原nonce校验。
- 不导出匿名 `workerId→192source` HTTP；prepare只能原通路已证明的本人。无membership worker维持原路径，本包不给假Auth、nullable身份或新的独立worker权限。

实现时HTTP channel-specific transport的**既有exact键表照原parser复用**，不是上述简写允许删字段；新公共query/command/choice/result严格如下。四条服务均沿旧限流、Origin、no-store、大小/时限策略，最多采用256KiB响应，超限拒绝不截断，不抬高原通路更小的限额。

## 4. exact 新命令、prepare与回执

```ts
type Selection = null | {slotId: UUID; revision: Revision};
type PunchCommand<C> = {clock: C; choice: Choice};
type Choice =
 | {kind:'start'; expectedPolicyFingerprint:Hash; selection:Selection}
 | {kind:'break'; startEventId:UUID; expectedSessionFingerprint:Hash; breakType:'paid'|'unpaid'|null}
 | {kind:'legacy_break'}
 | {kind:'finish'};
```

`C`就是该channel当前严格非secret clock意图：self的 `AttendanceSelfCommand`；pin的 `PinClockCommand`；onsite的 `OnsiteCommand`；location的 **`AttendanceLocationClockIntent` 而非含原始坐标的Command**。原operationId/CAS/worker/location/notice/safeFinish键一项不少。location新RPC接完整10键intent，内部调用旧113 core时才剥expectedWorkerId并与独立p_expected_worker严格相等；GPS仅走上节独立transport→服务器assertion，绝不进入command/hash/storage。start只能clock_in；break/legacy_break只能break_start；finish只能break_end/clock_out（含原safeFinish）。legacy_break只适用于当前真实start无session旁证，不能浏览器选择“忽略规则”。

break字段规则：已固定 `selection='explicit'` 时breakType必须是允许集合里的明确值；fixed或继承/disabled的企业基线时必须null，由SQL计算实际paid。重复原号把choice也作为完整hash的一部分；更换 paid→unpaid、selection或policy fingerprint均冲突，不能只按oldclock的action/location视为同一次。

```ts
type FourFields = Pick<OperationalRulesPreview['fields'],
 'allowedChannels'|'locationScope'|'shiftSource'|'breakTypes'>;
type Origin = {layer:'enterprise'|'group'|'personal'; operationId:UUID; revision:Revision;
 effectiveAt:UTC6; endsAt:UTC6|null; rulesFingerprint:Hash; referenceFingerprint:Hash};
type LegacyBasis = {settingsVersion:Revision; webBreakPaid:boolean; scheduleEnabled:boolean};
type Policy = {checkedAt:UTC6; policyFingerprint:Hash; sourceFingerprint:Hash;
 workerIdentity:Source192['workerIdentity']; locationId:UUID; locationVersion:Revision;
 activationRevision:Revision; fields:FourFields; origins:Origin[]; legacy:LegacyBasis};
type Session = {startEventId:UUID; operationId:UUID; startSequence:Revision; occurredAt:UTC6;
 workerId:UUID; employeeId:UUID; employeeAuthUserId:UUID; actorAuthUserId:UUID|null;
 channel:Channel; locationId:UUID; locationVersion:Revision; activationRevision:Revision;
 sourceFingerprint:Hash; policyFingerprint:Hash; sessionFingerprint:Hash;
 fields:FourFields; origins:Origin[]; legacy:LegacyBasis; selection:Selection};
type Operation = {operationId:UUID; eventId:UUID; action:Action; channel:Channel;
 workerId:UUID; employeeId:UUID; employeeAuthUserId:UUID; actorAuthUserId:UUID|null;
 startEventId:UUID; sequence:Revision; recordedAt:UTC6; commandFingerprint:Hash;
 sessionFingerprint:Hash|null; sourceFingerprint:Hash|null; breakPaid:boolean|null};
type PunchResult<C> = {protocol:'attendance-operational-punch-v1'; channel:Channel;
 siteId:SiteId; readAt:UTC6; clock:C; policy:Policy|null; session:Session|null;
 choices:SelfScheduleChoices|null; association:SavedAssociation|null; adoption:SavedAdoption|null;
 operation:Operation|null; replayed:boolean; canStart:boolean; canBreak:boolean; canFinish:boolean};
```

`FourFields`仅复用239四个field的exact state/value/sources/trace结构，不复制其 `applied:false` 容器，也不向浏览器泄露其余四字段的路由/Auth目录。origins最多3，enterprise/group/personal顺序，无姓名/原因。`choices/association/adoption`分别复用当前严格选班形状与channel校验，不能用any。session与clock当前真实open start不一致必须拒绝，不显示成当前政策。

prepare：off状态且DB on才产生新Policy；working/break状态只返回当前固定Session或明确null旧班次，不取今天规则重标旧session。prepare无operation，replayed=false。recover：policy/session/choices/association/adoption均null，所有can*为false，只保留原clock+最小operation；写回执同样不能授新写，policy/choices为null，可带本次clock_in保存的session/association/adoption以严格校验来源。operation匹配原号才可清相同存储字节，必须再显式prepare才能新写。recover不会把同商户另worker或另一终端的receipt带回来。

RPC内部返回exact `{result:PunchResult, source:Source192|null}`。当result带Policy或Session时source必非null：Policy用本次来源，Session用保存source_ref点查复原来源；供服务严格parse/recompute整源和四字段，再删除后返回浏览器。不得调用当前192重算saved-session；recover的source固定null。对仅有旧receipt的新recover，operation=null且不移除未知的新pending；旧pending继续原协议恢复，不自动升级。PIN known业务拒绝仍只返回exact `{error:code}`，这不是成功raw envelope，服务必须先识别再parse成功。

### 4.1 CAS 不错误绑定时钟

192 sourceFingerprint包含真实`at`，预览与点击提交必然可能不同；不得要求两次整个sourceFingerprint相等。新 `policyFingerprint`使用241 source tuple的全部I/T/G/三层L/B，只去掉**顶层本次at**，同时加入channel、实际默认/终端locationId与locationVersion、activationRevision和LegacyBasis。层发布时间/有效期、G的from/to、baseline.recordedAt一律保留，不做字符串删所有日期。

```text
policyTuple = ['attendance-operational-punch-policy-v1',
 siteId, channel, locationId, locationVersion, activationRevision,
 I, T, G, [Le,Lg,Lp], B,
 [legacy.settingsVersion,legacy.webBreakPaid,legacy.scheduleEnabled]]
```

I/T/G/L/B精确复用241§7的scalar-array tuple；SHA256仍为PG jsonb数组::text与JS递归数组`, `分隔的UTF8一致算法。newwriter在所有原锁/检查后，以**最终将写event的同一毫秒timestamp**采192，重新检查半开有效区间和policyFingerprint。跨生效/到期、身份/分组/地点/独立配置变化均changed；不把旧checkedAt作为当前授权。

commandFingerprint包含协议、site、逻辑channel、真实actor（PIN null）、目标完整worker/employee/Auth、完整clock tuple及Choice tuple；各channel clock tuple沿其原exact字段固定顺序，不能JSON对象随意stringify。sourceFingerprint保留实际at，新operation同时绑定真实event和session；恢复不重新计算今天policy。

## 5. 三张新表：不另存大source body、不提高现有预算

除activation ledger外仅两张append-only事实旁证表：

1. `merchant_attendance_operational_punch_sessions`：PK start_event_id；unique(site,worker,start_operation_id)。保存site/startEvent/sequence/occurredAt/channel、worker/employee/Auth、actorAuth（PIN null）、activation operation/revision、`source_ref`、sourceFingerprint、policyFingerprint、FourFields、origins、LegacyBasis、selection、sessionFingerprint、recordedAt。
2. `merchant_attendance_operational_punch_operations`：PK event_id；unique(site,worker,operation_id)。保存上节Operation全部字段＋完整新非secretcommand；FK event/start session（legacy_break/finish无新session时start仍引用真实旧clock_in、sessionFingerprint/sourceFingerprint为null）。额外保存origin_ref，精确引用原PIN receipt/onsite nonce binding/location notice+summary/self origin；不复制secret/token/GPS。

`source_ref` exact：`{protocol:'attendance-operational-punch-source-ref-v1',siteId,workerIdentity,at,settingsRef,groupAssignmentRef,layers,baselineCorrectionPolicyRef,sourceFingerprint}`；除layers外沿192原保存值。layers exact3键，每项null或 `{operationId,revision}`。重建每层只按191不可变operation PK点查、strict check原publish item和hash，不从现在publication索引重选、不重算现在group assignment或Auth。G保存完整当时ref以免后续end/cancel改写历史时点。

这样最多3个规则publish点查＋1个baseline点查＋固定小JSON，不为每个班次复制32KiB×3 source正文。原191保存事实、124历史、084policy不删。source_ref上限16KiB、session整行JSON上限32KiB、operation整行JSON上限16KiB（UTF8实际字节，不是JS字符数）；以上上限须以最大合法fixed-shape样本证明足够，不允许截断或添加自由文本。原133的8/64MiB及149/183的64MiB预算一项不变，未把新增旁证伪称零存储成本。

两表no UPDATE/DELETE/TRUNCATE、RLS、所有直接写权限撤销；insert guard及deferred完整校验绑定真实event行动/时间/actor/sequence、旧通路origin、完整command hash、source/session hash、break_paid及旧relation/adoption。所有新旁证必须在原事件INSERT所属同一业务子事务内写完，故障不能留下成功event或孤立proof。

当前start定位复用087现有 `attendance_report_clock_in_idx(merchant_id,worker_id,occurred_at,sequence) WHERE action='clock_in'`，倒序LIMIT1；与当前最后event/state及sequence核对，再按PK查session。不能向后线性扫描所有休息，也不能给历史start补新session。本包无需为此另建全历史索引。

## 6. 原身份与锁、时钟、收尾

新protocol在进入任何inner settings SHARE/worker锁前取得merchant SHARE→settings UPDATE；随后沿原通路身份/role/worker/terminal锁序。192只重入锁，不在取得worker后将settings SHARE升级为UPDATE。此处需要针对真实旧员工停用/终端凭证路径核对，不能只凭列表宣称全仓锁序已证明。

PIN新RPC同样先取得新protocol的配置锁，再沿真实finish；**finish消费在业务subtransaction之外**。所有source、规则、choice、sidecar拒绝在finish之后的业务subtransaction内返回已枚举安全error；不在最外层catch中把它重新raise致使lease回滚。认证/KDF原流程未通过不得读取source或选择目录。读请求同样是实际认证和lease消费，不伪称数据库完全只读。

继承/disabled含义沿已批准边界，不另造规则：allowedChannels disabled不增加通路限制；locationScope各value集合共同交集，disabled不解除别层；shiftSource disabled等同unplanned但保留来源；breakTypes disabled/全inherit取独立企业webBreakPaid。**新managed session将本次该独立值和版本固定**，后续改规则/企业休息类型不改变其休息政策；没有新session旁证的旧班次继续旧行为。

allowedChannels/locationScope仅约束fresh clock_in，不在break_start或结束时再次拒绝一个已固定班次。新break_start按session类型约束，仍不扩原通路当下资格。任何失权/换绑/错误凭证不因持有source_ref而获准；原safeFinish/同身份暂停补尾保留原来可行范围，不声称所有被停用身份都可强行打卡结束。

无规则发布、全部inherit不伪造发布；activated新start可保存空layers＋真实独立基线，明确unconfigured。没有新源或source ambiguous/identity_changed不是“继承默认”；freshstart failclosed、旧session finish/recover不访问这条新来源。

## 7. 真实UI如何取得并固定选择

四个新服务不是孤立示例页。接实际Self、Location、PinClock/PinScheduleClock、OnsitePhone/OnsiteScheduleClock的单一writer host；原基础接口和选班接口均检查DB激活/新协议门闸，不能一个按钮走新限制、另一个按钮走旧core。旧pending优先按原版本恢复，恢复完不得自动发新POST；新pending也不得被旧宿主覆盖。

- self/location：显式prepare获得本人Policy或Session。location还保留原授权通知/定位步骤，生成服务器assertion后才显式提交。选published slot沿原有限±1日候选和strict publication身份；未选明确unselected，不自动最近匹配。shiftSource unplanned/disabled必须selection=null；unconfigured只沿实际旧schedule开关供给，不能因为新字段就启用未启用选班。
- PIN：`MerchantAttendancePinScheduleClock.tsx` 当前47–70行已具备“先验证PIN→本人候选→再显式提交”。替换其新协议分支后同时显示paid/unpaid选择；每次write再次完整begin/KDF/finish，不把先前prepare变成可转用授权token。PIN仍仅内存≤30秒、提交/隐藏/身份或terminal变化清掉；持久pending只保留非secret完整command，恢复必须重新输入PIN。候选与PIN lease不延时。
- onsite：`MerchantAttendanceOnsitePhone.tsx` 当前146–157行选班clock_in与break_start是不同分支，二者都要接新dispatcher。先Auth prepare选择，再扫45秒有效QR提交；选择耗时到期必须重扫，不延长QR或nonce。recover沿原Auth原号，不需保存或重发旧QR。相机帧/claims/token不写storage。
- 新explicit break给独立“带薪休息/不计薪休息”选择；fixed或legacy显示固定类型，不用默认勾选冒充explicit。每个页面只有一个活跃client；返回/隐藏/换Auth/换terminal/API实例同步撤销旧fetch/storage能力，晚响应不得清新原号。
- prepare点击、原号核对与业务提交分开；无自动punch/自动补选/轮询提交。确认后在fetch前先耐久保存完整意图；未知/坏JSON/超时保留；只有严格匹配同号同hash回执能清槽。

## 8. 归档与旧读者兼容，不伪造已保存来源

原raw event的 `break_paid` 仍是真实paid/unpaid；现有timesheet/period严格投影自然采用该布尔值，无须改旧工时计算。原raw `source`保持web/kiosk，四通路由保存origin+新channel旁证核验。

149 v1/186 delegated v2 artifact都是exact shape，**不能插新键或把旧body标记为有新证明**。本包保存的源在新session侧表，与startEventId/已存在period source中的真实event对应；历史固定artifact正文、SHA、sourceFingerprint完全不变。旧owner/self读取和导出仍按原artifact读取，不追读当前192。

本包不宣称旧portable artifact已经内嵌四字段来源。若需要在脱离数据库的period导出中携带此证明，必须后续显式新增归档版本/独立proof attachment协议，按固定event ID读取保存session/source_ref复原，不调用当前getter；旧v1/v2分支保留，64MiB预算不升。本包的数据库内使用证据和真实工时消费不因此省略，但不能把“可按ID核验”写成“旧归档已包含所有新字段”。这是明确兼容边界，不是改写历史归档的许可。

## 9. 迁移/实现拆分与有限实际验收

迁移为 `202610080193_merchant_attendance_operational_punch.sql`。最小对象为3新表、activation RPC、4新channel RPC、5新private cores及一组严格validate/hash/resolve/preinsert/proof/recorder helper；六处旧函数前向替换精确见§1。没有新worker、角色、Auth、后台任务、规则消费GUC、旧事件UPDATE、预算扩容或全员扫描。

安装先校验这6个旧函数的已知定义/owner/config/ACL，保存pin；只允许已核准差异。新private revoke public/anon/authenticated/service_role；新public只grant service_role。重入比定义/ACL/trigger，不用“修复”为由覆写异常。原其他函数、旧行全字段和所有旧artifactbytes保持。因确实触及成功writer，必须按本文范围得到主线程/用户实施批准，不能把新文件名当作不影响旧路径。

有限验收不扩展成全旧矩阵：

1. activation默认off旧调用保持、owner activate/CAS/replay/conflict/deactivate；失去owner仅原号最小recover；on时六旧fresh入口均拒旁路，原receipt/旧sessionfinish不受新限制。
2. 一个真实源三层场景覆盖channel拒绝、location交集拒绝、源/独立基线变化CAS；无规则时准确unconfigured，source错误不吞成默认。
3. 四channel各一条真实clock_in，至少一个linked+真实adoption、一个unselected/unplanned；事件与原origin及新两表旁证同事务，proof故障零业务行。不是只跑四个合成JSON parser。
4. 同一managed session依次真实paid/unpaid break_start（使用允许explicit规则），检查INSERT时break_paid与旧计时结果；企业/规则变更后按保存session政策继续；新flagoff仍可newprotocol休息、legacy绕过拒绝，正常break_end/clock_out保留。
5. PIN拒绝后lease确实已消费且事件/receipt/proof为零；onsite nonce/过期、location原notice/safeFinish各复用最小真实断言，不再重复历史全矩阵。
6. 丢回复后只原号recover，不重新读取规则或自动POST；另一身份/终端、相同号改变choice、旧pending转新协议都不误清或误写。真实组件至少验证PIN取得选择/再次验证提交和onsite选择→扫码的操作顺序；合成Auth不冒称真实账号/相机/GPS试点。

所有native仍只既有owned合成schema、原锁/statement/connection时限，明确回滚/清理；不为方便填充大量历史、放宽时限或启动第二数据库。本包通过只可记四字段实际消费完成；另外四字段以及整个C07终点仍依各自真实交付，不增加分母或把来源helper计作完成。

## 10. 冻结 tuple、错误与实现导出

以下每个tuple只含scalar/null/递归数组，使用241相同PG/JS规范UTF8 SHA256；不含对象，不依赖JSON键顺序。Revision的数值域沿§2；clock内既有sequence/version仍沿各旧严格parser的更窄合法域，不擅改旧上限。

```text
selectionTuple(null) = null
selectionTuple(s) = [s.slotId,s.revision]
legacyTuple(l) = [l.settingsVersion,l.webBreakPaid,l.scheduleEnabled]
originTuple(o) = [o.layer,o.operationId,o.revision,o.effectiveAt,o.endsAt,
                  o.rulesFingerprint,o.referenceFingerprint]

valueTuple(allowedChannels,v) = v
valueTuple(locationScope,v) = v
valueTuple(shiftSource,v) = v
valueTuple(breakTypes,v) = [v.allowed,v.selection]
choiceTuple(field,{mode:'inherit'|'disabled'}) = [mode]
choiceTuple(field,{mode:'value',value:v}) = ['value',valueTuple(field,v)]
fieldTuple(k,f) = [f.state,f.value===null ? null : valueTuple(k,f.value),
                  f.sources,f.trace.map(t=>[t.layer,choiceTuple(k,t.choice)])]
fieldsTuple(f) = [fieldTuple('allowedChannels',f.allowedChannels),
                 fieldTuple('locationScope',f.locationScope),
                 fieldTuple('shiftSource',f.shiftSource),
                 fieldTuple('breakTypes',f.breakTypes)]

clockTuple(self,c) = [c.expectedWorkerId,c.operationId,c.locationId,c.action,c.expectedSequence]
clockTuple(pin|onsite,c) = [c.expectedWorkerId,c.expectedEmployeeId,c.operationId,
                          c.locationId,c.action,c.expectedSequence]
clockTuple(location,c) = [c.expectedWorkerId,c.operationId,c.locationId,c.action,c.expectedSequence,
                         c.settingsVersion,c.workerVersion,c.locationVersion,c.noticeRevision,c.safeFinish]
punchChoiceTuple(start) = ['start',expectedPolicyFingerprint,selectionTuple(selection)]
punchChoiceTuple(break) = ['break',startEventId,expectedSessionFingerprint,breakType]
punchChoiceTuple(legacy_break|finish) = [kind]

commandTuple = ['attendance-operational-punch-command-v1',siteId,channel,
 actorAuthUserId,[workerId,employeeId,employeeAuthUserId],
 clockTuple(channel,command.clock),punchChoiceTuple(command.choice)]

sessionTuple = ['attendance-operational-punch-session-v1',siteId,
 [s.workerId,s.employeeId,s.employeeAuthUserId],s.actorAuthUserId,
 s.startEventId,s.operationId,s.startSequence,s.occurredAt,s.channel,
 s.locationId,s.locationVersion,s.activationRevision,s.sourceFingerprint,s.policyFingerprint,
 fieldsTuple(s.fields),s.origins.map(originTuple),legacyTuple(s.legacy),selectionTuple(s.selection)]

activationTuple = ['attendance-operational-punch-activation-command-v1',siteId,actorId,
 [command.operationId,command.action,command.expectedRevision,command.reason]]
```

Policy的fingerprint就是§4.1；Session的fingerprint就是上述sessionTuple，不包括自身hash。activation item的revision必须command.expectedRevision+1，其hash由item重构完整command后验证。operation的commandFingerprint必须用其保存真实actor/目标triple及完整command复算；PIN tuple的actor永远null，不能把target Auth塞进actor位。Policy.workerIdentity来自真实192，Session保存triple，不把新current身份回填旧session。

新增错误**恰10项**，保留各channel原已知错误映射（不宽化原枚举）：

| code | HTTP |
| --- | --- |
| attendance_operational_punch_invalid | 503 |
| attendance_operational_punch_changed | 409 |
| attendance_operational_punch_protocol_required | 409 |
| attendance_operational_punch_disabled | 403 |
| attendance_operational_punch_channel_denied | 403 |
| attendance_operational_punch_location_denied | 403 |
| attendance_operational_punch_break_type_denied | 409 |
| attendance_operational_punch_too_large | 422 |
| attendance_operational_punch_not_found | 404 |
| attendance_operational_punch_unchanged | 409 |

原参数错误仍attendance_invalid_request；原同号冲突attendance_operation_conflict；原actor/权限拒绝attendance_access_denied；activation CAS与新policy/session CAS不符用新changed。source_not_found/identity_changed/group_inactive/ambiguous在fresh消费统一新changed（不吐内部资料）；source_too_large→新too_large；source_invalid及不支持/未知异常→新invalid。连接、锁取消、未知body/网络错误不得被当成确定未提交；GET/recover无论任何错误/null/坏回执都不能清pending。已有通路凭证/暂停/序列等拒绝沿原码。

仅新客户端本次实际 POST 收到 `changed / disabled / channel_denied / location_denied / break_type_denied` 五个新业务码时，可提供用户显式“结束本次已拒绝意图”：必须同时保存本次请求的内存证明、原槽精确字节与仍有效身份/API lease；不自动清除、不持久化该清除能力，刷新或任何 GET 均不能重获它。这五码在 SQL 业务写之前或同一业务子事务回滚后返回，原号冲突不映射为它们。PIN 已知业务拒绝仍消费认证 lease；未知约束/连接错误不能声明 lease 已消费或允许结束意图。

Activation 成功写入与 recover 的 `canActivate / canDeactivate` 均为 false；若写回带 current，仅供显示，不授予下一次 CAS，必须显式重新读取 current。

Node统一导出建议固定 `OperationalPunchQuery / OperationalPunchCommand / OperationalPunchPolicy / OperationalPunchSession / OperationalPunchOperation / OperationalPunchResult`、`parseOperationalPunchQuery/Command/Result/Response/Json`、`operationalPunchCommandFingerprint / operationalPunchSessionFingerprint / operationalPunchPolicyFingerprint`。四通路result由channel判别，不用宽泛index signature。activation单独 `OperationalPunchActivationQuery/Command/Item/Result`，不得让employee clock role调用owner激活。
