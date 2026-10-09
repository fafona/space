# 236 负责人站内收件：限定合同

用户已于235说明后以“继续”批准：仅员工新的异常说明／周期争议，在原提交事务中捕获通知，失败整笔回滚；不补历史、不自动交接、不发邮件／推送、不催办，不把消息已读当异常ack或周期确认。默认关闭，只本地实现及验收，不部署、不改真实资料。

## 不变边界

- 新增188迁移，不改已发布SQL正文；以独立wrapper原样调用174的7参RPC和183的v1/v2周期RPC。关捕获、非self note/dispute、普通GET／recover仍由原TS服务调用原入口。v1若仍有实际新争议入口，同范围捕获，不迁移旧恢复协议。
- 捕获沿原锁序（merchant SHARE固定owner，settings UPDATE序列化，再调用原RPC）；同事务在源调用前识别精确原号是否已有，仅fresh成功追加。旧号缺消息不补发，不吞冲突或失败。保存成功源账本里的双身份，不添加worker.active等原合法争议并不要求的新门槛。
- 收件人保存事件时merchants.user_id；允许收件人与合法源员工同一Auth。当前owner才可普通读取或首次标读，且必须等于保存recipient。负责人更换不转投；旧负责人只可按精确原号读取自己已提交的最小标读回执，不恢复正文／原事项或新写权限。
- 不复制说明、争议理由、位置或证据正文，只保存最小来源和导航信息。点击原事项须fresh GET，并由原入口核验现权限／双身份。通知打开不授权旧源操作、不自动标读。

## 精确DTO（所有键必需，nullable显式null）

API `/api/merchant-enterprise/attendance/owner-notifications`；RPC `faolla_attendance_owner_notifications_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean)`。

Query：`{siteId,mode,notificationId,operationId,beforeAt,beforeId}`。
- siteId为8位数字。mode为list/detail/recover。
- list：notificationId/operationId=null；beforeAt/beforeId同时null或有效UTC六位小数时间/UUID。
- detail：notificationId必需；operationId/beforeAt/beforeId=null。
- recover：notificationId和operationId必需；beforeAt/beforeId=null。

Command：`{action:'mark_read',operationId,notificationId}`，仅detail可POST，notificationId须等于query。

所有结果base：`{protocol:'owner-attendance-notifications-v1',siteId,actorId}`。
- list：base＋`{kind:'list',items,nextCursor}`；25条＋1探测，按occurredAt/notificationId倒序；nextCursor为null或`{at,id}`，须等于本页第25条。
- detail GET：base＋`{kind:'detail',item,canMarkRead}`。
- POST／recover GET：base＋`{kind:'receipt',receipt}`；POST必有回执，recover查无为null。
- HTTP成功加`ok:true`；失败严格`{ok:false,error}`。

Item精确键：`{notificationId,sourceCategory,sourceOperationId,sourceId,sourceRevision,workerId,employeeId,employeeAuthUserId,occurredAt,readAt,target}`。
- sourceCategory=plan_exception时，sourceId为caseId，sourceRevision为该说明保存的case修订；target=`{slotId}`。
- sourceCategory=period时，sourceId为periodId，sourceRevision为保存entry修订；target=`{periodId,fromDate,throughDate}`，periodId=sourceId，两个YYYY-MM-DD日期来自保存周期frame，非浏览器推断。
- sourceRevision为正安全整数；ID均小写合法UUID；occurredAt/readAt为UTC六位小数，readAt可null且不得早于occurredAt。

最小Receipt：`{operationId,notificationId,actorId,readAt}`。不含源身份、正文或导航；完整匹配待确认命令和当前Auth才清除本地原槽。独立不可变mark操作账本保存完整命令关联；同merchant原operationId不同notification/actor冲突。重复标读可生成新显式操作回执但沿用首次readAt，不改旧receipt。

## 开关、客户端及路由

- `FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_ENABLED/SITES`独立捕获白名单；`..._READ_ENABLED/SITES`独立读取／新标读白名单。仅1开启，最多64个唯一8位商户编号，无通配；均默认关。
- FE `NEXT_PUBLIC_FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_ENABLED`，默认关；关闭保留原号只读恢复。服务不因read关闭阻止已保存原号最小恢复；捕获关闭不阻止原业务成功。
- 响应128KiB、请求4KiB；同源、实际Auth、限流、无缓存、严格JSON、5秒读体。DB RPC重新核验实际actor和owner，不能仅靠页面。
- 客户端按site＋actor隔离sessionStorage；只保存精确query/command/actor，不存消息正文。写前持久化并逐次核对原字节。隐藏／Auth/requester变化清显示并失效在途响应，保留原号；挂载不请求，未知结果不自动POST，明确GET原号核对。GET查无不等于原POST失败。fetch/body/存储共用有界截止，不产生并行写。
- 唯一负责人收件入口接实际Admin，不混入员工消息。原消息与旧协议保持。

## 有界验收终点

两类真实事件、开关／旧号不补、捕获失败原子回滚、负责人交接隔离、标读幂等与最小恢复、员工身份变更、25/26分页、原事项与归档不被标读改变；真实页面导航／隐藏／丢回复／换Auth及390px。真实账号／手机／生产部署不计本轮完成。
