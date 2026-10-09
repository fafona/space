# 第200批：考勤事件消息实施契约

2026-10-06。用户已在第199批边界说明后明确“继续”，批准三类本人站内消息、原业务与捕获同事务及捕获故障回滚。仅本地实施验收；不操作生产、不部署、不复制数据库、不完整构建。以下是实现契约，不是通过验收的声明。

## 范围与保留行为

新增排班发布／取消、工作安排批准／驳回／取消批准、异常明确决定的消息。旧125请假通知及任务通知不改；既有业务响应不加字段。没有邮件、推送、轮询、定时提醒、历史补发、角色授权或新业务权限。

来源保存的商户＋worker＋employee＋Auth为唯一收件身份，不使用当前换绑推测。099无保存Auth及136 unbound来源记录`recipient_unavailable`，不阻止原本合法业务；此结果暂只存私有捕获账本，不声称负责人UI已展示。156旧申请的原Auth可信，换绑后仍保留原身份，不妨碍负责人合法驳回／取消。捕获状态不是设备送达证明。

## 数据库与分流

新增169迁移、私有`merchant_attendance_event_notifications`捕获表及`merchant_attendance_event_notification_reads`标读表，旧迁移不可改。

- 捕获生成独立`notification_id`；唯一`(merchant_id, source_category, operation_id)`，保存源身份并核一致性。三个类别相同operation UUID彼此独立。
- `ready`有完整原身份；`recipient_unavailable`明确原因且不列入本人收件箱。保存有限历史摘要，不复制姓名、理由、联系方式、原始证据或GPS。
- 原业务锁保护内先检查原操作是否存在，再调原RPC；仅新操作核验保存来源并捕获。原号重放、GET、后来打开开关不补发。任何非预期捕获错误回滚整笔业务。
- 排班／工作安排沿既有merchant SHARE、settings UPDATE等顺序；异常沿159 merchant SHARE→settings SHARE→worker SHARE→employee SHARE→既有商户advisory→case UPDATE，不调用后升级锁、不加全局通知锁。
- 新包装器：`faolla_attendance_schedule_event_v1(q,auth,c,allow,p_capture_publication_evidence)`，保留099/136原分流；`faolla_attendance_schedule_delegation_event_v1(q,auth,c,allow)`；`faolla_attendance_work_arrangement_event_v1(q,auth,c,allow)`；`faolla_attendance_delegated_applications_event_v1(q,auth,c,allow,p_capture_notifications)`，最后一参原样保留162旧请假语义，按保存委托类别仅捕获work；`faolla_attendance_plan_exception_review_event_v1(q,auth,c,allow)`只捕获owner decide。所有返回原结果。
- 新本人RPC：`faolla_attendance_event_notifications_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean)`。读核当前有效成员、`attendance.self.view`、绑定及保存Auth；worker暂停仍可读；标读不触及159 ack、周期确认或原事项。
- 独立服务开关`FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED`／`...CAPTURE_SITES`和`...READ_ENABLED`／`...READ_SITES`，只有值`1`且有效精确商户列表（最多64，任一无效则关闭）启用。前端入口再受`NEXT_PUBLIC_FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_ENABLED === "1"`控制。默认全部关闭。

## 冻结HTTP／客户端协议

路径`/api/merchant-enterprise/attendance/event-notifications`。GET只读；POST明确标读。Query精确六键：

```
{siteId, expectedEmployeeId, expectedWorkerId: UUID|null,
 notificationId: UUID|null, beforeAt: UTC6|null, beforeId: UUID|null}
```

游标两键同时空或同时有值；详情和游标互斥，详情／翻页必须pin worker。首次列表worker可空。POST精确`{query, command:{action:"mark_read",notificationId}}`，query详情ID必须匹配。以消息ID天然幂等，首次readAt保留，不另造操作号。

Result精确九键：`protocol:"event-notifications-v1", siteId, actorId, employeeId, workerId, items, nextCursor, detail, canMarkRead`。HTTP仅额外`ok:true`，不加moduleEnabled。canMarkRead由SQL依据当前模块开关、settings enabled及worker是否存在权威产生；已有标读的原号重复可在暂停时核回执，首次标读关闭时拒绝。无worker时空列表、canMarkRead=false。

Item精确八键：`notificationId, sourceCategory, sourceOperationId, sourceId, sourceRevision, type, occurredAt, readAt`。

| sourceCategory | type | sourceId / sourceRevision |
| --- | --- | --- |
| schedule | published / cancelled | publish原operation，cancel原slot；revision=null |
| work_arrangement | approved / rejected / approval_cancelled | 原request；revision=2或3，取消为3 |
| plan_exception | confirmed / excused / follow_up | 原case；保存决定revision正整数 |

Detail为Item加`summary`一键，严格按category：

- schedule：`{segments:[{slotId,startAt,endAt,timeZone}]}`，1至32段，按startAt/slotId升序；取消仅一段。
- work_arrangement：`{kind,startAt,endAt,timeZone}`，kind沿156原enum。
- plan_exception：`{slotId,startAt,endAt,timeZone,outcome}`，outcome等于type。

所有记录时间统一UTC六位微秒；区间startAt/endAt也输出UTC6。摘要为历史快照，不查新业务状态，不声称当前有效。列表最多25；按occurredAt、notificationId降序，用26th判断nextCursor，返回第25条`{at,id}`。详情查询items=[]、nextCursor=null，详情不存在404；列表detail=null。readAt不得早于occurredAt。

客户端导出`AttendanceEventNotificationsClient`和`eventNotificationsPendingKey`；类型以`EventNotificationsQuery/Item/Detail/Result`命名。严格使用有界精确响应捕获、当前Auth验证、lease防迟到、原字节CAS，沿198实现，不直接复制125的自动重发行为。

`initialize`仅恢复本地待确认记录、零网络；`load/next/detail`明确GET；`markRead`先持久化再POST；`recover`只GET原消息，已读则核对并CAS清除，未读则保持待确认，**绝不自动POST**。明确“再次标读”用户动作可针对同一pending消息重发同一命令；不新造ID、不自动循环。pending精确`{version:1,siteId,employeeId,actorId,workerId,notificationId}`。详情必须来自当前已校验列表锚点，恢复可只凭严格校验的同身份pending。暂停／隐藏／换身份阻断迟到正文和新写入；pending离开需保护。

## UI及验收边界

独立“考勤消息”入口与旧请假通知并列，SelfPanel最小挂载；按site/employee/Auth隔离并加入组合leaveguard，不加入打卡互锁。不轮询、不自动标读、不伪造跳转原事项。明确提示历史结果、非当前批准证明、标读不代表同意或业务确认。390px可用。

根代理唯一运行已知本地PG和浏览器，代理只写各自文件／纯测试。验收覆盖五写路径、三事件、多段、25/26边界、同源号去重与跨类同UUID、旧入口竞争、丢响应GET、身份／撤权／暂停、原捕获失败原子回滚、旧号不补发、原异常ack和155归档不变。所有结论以实际通过为准；真实Auth、真手机及试点仍待专用账号。
