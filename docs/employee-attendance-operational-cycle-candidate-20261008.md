# 周／双周／月工时表：日期候选基础

2026-10-08。仅完成纯计算，不是周期实际采用，不提高固定19／5／0进度。

新增 `src/lib/merchantAttendanceOperationalCycle.ts` 及对应测试，复用239严格规则值。明确周起始日、双周锚点及整月范围，支持目标早于锚点的向下取整；manual／disabled／inherit分别返回明确无建议，不自选默认政策。结果保留 `candidateOnly:true, applied:false`，只含民事日期范围，不能当作规则发布或权限凭据。

指定民事日按显式 IANA 时区验证。完整周期超过既有2000–2100范围则拒绝而非截断；锚点仍接受239原0001–9999域。周期内部的跳过日期不导致整期被错误拒绝，UTC及逐日边界交给原V2服务端预览，不在浏览器复制其算法。没有自动送审、确认、封存、工资或余额计算。

主线程独立执行12项纯测试及两文件lint通过：七种周起点、锚点前后及世纪边界、闰月、夏令时167／169小时、Apia跳日、不可变对象、非法输入、既有V2严格查询接受候选范围。完整TypeScript亦通过。没有数据库、浏览器、生产或部署操作。

后续仍须：从经验证的单worker发布来源选周期；由负责人明确采用日期；在实际首次preview/send同事务保存来源版本；既有periodId的范围、本人确认和旧归档不变。不能用本纯函数代替这一执行链。

## 200实际组件浏览器有限验收

2026-10-08，新增采用意向与首次送审页面已通过四组实际浏览器验收，沿真实Admin负责人父入口及185受托授权list→detail→完整九字段scope选择宿主，使用真实Intent Launcher／Panel和Send Panel。最终运行24次API（21 GET／3 POST）、27次本地HTTP，耗时9.214秒；390px无横向溢出，外部请求0，bundle仅内存，不落盘。四组分别为负责人明确采用→原号GET→首次预览／送审丢回复及异回执保留→关闭新写后原GET核验（11 API／2 POST）；合法旧v1／v2及损坏共用槽阻止新POST并保留（3／0）；真实185授权选择、受托预览及外层离开guard（4／0）；隐藏／Auth晚POST保号、明确重取授权后原GET恢复、requester晚GET隔离与关闭零后台请求（6／1）。

首次运行前三组通过，第四组在恢复前台时Auth仍无效，因此原185工作区正确保持hidden，后续仅恢复稳定Auth回调不会自动重建旧正文；夹具错误地等待“周期采用意向”按钮，10秒后停止。当次19 API／3 POST／22 HTTP，未进行后续恢复GET，不能称四组通过。仅窄修自有夹具：明确返回授权列表，重新GET list／detail、选择真实九字段scope后再打开意向；返回及重挂均零自动HTTP，原format3字节保留。产品、协议模型、guard及30 API／4 POST／45 HTTP／180秒预算未变；新增SOURCE断言后7项轻测试及lint通过，再经批准运行才得到上述完整四组结果。

两个运行的finally均确认owned browser／context关闭、listener停止及esbuild回收。最终runner SHA256为`8002BA464FD28940546A53B1A8115AD9B13BCCB784A0B803715AFB2BB4D315BC`，测试为`8B835DE86ADF4E0BAB3F39A0390C2C09E41C6D9BE8FC207AADD966E6F0088202`。这些是实际组件操作，Auth、API、授权及资料均明确合成，`actualAuth:false / actualSql:false / realAuthority:false`；不是实际SQL采用／送审、真实权限或生产验收，不更新固定台账，不据此宣称C07或P1完成。原生首次送审原子link、本人确认／封存及旧归档保护仍按独立有限验收结果记录。
