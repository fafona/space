# C07 review_routing / C15-B 办理责任：198 exact 合同（已冻结）

2026-10-08。状态：主线程已全文核准此 exact 合同，198 SQL本地实现及17项新静态验收已完成，**尚未原生安装／尚无数据库或UI通过声明，完整功能尚未交付**。194 保持冻结。本包不实现提醒、不新增审批权限、不更改任何旧申请、决定、工时或归档正文。

依据：[八字段边界](employee-attendance-remaining-rules-boundary-20261008.md)、[剩余消费者合同](employee-attendance-operational-remaining-consumers-contract-20261008.md)第4节及末尾冻结选择、[C15-B](employee-attendance-review-handover-reminder-boundary-20261008.md)第7节。提醒最终沿同一个 `pending_review` 计划核心；本包不创建另一套提醒 batch／收件表。

## 1. 范围、默认关闭、旧成功路径

```ts
Family = 'correction' | 'correction_revision' | 'missing' | 'missing_revision' | 'leave' | 'work_arrangement'
Category = 'correction' | 'missing' | 'leave' | 'work_arrangement'
```

六 family 对应四 category；`correction_revision` 固定 `owner_only_revision`，不调用189首次补正 grant。missing_revision 沿160实际已有资格，不人为禁用其旧支持。

复用194的 `(siteId,consumer='review_routing')` 共享 activation。默认无记录 off。由当前 canonical owner 明确 activate/deactivate；只增加这个已实现 consumer，不提前启用 timesheet_cycle/reminders。开关开启后的**新 submit**固定一个责任记录；inherit／disabled／无已发布字段均固定提交当时 owner，不声称已选择或授予 delegate。关闭只停止新 capture，不删除旧责任、不撤 grant、不转投旧通知。

员工仍经原提交 service／client／command／pending 槽。路由不增加一个需要员工另行 POST 的协议：合法原提交、原旁证和路由 capture 同事务；不要求读过新路由页才能提交。旧原号重放／withdraw／approve／reject／cancel不追加责任。安装不扫描或回填旧申请。

新责任不是排他审批锁。其他当前有真实资格的 owner／delegate 继续经096／095／160／162／189审批；没有责任不影响旧合法批准，登记责任也不能解除自审批、暂停、地点、封存、证据或范围限制。

确定没有或不唯一 grant 只保存 `needs_assignment`，原合法提交仍成功。192来源损坏、无法证明身份、存储约束／proof失败属于系统失败，原提交整事务回滚，原客户端按未知结果保留原号；禁止把未知数据库错误降级成“没有授权”。

## 2. 实际 SQL 接点和有限私有链

新迁移预留 `202610080198_merchant_attendance_review_routing.sql`。仅新表／函数／索引／受保护触发器，以及共享 activation 的精确前向兼容；不编辑历史迁移文件。

| 旧表 INSERT | 捕获条件 | deferred 原事实核验 |
| --- | --- | --- |
| merchant_attendance_correction_entries | action=submit，初次申请 | 原 submit operation=requestId、保存 worker/employee/Auth、basis；085 rule_binding 同原command和时刻 |
| merchant_attendance_revision_requests | action=submit | 同一 requestId的原submit、base_request_id及原根身份、完整原command；不是 withdraw |
| merchant_attendance_missing_requests | 新行，按supersedes_request_id分族 | 原 missing_entries revision1/action=submit/operation=requestId、原command action=submit或revise、保存身份／parent／root |
| merchant_attendance_leave_requests | 新行 | 原 leave_entries revision1/action=submit/operation=requestId及保存snapshot/command |
| merchant_attendance_work_arrangement_requests | 新行 | 原 work_arrangement_entries revision1/action=submit/operation=requestId、kind和保存snapshot/command |

五个 `AFTER INSERT FOR EACH ROW` capture trigger只处理以上谓词；其他动作立即return。trigger为security definer，固定pg_catalog search_path，入口核tg_table/tg_when/tg_level，public/anon/authenticated/service无execute。旧表没有给service直接INSERT权限，不以GUC、角色字符串或假owner作为来源授权。

原writer已经拿merchant SHARE、settings UPDATE及业务worker/employee锁。capture先核当前activation，再从真实new行取得五项完整身份，以数据库capture时刻 `observedAt=clock_timestamp()` 调192。`submittedAt`仍保存原事实时间；二者不同字段，不把稍后capture时刻冒充原提交时刻。当前事务内新事实已插入，但085 binding／missing等首entry可能尚未插入；因此即时阶段不假称已验证后置原行，新增责任表的 deferred constraint必须在提交时验证完整原链。原125通知与169 event外壳仍照常执行，不绕过或改它们的开关。

不修改四个194私有core或旧 public submit函数，不再次复制这些writer。旧所有函数OID/definition/owner/ACL不变，**唯一必要body变化为共享activation函数**：只把两处 `application_window` 准入扩为已实现的window/routing；signature、原号优先、owner、CAS、撤销安全及tuple不变。198自身先钉194原body/hash/metadata，首装替换、重入钉198新body。194历史脚本固定pin不能在198之后无条件再次覆盖：安装器按迁移版本顺序执行，198后只重入198并核旧194其余对象；不假称194旧脚本在所有后继版本仍可单独重装。

拟私有签名（全部不可直接service调用）：

```sql
faolla_attendance_review_routing_request_v1(p_site text,p_family text,p_request uuid) returns jsonb
faolla_attendance_review_routing_qualify_v1(p_site text,p_family text,p_request uuid,p_grant uuid,p_at timestamptz) returns jsonb
faolla_attendance_review_routing_capture_v1() returns trigger
faolla_attendance_review_routing_entry_v1(p merchant_attendance_review_responsibility_entries) returns jsonb
faolla_attendance_review_routing_observe_v1(p_site text,p_family text,p_request uuid,p_at timestamptz) returns jsonb
faolla_attendance_review_routing_guard_v1() returns trigger
```

可另有strict scalar/tuple/check helper，不开放第二条业务权限旁路。request helper只作固定事实投影；对外入口先真实Auth和旧归属校验。observe不能写head或重新分派。

## 3. 来源、唯一 grant 和不无限扫描

按个人→组→企业首个非inherit的 reviewRouting 字段选择整个四category值；不逐类别拼接不同层。value取当前family映射category；disabled／全部inherit=当时owner。修订补正强制owner_only_revision。保存193 compact source_ref并从不可变191发布点／084政策点重建，完整192原at/hash不变；没有新规则body复制，没有GPS／附件／申请理由复制。

delegate选择使用配置的 employeeId/Auth 两项及真实申请保存 worker/employee/Auth；不按名字／当前默认地点猜人。自动候选分别在189、160、162 grant表按完整target三身份＋指定delegate双身份（162另category）走索引，UUID grantId升序取**26个原始候选**。不在LIMIT前调用可能扫描历史的usable函数。第26是sentinel：直接 `candidate_limit`，不得把前25中的一个可用者声称为全局唯一；最多25条才逐个核验。0可用→no_grant，2个及以上→ambiguous_grant，恰1个→保存delegate责任。

必要新增三个索引：grant表各 `(merchant_id,worker_id,employee_id,employee_auth_user_id,delegate_employee_id,delegate_auth_user_id,grant_id)`；application在完整target后再含category。创建方式沿160线上无维护的预检／concurrent索引约束，不在实际生产持长表锁；owned测试schema安装器可沿已有方式有界执行。不能用这些索引修改旧查询含义。

核验沿真实旧权限，不造统一假权限：

- correction：189 `...usable_v1`，实际role仅enterprise.view+attendance.correction.review；includePending=false时submittedAt**严格大于**grant.recorded_at。原basis全部事件及当前basis（存在时）均须在grant单历史地点；用189 private collector/范围检查，材料不对外返回。其余旧blocker只限制实际决定，不因仅能驳回就否认“可办理”。
- missing/missing_revision：160经164包装的usable、保存location/triple、自审批守卫。160**没有includePending字段**，不强加189时间语义。
- leave/work_arrangement：162经164包装的usable、category、kinds、保存三身份、自审批；submittedAt>=grant.recorded_at或includePending按原规则。责任资格不重新输出conflict正文，原审批仍核全部当前冲突与证据。
- 暂停epoch：189内嵌双代次；160/162取164 delegation_epochs或其原`pre_epoch_zero`合法分支，记录旁证来源，不能把缺失capture随意当零。读取历史entry不按今天权限重写过去代次。

仅189已知basis不可得／单地点不可证明可归 `source_scope_unavailable`，不附材料；锁超时、连接、非白名单SQL错误不吞。grant复核统一在settings锁内、实际stamp下完成；expiry为半开窗。相同配置delegate没有可用grant时不自动转投owner；owner看到needs_assignment后明确处理。

## 4. 两张新表、身份和不可变旁证

`merchant_attendance_review_responsibility_entries` append-only，主键 `(merchant_id,family,operation_id)`，唯一 `(merchant_id,family,request_id,revision)`。保存原request三身份、submittedAt/submittedRevision、actor、完整手动command|null、前驱operation、严格Entry、source_ref|null及内部authority证明。capture revision1、operationId=源requestId、actor=原提交Auth、command=null；人工动作独立op、当前owner真实actor，revision=前驱+1。无UPDATE/DELETE/TRUNCATE、RLS全撤权。

`merchant_attendance_review_responsibility_heads` 为严格派生当前投影，唯一 `(merchant_id,family,request_id)`，仅存最新revision/op/recordedAt及原target identity。head UPDATE必须由同事务合法相邻entry证明；不能改identity/request、跳revision、删除、截断。列表索引 `(merchant_id,recorded_at DESC,family COLLATE C,request_id DESC)`，只读head+其一条entry。总历史不封顶，版本上限9007199254740990且新写预留+1拒溢出。

内部 authority 固定保存grant真实key、commandFingerprint、真实validFrom/Until、delegate/target身份、双代次及epochProofKind。即时qualify证明当时可用；deferred只验固定grant/body/source/原事实关系，不用今天撤权／角色重写过去，也不要求旧assignment今天仍可用。

首次人工登记允许旧合法待审申请，但标`manual_registration`、source_ref=null，不称为历史规则capture，不补造已发布来源。人工动作不改变原申请旧正文，也不能给本来读不到的delegate材料。所有身份都取原真实记录，缺失不是nullable兜底。

旧082合法未绑定085政策的补正可作人工登记／观察，仍由旧审批决定可批准或仅能驳回；不补造binding。若已有binding则严格核其完整command／版本／时刻。新`rule_capture`补正必须在deferred检查中有085 binding，人工兼容分支不能让新捕获绕过该证明。

## 5. 精确公开 DTO

共通标量：siteId精确8位；UUID规范小写36字节；UTC6精确27字节、finite；hash精确64小写hex；revision安全整数0..9007199254740990，保存版本positive；reason沿group_text 1..200 codepoints、trim原样、C0/C1拒。kind为trip/field/remote或null；family/date/身份不从客户端猜测。

```ts
RequestRef = { family,category,requestId,workerId,employeeId,employeeAuthUserId,
 submittedRevision,submittedAt,kind:null|'trip'|'field'|'remote' }
// submittedRevision 是原申请当时版本；不是永远填1（correction/revision stream可能>1）。
Desired = {kind:'owner'} | {kind:'delegate',employeeId,authUserId}
Origin = {kind:'manual_registration'} | {
 kind:'rule_capture',activationRevision,observedAt,sourceFingerprint,
 selection:'value'|'disabled'|'unconfigured'|'owner_only_revision',
 selectedLayer:null|'enterprise'|'group'|'personal',desired:Desired
}
Assignment = {kind:'owner',authUserId} | {
 kind:'delegate',employeeId,authUserId,grantId,grantType:'correction'|'missing'|'application',
 delegateGeneration,employeeGeneration,epochProofKind:'embedded'|'sidecar'|'pre_epoch_zero',validFrom,validUntil
} | {kind:'needs_assignment',reason:'no_grant'|'ambiguous_grant'|'candidate_limit'|'source_scope_unavailable',
 desired:{employeeId,authUserId}}
Entry = {operationId,revision,action:'capture'|'register'|'take_over',actorId,recordedAt,
 reason:null|string,previousOperationId:null|string,origin:Origin,assignment:Assignment,
 commandFingerprint:null|string,entryFingerprint}
Observation = {requestRevision,requestHeadOperationId,status:'submitted'|'approved'|'rejected'|'withdrawn'|'cancelled',
 bindingCurrent,routeState:'unregistered'|'assigned'|'needs_assignment'|'handover_needed'|'closed',
 reason:null|'no_grant'|'ambiguous_grant'|'candidate_limit'|'source_scope_unavailable'|'owner_changed'|'grant_unavailable'|'binding_changed',
 checkedAt,observationFingerprint}
GrantOption = {grantId,delegateEmployeeId,delegateAuthUserId,delegateName,
 validFrom,validUntil,usable,reason:null|'grant_unavailable'|'scope_unavailable'}
Receipt = {operationId,family,requestId,revision,action:'register'|'take_over',actorId,recordedAt,commandFingerprint}
```

Entry.origin始终保留初始capture/manual起源；后续handover不把今天source写进旧origin。capture的reason/commandFingerprint均null；手动二者nonnull。Entry previousOperationId当且仅revision1为null。take_over.assignment固定锁内当前owner、从不delegate。register固定owner精确选择且qualify过的grant；不生成grant。

Observation只观察：原决定／撤回已完成则closed；未登记为unregistered；保存owner不是当前owner→handover_needed/owner_changed；保存delegate当前usable或scope失败→handover_needed/grant_unavailable或binding_changed；needs_assignment保持明确原因。GET不得保存这些变化。`bindingCurrent=false`时currentowner可接手协调，但原审批仍可能拒，DTO不含canApprove。

## 6. Query、Command、Result、分页与指纹

公开RPC：

```sql
faolla_attendance_review_routing_v1(p_query jsonb,p_auth_user_id uuid,
 p_command jsonb default null,p_allow_write boolean default false) returns jsonb
```

仅service EXECUTE，真实Auth/password由route获取；HTTP `/api/merchant-enterprise/attendance/review-routing`，GET严格scalar查询，cursor用有界JSON字符串；POST exact `{query,command}`。请求8KiB、响应256KiB、错误4KiB、读取正文在12秒总预算内；same-origin/no-store，未知错误不披露SQL。

```ts
ListCursor = {kind:'list',siteId,beforeAt,beforeFamily,beforeRequestId}
GrantCursor = {kind:'grants',siteId,family,requestId,afterDelegateEmployeeId,afterDelegateAuthUserId,afterGrantId}
Query = {siteId,mode:'list',cursor:null|ListCursor}
 | {siteId,mode:'detail',family,requestId}
 | {siteId,mode:'self',family,requestId}
 | {siteId,mode:'history',family,requestId,beforeRevision:null|number}
 | {siteId,mode:'grants',family,requestId,cursor:null|GrantCursor}
 | {siteId,mode:'recover',family,operationId}
Command = {action:'register'|'take_over',operationId,expectedResponsibilityRevision,
 expectedResponsibilityOperationId:null|string,expectedRequestRevision,
 expectedObservationFingerprint,grantId:null|string,reason}
Result = {protocol:'attendance-review-routing-v1',siteId,actorId,readAt,data:Data,receipt:Receipt|null}
Data = {kind:'list',items:Array<{request:RequestRef,current:Entry,observation:Observation}>,nextCursor:null|ListCursor}
 | {kind:'detail',request:RequestRef,current:Entry|null,observation:Observation,canRegister,canTakeOver}
 | {kind:'self',family,requestId,submittedAt,route:'owner'|'delegate'|'needs_assignment'|'unregistered',
    handoverNeeded,capturedAt:null|string}
 | {kind:'history',request:RequestRef,items:Entry[],nextBeforeRevision:null|number}
 | {kind:'grants',request:RequestRef,items:GrantOption[],nextCursor:null|GrantCursor}
 | {kind:'receipt'}
```

POST仅配detail、family/request全相同；返回data.receipt而非下一次可写detail。recover同data.receipt，未知／非原actor/null不给正文；非recover普通GET receipt=null。recover只支持本责任手动op，不把capture原源op恢复冒充员工submit成功；原员工pending仍按原协议恢复。

owner读list/detail/history/grants必须当前canonical owner。self只准原提交人当前同employee/Auth及旧self.view可读其这条记录，返回上述最小公开self DTO，不含grant、delegate UUID、规则body、其他来源／员工材料；消息目标不是授权。delegate仍走原189/160/162目录／详情，不给新横向列表。

list先取head25+1再对最多25点查观察，**不提供需扫完整历史才能正确的handover-only过滤或总数**；closed条目可显示，现117仍是真实待审目录。history按同request revision DESC取25+1，exclusive beforeRevision，next仅有更多时末revision；不读取整个历史。grants用于owner明确选择：按上述完整target前缀、delegate双ID/grantID三元keyset取25+1，逐条返回usable，不能把不可用行在LIMIT前无限过滤；correction_revision不提供delegate选择，grants明确空。manual register直接核一个选中grant，故自动26 sentinel不形成永久无法指派。

register要求仍submitted、原身份完整、grant当前精确可办理、无当前head或其状态needs_assignment/handover_needed；不得覆盖仍可用的既有办理人。旧待审第一次register revision1、origin manual_registration；新capture之后register保留原origin。take_over要求有head且仍submitted，处于needs_assignment/handover_needed，或旧owner已换人；无head不能凭空claim曾失权。不许closed申请追加责任。

两动作都要当前owner、当前HTTP allowWrite，consumer activation只控制自动capture而非已登记责任的显式处理。serverflag关后普通owner只读及原actorrecover仍可达，fresh register/take_over均关闭；原审批从不依赖此flag。先按原op+actor+family+完整query/body核最小receipt，再当前owner／CAS；旧owner失权仅可recover自己的已有receipt，不读新正文。

fixed tuple 使用191递归scalar-array `jsonb_build_array(...)::text` / JS递归数组`, `序列化UTF8 SHA256，不依赖object顺序：

```text
RequestTuple = [family,category,requestId,workerId,employeeId,employeeAuthUserId,submittedRevision,submittedAt,kind]
DesiredTuple = ['owner'] | ['delegate',employeeId,authUserId]
OriginTuple = ['manual_registration'] |
 ['rule_capture',activationRevision,observedAt,sourceFingerprint,selection,selectedLayer,DesiredTuple]
AssignmentTuple = ['owner',authUserId] |
 ['delegate',employeeId,authUserId,grantId,grantType,delegateGeneration,employeeGeneration,epochProofKind,validFrom,validUntil] |
 ['needs_assignment',reason,[desired.employeeId,desired.authUserId]]
CommandTuple = [action,operationId,expectedResponsibilityRevision,expectedResponsibilityOperationId,
 expectedRequestRevision,expectedObservationFingerprint,grantId,reason]
commandFingerprint = SHA(['attendance-review-routing-command-v1',siteId,actualActor,family,requestId,CommandTuple])
entryFingerprint = SHA(['attendance-review-routing-entry-v1',siteId,RequestTuple,
 operationId,revision,action,actorId,recordedAt,reason,previousOperationId,OriginTuple,AssignmentTuple,commandFingerprint])
observationFingerprint = SHA(['attendance-review-routing-observation-v1',siteId,RequestTuple,
 currentEntryFingerprint|null,currentOwnerAuthId,requestRevision,requestHeadOperationId,status,
 bindingCurrent,routeState,reason])
```

仅observation的本次checkedAt不进CAS，其他事实全部绑定；POST锁后重新观察。同号重放不再执行qualify/source/observe，也不刷新旧receipt。capture内部另保存原source_row/submit command的严格固定关系proof；其entryFingerprint不代表源业务command哈希或授权token。

## 7. 锁、安装及有限安全边界

owner新动作merchant SHARE固定owner→settings UPDATE→target worker→相关employee按UUID排序／role→head FOR UPDATE；原employee更新／审批由settings串行。capture是在原writer已持锁后运行，只加同site现目标／选定delegate的锁，不能先持新head再找settings；等待后以数据库时间重核。GET使用对应SHARE，不持锁跨HTTP。

每个新写先原号，后owner/资格/CAS。响应丢失、未知/null、换Auth晚body均保持原槽；同scope回执匹配完整commandFingerprint且存储原bytes未替换才清槽。无自动POST。新责任pending槽独立于原申请，但父workspace只允许一个活跃writer；打开原审批必须经过两边leaveGuard，不能拿责任操作成功当原申请已处理。

新errors冻结（以下八个均用完整 `attendance_review_routing_` 前缀）：`invalid:503 / disabled:403 / changed:409 / not_found:404 / closed:409 / unavailable:409 / unchanged:409 / too_large:422`；沿旧 `attendance_invalid_request:400 / attendance_access_denied:403 / attendance_settings_required:409 / attendance_operation_conflict:409`。确定当前POST的changed/closed/unavailable/disabled仅可用户显式结束已证明零写意图；GET失败或约束／连接未知不能清号。

首装钉旧collector/usable、194activation定义/signature/defaults/owner/proconfig/ACL，五张旧表触发器原有集合原样保留，只追加具名新trigger。重入核全部新增函数的实际完整manifest；函数数量在SQL实现冻结时枚举，不能省略新增helper；核新DDL/ACL/RLS/index/trigger精确，不自动修错ACL。所有newproof、projection与原事实关系检查均启用，测试不禁触发器。

## 8. UI 接线和有限验收终点

owner Admin新增一个“办理责任”入口，默认前端flag关闭、初挂0HTTP；明确读list/detail/history/grants。现117/229目标引用可带精确family/requestId进入detail，显示固定原身份与当前观察。已选择grant才可register；canTakeOver时明确原因确认，不自动接手。接手成功显示“已由负责人协调，不等于可批准”。

“打开原申请”复用原唯一host：correction→CorrectionReview/Decision；revision→RevisionApproval；missing两族→Missing；leave→原Leave审批；work_arrangement→原WorkArrangement。必须fresh GET匹配保存worker/employee/Auth和exact request/family；receipt/history不直接授CAS。delegate点击仍进入原授权workspace而非伪owner。原目录pending、草稿、busy、Auth/api/current-scope栅栏优先，不新建第二审批子页。

self仅在原申请成功/详情旁提供“读取办理去向”明确GET，不自动扫描或为旧pending开新writer。负责人失权后的原号恢复使用独立真实Auth恢复入口，不能要求先进入当前owner Admin。原因／正文不从localstorage恢复成当前可信状态。

本包最小实际验收：六family各一条新capture（revision只owner）；至少一次真实189/160/162精确grant适配，0/多/26候选保留提交且needs_assignment；一条189撤权后read-only handover_needed→当前owner显式take_over→原096正常决定；另一合法delegate不因别人的责任head被挡。proof故障原提交零新行、原号不新capture、off停止capture但旧责任可读；源旧行／归档字节保持。真实UI验证一个Admin→责任→原审批fresh GET、丢回复原号GET、换Auth/草稿guard；不重测旧所有审批矩阵。

完成以上只收口 reviewRouting 与 C15-B 办理接手，不宣称三类自动提醒或C07八字段全部完成。198 SQL已获主线程核准开始；本文本身无DB／浏览器操作。

## 9. 198 SQL实现清单与尚待实跑

文件：`scripts/supabase-migrations/202610080198_merchant_attendance_review_routing.sql`；新静态测试：`scripts/merchant-attendance-review-routing-migration.test.mjs`。

两张表为第4节的entries与heads。新增四个索引：旧grant表各`attendance_review_routing_correction_idx`／`attendance_review_routing_missing_idx`／`attendance_review_routing_application_idx`以concurrently建立；新head上`attendance_review_responsibility_list_idx`。两阶段预检允许已正确完成的孤立索引复用，错误／无效索引拒绝且不修复；不能把整个迁移包在外层事务中。

新增16个函数均以`faolla_attendance_review_routing_`为前缀，后缀精确为：

- `tuple_v1(jsonb,text)`、`fact_v1(text,text,uuid,boolean)`、`request_v1(text,text,uuid)`。
- `grant_v1(text,text,uuid)`、`qualify_v1(text,text,uuid,uuid,timestamptz)`、`candidates_v1(text,jsonb,jsonb,jsonb)`。
- `origin_v1(jsonb,text,bigint)`、`choose_v1(text,text,uuid,jsonb,uuid,timestamptz)`。
- `make_v1(text,jsonb,uuid,bigint,text,uuid,timestamptz,text,uuid,jsonb,jsonb,text)`。
- `entry_v1(merchant_attendance_review_responsibility_entries)`、`observe_v1(text,text,uuid,timestamptz)`。
- `capture_v1()`、`guard_v1()`、`query_v1(jsonb)`、`receipt_v1(merchant_attendance_review_responsibility_entries)`。
- `v1(jsonb,uuid,jsonb,boolean)`是唯一service-only入口；其余15个对public、anon、authenticated、service_role全部撤销EXECUTE。capture/guard为仅触发器可用的security definer，不是应用入口。

五张原表各只追加`review_routing_capture`，原trigger不删除／替换。entries新增`review_routing_entry_before`、`review_routing_immutable`、`review_routing_no_truncate`及deferred `review_routing_proof`；heads新增`review_routing_head_before`及`review_routing_no_truncate`，共11个新trigger。

既有唯一body修改为`faolla_attendance_operational_consumer_activation_v1(jsonb,uuid,jsonb,boolean)`的两处consumer判断；static recipe核旧完整hash、单次命中和新完整hash，保留原OID/签名/参数默认值/owner/ACL。新迁移不修改194文件，不修改原审批/提交函数。首装、并发索引之后、安装末尾都核直接来源和旧grant资格helper的完整源码／metadata；重入先核16个新函数、两表column/constraint/RLS/ACL、索引及trigger，不修异常安装状态。

最初17项测试仅是本地源码／静态合同验证，不是安装成功证明。后续HTTP/client/UI接线及有限4组实际React浏览器验收已完成；未模拟真实登录。真实安装／重入、六family触发器链、合法旧legacy人工登记、原审批权限不扩大、proof失败整事务回滚及并发仍须主线程native验收。仍按第8节有限终点继续，不将此SQL基础单独记作C07完成。

2026-10-08有限安装诊断：195原验收／105与189缺失前置已通过，198全部30项旧依赖metadata/hash核验通过。随后安装仍在自身CHECK规范化比较失败；这发生于首装尾部的`routing_postconditions`也完全可能，不能据匿名DO的行号认定已进入第二次重入。仅重启既有owned PG15、在TEMP表rollback事务重建4个实际CHECK的短诊断，确认唯一差异是`convert_to`把`'UTF8'`输出为`'UTF8'::name`，其余三个CHECK一致。三个安装边界仅增加对此已证明scalar NAME cast的规范化，不删除操作符、数字或字符串内容，不接受`name[]`／名称前缀。诊断后PID及16444监听均已消失，无产品安装或业务表读写。

该窄修后的198 SQL SHA256为`3F64F4CCF288368160DA116858A67ACBF35ECFFD08B8ED49CAA275FF23B47A1C`；源码回归证明改阈值、编码字面量、比较符或拼接表达式仍不相等。尚未据此宣称198实际安装或后续8组native通过。
