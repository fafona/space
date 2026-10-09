# 第134批：负责人待审请假契约

状态：用户在说明单工作区、待审批／全部申请切换与草稿影响后回复“继续”，已同意本地实现和验收；2026-10-04 已完成本地验收（40项新增纯测、3,225项综合回归、8组原生SQL、6组实际页面）。无生产部署、真实开关或数据变更。133不重做；实际边界见[实施记录](employee-attendance-implementation-20260929.md)。

## 缺口与边界

原请假负责人列表混列全部状态；原三类待审只适用过去工时声明，不能直接容纳未来请假。新增只读发现接口，现有请假Panel内切换视图，共用唯一原AttendanceLeaveClient、审批详情／理由／确认／pending和原写接口。原122、133包装、原客户端及员工行为不改。

## 新126只读RPC

- 文件 `202610040126_merchant_attendance_leave_review.sql`。仅新增service-only函数 `faolla_attendance_leave_review_v1(p_query jsonb,p_auth_user_id uuid)` 和迁移登记；不建表／索引／触发器，不改旧函数、旧权限或数据。必须核对122依赖和安装重入。
- 当前商户负责人每次重验，merchant SHARE → settings SHARE。不依赖旧员工仍active／仍绑定，不按当前worker标签覆盖历史姓名；暂停允许授权读取。不是主管委托或员工接口。
- 按旧owner索引逆向使用，`submitted_at ASC,request_id ASC` 最旧优先；query游标之后先LIMIT51，处理前50个候选。每候选调用原完整summary检查最多三步历史，仅返回当前submitted／revision1；第51行只判断还有候选。非待审不返回理由或历史。
- scanned是实际处理候选数0..50，不是返回待审数；有第51行时nextCursor为第50个候选，不是最后一条待审。空结果且nextCursor存在必须允许继续查找；禁止自动循环扫全历史。无总数、固定快照或物理扫描成本承诺。后来变更须重新查首页，最新详情／写入仍再核权和状态。
- 捕获失败或坏来源整次拒绝，不返回部分正确行。GET零业务写入；API POST拒绝，不调用RPC。

## 精确DTO（禁止多余字段）

- `LeaveReviewQuery` exact3 `{siteId,afterAt:null|UTC6microseconds,afterId:null|UUID}`，游标必须成对。
- `LeaveReviewItem`复用原精确8字段LeaveSummary，但只能`status:'submitted',revision:1`；允许未来时段，不比较endAt与submittedAt。
- `LeaveReviewResult` exact6 `{protocol:'leave-review-v1',siteId,ownerId,items:LeaveReviewItem[],scanned:number,nextCursor:null|{at,id}}`。items不超过scanned，scanned为0..50整数；item按提交时间／UUID严格升序且在请求游标之后。不重复ID。非null nextCursor要求scanned50，严格大于请求游标且不小于所有返回item；items50时等于最后item。scanned0时items空/cursor空。可50候选恰为末页而cursor为空。
- HTTP精确增加`ok:true,moduleEnabled:boolean`。12秒、128KiB成功体、4KiB严格错误体；默认API认证/同源/限流/private-no-store。服务端解析pin真实Auth为ownerId；客户端pin传入ownerId。
- 新API GET `/api/merchant-enterprise/attendance/leave-review`；服务器开关 `FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED === '1'` 且原 `FAOLLA_ATTENDANCE_LEAVE_ENABLED === '1'`。前端 `NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED === '1'`，仅负责人。全部默认关闭。
- errors: attendance_leave_review_invalid503,attendance_leave_invalid503,attendance_invalid_request400,attendance_access_denied403,attendance_settings_required409,attendance_unavailable503,attendance_rate_limited429,attendance_not_available404。认证和origin错误沿原接口；未知体fail closed。

## 代码接口（冻结供并行实现）

- `src/lib/merchantAttendanceLeaveReview.ts`: exports LeaveReviewQuery/Item/Result/Response, LEAVE_REVIEW_ERRORS, parseLeaveReviewQuery/HttpQuery/Result/Response, leaveReviewQueryString。parseResult(raw,query,expectedOwnerId?)；parseResponse同参。HTTPResponse类型剥除ok但包含moduleEnabled。
- `src/lib/merchantAttendanceLeaveReviewClient.ts`: class AttendanceLeaveReviewClient({siteId,ownerId,apiFetch,timeoutMs?})；state `{phase:'idle'|'loading'|'ready'|'blocked',result:LeaveReviewResponse|null,message:string}`；getSnapshot/subscribe/load()/next()/pause()。无storage、写方法、自动请求或轮询。load始终首页，next只ready+cursor；隐藏/取消/失败清result，generation拒迟到；整体有界请求与严格小错误体。
- `src/lib/merchantAttendanceLeaveReview.server.ts`: executeLeaveReview({query,authUserId},service?)；service RPC参数只有p_query,p_auth_user_id。
- 新route-handler exports handleLeaveReview / leaveReviewDependencies，默认依赖可覆写；GETonly。route.ts导出GET/POST均委派handler（POST405）以测试拒绝。

## 单工作区UI

- 只修改既有MerchantAttendanceLeavePanel，不再建第二套审批Launcher／client。可加可选reviewEnabled prop以隔离测试，默认来自新public flag且access==='owner'；默认关闭时保持原自助和全部申请路径。
- 仍先initialize唯一旧LeaveClient，pending优先核对，收到别的原申请／取消收据时先显示它，不自动跳到新的候选。pending存在、旧或新请求忙、旧client未ready时禁视图切换／选人；不改pending槽或原client。
- 新视图按钮“待审批”“全部申请”。切换先调用原discardDraft，用户取消则保留旧草稿／界面；确认后清草稿、旧详情和只读候选，再使用原load/initialize核对原pending和新读接口。不跨视图复用过期决定理由。
- 候选按钮“查看申请详情”使用原client.detail(requestId)，选中前先确认该ID来自当前新列表。先清新候选，原详情/决定路径完全复用；批准或驳回后显示原详情/收据；返回根据当前视图重新查询首页。旧全部记录及cancel行为不删除。
- 读取任一路径拒绝时清除另一侧旧显示，避免拒权后残留；隐藏/pagehide/active卸载清两侧并拒迟到。禁止页面自动扫后续候选或自动审批／重发。切回可先恢复原pending；明确重新读取可恢复blocked。
- 空候选页标明“本批未发现待审批申请，仍可继续查询”，有next才给“继续查找待审”；scanned和本批待审数均标为本批，不当全量总数。390px可操作。

## 验收与资源

- 新SQLfixture复用122/125现有owned合成集群，原RPC构造申请/决定，不伪造成功业务行。至少第一批50已处理、后续多个待审且含未来时段，证明空候选页可继续、游标边界与有序；当前owner/跨租户/解绑/暂停/坏源/ACL/安装重入；全表指纹不变。
- 实际原Panel开flag的浏览器：切待审→选候选→原API批准/驳回→133按原flag产生消息；最新详情已撤回不显示可批；pending优先、丢回复恢复、草稿取消切换、暂停只读、390px、迟到GET清理。旧flagoff与员工路径保持原回归。
- 唯一root启动PG/browser，其他代理只写代码/纯测试；用现有停用集群和内存bundle。无完整构建、新集群、截图录像或生产访问；最终停服务核验。
