# 第133批：员工请假结果通知契约

状态：用户在明确说明审批事务新增通知步骤及失败回滚影响后回复“继续”（2026-10-04），同意仅本地候选实现和验收。本地代码、9组实际SQL及4组浏览器验收已通过，综合回归3,185项通过；未部署、未改线上数据。范围只批准、驳回、取消批准的站内结果通知及明确已读；无邮件／推送／轮询／历史回填。具体证据及未覆盖边界见实施记录第133批。

## 已核实根因与捕获方案

- 原122请求按submitted_at分页；entries.actor_auth为审批人，不是收件人。按申请顺序冒充通知会埋住旧申请的新结果，全量本人历史join排序也不符合有界读取。原任务通知仅task/workflow权限与类型，不复用。
- 新125迁移202610040125_merchant_attendance_leave_notifications.sql，保留122原函数及旧表完全不变，无trigger、无旧索引。新service-only VOLATILE faolla_attendance_leave_notify_v1(jsonb,uuid,jsonb,boolean) 包装原leave_v1，仅处理owner的approve/reject/cancel；GET/self/其他输入拒绝invalid，不作为另一读接口。
- 新server flag FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED=1 时 executeLeave 仅将上述三种POST分流新wrapper；关闭仍原v1，GET/self仍原v1。客户端入口用 NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED，读接口还受同serverflag。界面开关不等于捕获开关；此处所有新flag默认关闭。
- wrapper严格验证基本query/command或复用私有精确校验；当前owner merchant SHARE -> settings UPDATE 后，用新SQL语句读取 source operation是否存在，再调用原v1。原v1完整重验权限／暂停／revision等；仅锁内原先不存在、调用成功并精确匹配的新entry生成通知。原号重放不回填，GET不写。捕获失败必须审批与新通知一起回滚并报现有attendance_leave_invalid503，不吞异常；绝不删除已提交旧事实。
- 通知收件四身份merchant/worker/employee/recipient_auth来自原request，不取审批actor或当前worker重绑身份。notificationId=source operation UUID。批准后取消为两条独立通知；flag关闭时产生的决定，开启后重放也不补发，新取消可以有消息而旧批准无消息。

## 新表与访问

- merchant_attendance_leave_notifications：merchant_id,notification_id,request_id,worker_id,employee_id,recipient_auth_user_id,revision(2|3),action(approve|reject|cancel),decided_at。仅来源IDs/身份/时间，不复制原因、姓名、整份请求/回复。FK原request/sourceentry；唯一merchant+notification，另unique merchant+request+revision。
- 索引仅新表：(merchant_id,worker_id,employee_id,recipient_auth_user_id,decided_at DESC,notification_id DESC)。按完整身份先过滤、25+1 keyset；每项只点查原request及最多3条原history确认来源。不提供unread总数/未读筛选/全部已读，避免反连接扫全历史。
- merchant_attendance_leave_notification_reads：merchant_id,notification_id,worker_id,employee_id,recipient_auth_user_id,read_at。唯一merchant+notification（原notification身份不可变），FK新通知；标读先验证完整归属。幂等重复返回第一次read_at，冲突身份拒绝invalid。两新表追加不可变/RLS/API无表权限，helper私有。
- 新RPC faolla_attendance_leave_notifications_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)，仅service_role。
- 每次请求merchant SHARE -> settings GET SHARE/POST UPDATE -> active employee -> active且有效role+self.view -> currentworker SHARE。owner不是本人权限捷径。不要求worker.active/self.leave/在职期/settings.enabled；已有worker停用仍可查本人通知。不要求历史审批人仍是当前owner。
- 必须匹配当前employee与query.expectedEmployeeId；存在expectedWorkerId时匹配当前worker，否则attendance_worker_changed409。分页/详情/标读都要求expectedWorkerId非null。首页worker未绑定时返回workerId=null,items=[],nextCursor=null,detail=null。查他人或旧绑定源一律notification_not_found404，不转交旧通知。
- 平台暂停仍允许当前有权者GET/查询已有read及重复同notice标读；拒绝首次标读（attendance_platform_paused403）。紧急关闭flag全部新接口404，但不删除原表。GET查看从不自动标已读。

## 精确DTO（禁额外字段）

NotificationQuery exact6 = {siteId,expectedEmployeeId,expectedWorkerId:null|UUID,notificationId:null|UUID,beforeAt:null|UTC6微秒,beforeId:null|UUID}。beforeAt/beforeId同时null或非null，cursor与notificationId互斥；cursor/detail要求worker非null；首页允许worker null。
NotificationCommand exact2 = {action:'mark_read',notificationId:UUID}。来源通知ID天然幂等，不再生成随机operationId；同一通知重复不会第二次标读。POST exact2 {query,command}，query.notificationId=command.notificationId，worker非null，cursor null。
NotificationItem exact9 = {notificationId,requestId,revision:2|3,type:'approved'|'rejected'|'approval_cancelled',decidedAt,startAt,endAt,timeZone,readAt:null|UTC6微秒}。type前两者rev2，cancelled rev3；start/end沿原leaveInterval，decidedAt规范UTC6微秒，readAt>=decidedAt。
NotificationDetail exact11 = Item + {currentStatus:'approved'|'rejected'|'cancelled',currentRevision:2|3}。从原完整summary获得；approved notice可currentapproved2或cancelled3，rejected只rejected2，cancelled只cancelled3。非当前有效批准证明，不复制理由。
NotificationsResult exact8 = {protocol:'leave-notifications-v1',siteId,actorId,employeeId,workerId:null|UUID,items:NotificationItem[],nextCursor:null|{at,id},detail:null|NotificationDetail}。actorId=真实Auth，employeeId=企业成员，两者绝不互换。
- list detail=null，items<=25，时间+通知ID严格降序且不重；nextCursor非null仅25项并等于最后一项。detail/POST items=[]、cursor=null，detail必须精确对应query.notificationId。POST readAt必须非null。当前无worker只能空首页。
- HTTP exact加ok:true,moduleEnabled:boolean。API GET/POST /api/merchant-enterprise/attendance/leave-notifications；和已有groups/leave一样认证、同源、限流、private no-store、128KiB成功体/4KiB错误体/12秒超时。
- errors：attendance_notification_not_found404、attendance_notification_invalid503、attendance_worker_changed409、attendance_access_denied403、attendance_settings_required409、attendance_platform_paused403、attendance_invalid_request400、attendance_unavailable503、attendance_rate_limited429、attendance_not_available404、attendance_body_too_large413、attendance_invalid_content_type415。capture对原leave executor仍用旧leave_invalid。

## TS/客户端/页面

- src/lib/merchantAttendanceLeaveNotifications.ts exports NotificationQuery/Command/Item/Detail/NotificationsResult/Response, NOTIFICATION_ERRORS, parseNotificationQuery/HttpQuery/Command/Body/Item/Detail/Result/Response, notificationQueryString。
- AttendanceLeaveNotificationsClient({siteId,employeeId,apiFetch,storage,timeoutMs?})。state phase idle/loading/ready/saving/unconfirmed/blocked,result,pending,message；methods initialize(),list(),next(),detail(notificationId),markRead(),retry(),pause()。
- initialize无pending读首页；pending优先GET原notification。list返回首页（无pending）；next沿本次worker/actor pin翻页。detail只取当前页已见通知；markRead只当前detail，保存完整{siteId,employeeId,actorId,workerId,notificationId}并读回后POST。pending GET readAt非null才清；未读保留并提示明确重试，retry先GET再仅原notice POST。成功只恢复原notice，不产生新ID；存储替换/损坏/身份变化/未知错误不清pending、不自动发写。
- storagekey faolla:attendance:leave-notifications:v1:site:employee。actor从已核验响应取得；所有后续响应pin actor和worker，pending更严格。generation/Abort/hidden拒迟到并清结果，身份拒绝清显示不认领别人的pending。页面关闭/隐藏清普通内容和草稿；其他功能storage不改。无后台刷新、轮询或自动重发。
- 新 MerchantAttendanceLeaveNotificationsLauncher/Panel 在SelfPanel现LeaveLauncher旁；props siteId+employeeId+apiFetch，employee为企业ID。lazy/defaultoff/active guard。关闭入口0请求；打开读首页。显示历史结果类型、决定时间、请假起止/时区、已读/未读；点详情GET显示当前状态，明确按钮标读。提示通知只覆盖捕获开启期间的新处理结果，不表示邮件/手机送达，不把历史批准当当前状态。390px适配。
- 不改旧LeavePanel/Client写操作、原122/通用任务通知、旧权限或真实配置。只旧executeLeave加获准serverflag分流、SelfPanel加入口。决定与通知产生必须真实SQL同事务；测试也不以注入成功JSON替代。

## 本地验收边界

- root独占现有停用PG15集群及3131 browser harness，不新建集群/完整build/截图视频；只合成资料、owned schema，结束恢复基线并停止服务。schema前置复用prepareLeaveNativeFixture（121/122/最小合成基础，零通知）；正常申请/决定用原/新真实RPC。
- native：独立完整安装/重入且旧122函数权限定义不变；开关关闭路径无通知，新三类决定生成唯一消息；旧申请的新决定按决定时间排序25+1；重复恢复不回填；capture故障整笔回滚；wrapper-first与旧v1-first真实双连接同号锁见证；标读幂等/并发、暂停、owner变化、四身份拒绝、worker停用、ACL和不可变。
- browser：真实新页面/默认API/SDK/serviceSQL，合成Auth与传输；用实际owner Leave入口或默认handler产生新决定，再员工看到消息/详情与明确标读；丢标读200后的GET恢复、暂停、390px、hidden迟到GET。详记是完整壳还是静态接入检查，不冒充真实账号/Next/手机。
- scoped单测/回归/tsc/lint/迁移校验；不重复把已完成132等旧主链包装为新增功能。整体P1和真实试点尚未完成。
