# C23：本地合成三字段处置候选纯合同

2026-10-08。本包是已批准本地合成受控处置的纯合同基础，不是实际处置交付。不新增 SQL、HTTP、UI、审批或执行器，不改变 182 的政策／保全／释放。后续仍为单条 preview → approve → execute → recover；没有批量执行或第二套清单状态机。

## 边界与证据含义

唯一候选类别是 `location_results`。固定字段按顺序为 `captured_at`、`accuracy_meters`、`distance_meters`；将来实际执行必须把它们置 SQL NULL，不能只写墓碑。候选限 inside、三个精度字段均存在、原班次已闭合、无定位 review/discussion、无任何历史定位保全快照（包括已释放）。原 event 或任何引用 artifact 的当前保全也阻断。

纯输入只包含摘要及布尔观察，不复制三个待清字段的值。`sourceFingerprint` 是调用者提供的既有来源摘要，模块既没有来源全文也不重算它。session 的来源摘要同理。调用者的 `coverage:'complete'` 仅是完整性声明，不是数据库、权限或反向引用已核查的证明。未知／超界完整性必须阻断；空 artifact 数组只有配合调用者 complete 声明才可作空集合评估。后来接入可信来源时必须检查所有历史版本引用，不能把第一页当完整集合。

所有输出固定 `status:'preview_only'`、`candidateOnly:true`、`authorityChecked:false`、`applied:false`、`evidenceOrigin:'caller_provided'`、`sourceFingerprintVerified:false`。`candidateState:'candidate'` 只表示提供的证据满足纯条件，不是允许执行、已批准或可在生产使用。

## Exact 单条输入

`protocol:'attendance-retention-disposal-input-v1'`，顶层只有：

```
{ protocol, siteId, asOf, location, policy, dependencies, preservation }
location = {
  evidenceId, workerId, sourceFingerprint, anchorAt, reason, needsReview,
  precisionPresent: { capturedAt, accuracyMeters, distanceMeters }
}
policy = { category:'location_results', revision, retentionDays, operationId, recordedAt }
dependencies = {
  session: { state:'closed'|'open'|'unknown', sessionId, sourceFingerprint },
  review: { coverage, hasReview, hasDiscussion },
  locationSnapshotHistory: { coverage, hasAnySnapshot },
  artifacts: { coverage, items:[{ artifactId, sourceFingerprint }] }
}
preservation = {
  coverage,
  location: { revision, held, operationId, recordedAt },
  event: { revision, held, operationId, recordedAt },
  artifacts:[{ artifactId, revision, held, operationId, recordedAt }]
}
```

- `evidenceId` 是原定位结果对应的 event ID，不创造另一种对象号。所有 UUID 规范小写；siteId 为 8 位数字；stamp 为真实 UTC6；SHA 为小写 64 位十六进制。
- `reason` 沿现有 RetentionLocationSource 十个枚举；`needsReview` 必须与 reason != inside 一致。三个 precisionPresent 为布尔，不替代真实字段检查。
- `policy` 沿现 RetentionPolicy：revision 0 全空；正 revision 有 operationId/recordedAt，retentionDays 为 null 或 1..36500。null 永远不产生默认期限。due = anchorAt + days × 86400 秒，精确到微秒，到期等号成立；超出四位 UTC 年份的结果拒绝，不截断。
- revision 上限 9007199254740990。保全 revision 0 必须 held=false 且 operationId/recordedAt=null；正 revision 二者非空，revision 1 必须 held=true。观察时间不得晚于 asOf。定位保全 revision>0 与 hasAnySnapshot=true 必须一致，因为原 182 每个保全操作均存来源快照；释放不是没有历史快照。
- session unknown 时两个引用为 null；closed/open 时两个引用为非空。closed 是调用者观察而非本模块对原始事件的证明。
- coverage 只允许 complete、unknown、over_limit。每条最多 25 个规范递增、无重复 artifact ID；preservation.artifacts 必须与 dependencies.artifacts 精确同集合、同顺序。超界者只可提供有界摘要并标 over_limit，不截断后谎称 complete。
- 输入上限 64 KiB、深度 16、节点 4096、数组 25；拒绝额外／缺失键、重复 JSON 键、getter、非普通对象、循环、稀疏数组、符号、NUL、非法 Unicode、NaN／负零。解析返回分离且深冻结的值。

## 指纹与输出

模块重算 policyFingerprint、dependencyFingerprint、holdFingerprint 与 previewFingerprint；它们只绑定所提供的元数据，不把声明转成已核查事实。哈希为 UTF-8 SHA-256；固定纯标量／递归数组 tuple，数组元素逐个 JSON 编码、以 `, ` 连接（兼容 PostgreSQL jsonb 数组文本），不依赖对象键顺序。

```
P = [category, revision, retentionDays, operationId, recordedAt]
S = [state, sessionId, sourceFingerprint]
D = [S, [review.coverage, hasReview, hasDiscussion],
     [locationSnapshotHistory.coverage, hasAnySnapshot],
     [artifacts.coverage, [[artifactId, sourceFingerprint], ...]]]
H(state) = [revision, held, operationId, recordedAt]
H = [coverage, H(location), H(event), [[artifactId, ...H(state)], ...]]
L = [evidenceId, workerId, sourceFingerprint, anchorAt, reason, needsReview,
     [precisionPresent.capturedAt, precisionPresent.accuracyMeters, precisionPresent.distanceMeters]]
policyFingerprint = SHA(['attendance-retention-disposal-policy-v1', siteId, P])
dependencyFingerprint = SHA(['attendance-retention-disposal-dependencies-v1', siteId, evidenceId, D])
holdFingerprint = SHA(['attendance-retention-disposal-holds-v1', siteId, evidenceId, H])
previewFingerprint = SHA(['attendance-retention-disposal-preview-v1', siteId, asOf,
  L, ['captured_at','accuracy_meters','distance_meters'],
  policyFingerprint, dependencyFingerprint, holdFingerprint, dueAt, blockers])
```

单条输出 exact：上述六个固定安全标记，加 protocol=`attendance-retention-disposal-preview-v1`、siteId、asOf、evidenceId、workerId、fields、candidateState、evidenceCompleteness（caller_claimed_complete 或 incomplete）、dueAt、blockers、sourceFingerprint、四个计算指纹。不返回三个字段原值，也不返回审批号、执行号或权限令牌。

blockers 固定顺序：policy_unconfigured、not_due、not_inside、precision_not_present、session_not_closed、review_incomplete、location_review、location_discussion、snapshot_history_incomplete、historical_location_snapshot、artifact_dependencies_incomplete、holds_incomplete、location_held、event_held、artifact_held。多个原因同时返回；关联保全只报原因，不扩大读取正文。

可选纯批量函数输入 exact `{locationEvidenceIds, inputs}`；两者 1..25、ID 规范递增、无重复、逐项 exact 对应且 siteId/asOf 一致。整个选择也共用 64 KiB／4096 节点预算，不把单条资源上限乘以 25。返回各条独立候选，不返回整体可执行／已批准状态，不存清单。没有网络、存储、时钟取值或自动扫描。

## 本包有限验收与后续实际终点

纯测覆盖精确字段与边界、无默认期限、到期微秒等号、每类保全／历史快照／完整性阻断、ID 集合一一对应、指纹对来源／政策／依赖／保全变化敏感、恶意结构与重复 JSON、异步期间输入不可变、最多 25 条且无整体授权。

实际 NULL 更新、来源前后不变、旧归档字节不变、可信共享来源完整性、owner 审批、锁内重验、同事务旁证、故障回滚、原号恢复及必要并发仍属于后续受控执行实现。此纯模块不声称完成这些环节，更不等同物理擦除 MVCC、WAL 或备份。
