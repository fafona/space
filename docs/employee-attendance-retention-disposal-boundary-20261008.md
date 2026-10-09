# C23：首个受控处置对象的实施边界

2026-10-08。用户已批准本地合成资料的人工影响预览、关联保全检查、明确审批及受控执行。本记录是实施建议，不是已交付的删除功能，不授权生产资料处置。

## 选择定位精度字段，不选择孤儿归档

正常149／183／187周期写入总是同时保存artifact、version和creation entry；149的版本外键与延迟创建回执外键、186的委托归档旁证检查形成持久引用。同源复用不产生孤儿正文。因此不能手工造无引用archive，冒充正常业务可用的处置闭环。

最窄首包是`location_results`单条三字段脱敏：真实把`captured_at`、`accuracy_meters`、`distance_meters`更新为SQL NULL，保留event_id、分类、needs_review、版本及原始事实。首版限reason=inside、完整已闭合原班次、无定位review/discussion、无任何历史定位保全快照，包括已release快照。072明确设备坐标不进入SQL，不虚构GPS坐标库。

148的session source只收录原事件；141定位计划证明及178故障原号证明依赖定位行存在、版本和notice，不依赖上述三字段。应以真实前后source指纹及旧归档字节不变验证此边界，不能只凭静态分析声称已通过。

## 必须完成的窄兼容

- 新增单条preview／approve／execute／recover协议及不可变审批、执行账本。批准绑定原对象、字段集合、来源／政策／依赖／保全指纹；执行锁内重新核对。账本只存最小元数据和摘要，不复制待清明文。未知结果只核原号，不自动执行。
- 072原CHECK要求measured reason三个字段非空，原append-only禁止UPDATE。候选迁移必须精确核旧定义，为此表增加可证明的disposed状态和专用、始终启用的更新guard；只允许同事务执行旁证对应的一次三字段归零及其余列原样。禁止修改共享append-only函数、关闭trigger、通用UPDATE／DELETE／TRUNCATE。执行旁证需要事务末完整性检查，不能只有回执没有实际脱敏。
- LocationClock parser、Schedule嵌套clock、Retention parser当前都拒绝inside+NULL。须新增严格disposed读取分支与明确页面说明，保留原打卡编号／事件回执／授权校验；不能把reason改成not_provided或填造数值。未处置读取保持原合同。
- 182 preservation_operations.source_snapshot保存完整来源；release后仍留明文，record helper还要求原快照等于当前来源。首版把任何历史定位快照列为阻断，不重写旧账本，不宣称这类副本已清理。
- 关联保全使用真实共享来源反向引用元数据：检查原event及所有引用artifact，不只当前版本。完整覆盖未知或超过有界检查上限直接拒绝。批准与执行不能把分页第一页当完整依赖集合。
- 锁序沿merchant SHARE→settings UPDATE→worker／目标定位行；与政策、hold/release、归档创建共享序列化边界。旧owner移交不能默继承旧批准。

## 有限验收与明确不包含

用正常定位写入产生的合成inside班次完成一次真实处置；检查三字段确为NULL、其他原行及归档正文／SHA／周期source指纹不变。分别验证event／artifact保全、旧定位快照阻断；批准后政策／来源／保全变化零写拒绝；故障整事务回滚；丢响应原号GET核验及重复执行不重复修改；原打卡回执明确显示精度已处置。仅针对新共享锁补必要hold与execute竞争。

这是真实活动数据库字段脱敏，不是整条记录删除，也不代表MVCC旧版本、WAL或备份已物理擦除；不得冒称匿名化或完整C23已完成。所有候选仅在owned合成schema安装、执行并由父流程清理，默认关闭；生产期限、真实处置、备份期限与不可逆恢复政策另行落实。
