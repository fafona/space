# 237 长期周期归档发现：只读兼容合同

用户要求继续至计划完成。本包仅修复已证实的本地只读接线缺口：227保留页旧v1周期列表拒绝231已支持的revision>100/version>20；182整周期试算最多100份正文且不能继续分页。旧列表、试算、保留writer、SQL、资料与额度均保持，不删除／脱敏，不把兼容修复当完整处置功能交付。

## 新独立入口

- 在保留Panel中增加默认关闭的“按长期周期／版本查找归档”；用户先用旧人员选择器及日期框明确人员与最多31日搜索范围，再显式打开新子工作区。
- 新入口仅GET已存在period-closures-v2的list（25条）及versions（20条），明确按钮分页，页间替换不累计、不自动跟页、不加载正文。list搜索是日期相交，不是必须完全相同。
- 从当前list页选择周期后，用该行保存的完整日期、worker、employee、employeeAuth、时区和UTC范围核验versions。不能用原搜索窗口替代周期保存范围；每页仍重新验证当前权限，不扩大对换绑历史的读取。旧“已有归档编号”核对保持可用。
- 版本对应artifactId；不同版本可复用同一artifact。选择一条版本后，仅交原保留client.load的record查询，category固定period_artifact，recordId固定artifactId。不调用旧整周期preview、不产生POST或保留变更、不把当前期状态作为删除依据。
- 新前端旗NEXT_PUBLIC_FAOLLA_ATTENDANCE_RETENTION_PERIODS_V2_ENABLED=1；默认关。可由fixture的periodsV2Enabled prop显式开测试。实际启用依赖183+保留182及已有前置、原v2真实Auth与保留权限，不改任何环境旗或真实账号。

## 客户端冻结接口

NEW `src/lib/merchantAttendanceRetentionPeriodsV2Client.ts` / `.test.ts`。

- `AttendanceRetentionPeriodsV2Client`构造参数 `{siteId,actorId,workerId,fromDate,throughDate,apiFetch,enabled,isCurrentAuth,timeoutMs?}`。isCurrentAuth必需；scope全固定，默认12秒timeout、最多12秒；无storage、随机operationId、POST或持久化。
- `getSnapshot/subscribe`；state精确为 `{phase:'idle'|'loading'|'ready'|'blocked',query:PeriodClosureV2Query|null,result:Extract<PeriodClosureV2Result,{kind:'list'|'versions'}>|null,selectedPeriod:PeriodClosureV2ListItem|null,message:string}`，递归freeze。
- `list()`、`nextPeriods()`、`openPeriod(periodId:string)`、`nextVersions()`均只按当前合法状态发一个GET，无自动重试／回退v1。openPeriod必须从当前list页找完整行，不能接受外部身份或任意周期号。
- `selectVersion(version:number):RetentionPeriodArtifactSelection|null`纯同步，仅ready且当前versions页存在该version时返回冻结选择，不联网、不改变源记录。
- `pause()/dispose()`清显示并立即失效旧generation／请求。隐藏、isCurrentAuth false、超时、旧generation的headers／body均不能发布或返回选择。并发读取拒绝或先明确pause，不产生双请求。
- `RetentionPeriodArtifactSelection`精确字段 `{siteId,actorId,workerId,employeeId,employeeAuthUserId,periodId,fromDate,throughDate,version,artifactId,sourceFingerprint,artifactSha256}`。
- GET path固定 `/api/merchant-enterprise/attendance/period-closures-v2`；现成V2严格query/response parser，ownerId=真实actorId，mode仅list/versions；HTTP200、JSON MIME、无跳转、fatal UTF8、严格JSON、128KiB，fetch/body共用截止。失败清结果，不绕权限／超限，不自动换协议。
- versions结果的保存身份／日期／时区／UTC范围须与所选list行一致，可接受后续业务修订或currentVersion增长；分页cursor继续使用原返回值并由既有parser验证，不能自行构造未见游标。

## 新组件与父级

NEW `MerchantAttendanceRetentionPeriodsV2Picker.tsx`（默认导出）和NEW `merchantAttendanceRetentionPeriodsV2Ui.test.tsx`。

Props为客户端构造参数去timeoutMs加 `{onSelect:(selection)=>void,onClose:()=>void,registerLeaveGuard?:(guard:(()=>boolean)|null)=>void}`。挂载只本地初始化，无GET；显示“读取长期周期”、每页明确“下一页周期”、周期行“读取此周期版本”、版本页“下一页版本”以及“核对本条归档”。明确本入口只找归档、不试算整期、不删除／保全、重复artifact可为多个版本复用。隐藏清显示；返回后仍需明确读取；390px可换行。

父Panel由root改，旧列表／原writer实现不改：父级已有草稿、pending（含实时sessionStorage原槽）、目录请求或保存请求时不准打开新selector／交接选择。selector打开时单独占该Panel，原编辑UI不并行挂载；关闭仅退回，不自动刷新。外层关闭先让子guard失效只读请求，再沿原父guard；保存结果未确认不能借新入口丢原号。选择时重核当前父级scope/API实例、无pending／草稿、当前visible，然后先关selector，再走现有record GET。源选择并不授予hold/release权限。

## 有限验收终点

1. 新客户端协议、25＋1/20＋1显式分页、>100修订/>20版本、重复artifact、相交搜索→保存范围、坏身份／游标／回复、headers/body晚到及scope失效测试。
2. 实际保留父Panel→新selector→原record GET，已有草稿／pending阻止入口，0POST，隐藏／换scope不显示旧结果，390px不横滚；严格合成API不冒称真实Auth或SQL。
3. 新接点及原保留定向回归、TypeScript、资源收尾。现有183读取与保留source的真实SQL证据沿用231，若新增SQL验收只复用原合成环境并有明确新风险假设，不重复整链刷次数。
4. 不创建真实账号，不改生产，不部署。完整受控到期处置、关联保全传播仍是C23具体未实现项；不要把100份preview上限移除或称无限容量。
