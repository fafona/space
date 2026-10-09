/** Presentation only. The caller must freshly authorize both reads and verify
 * their raw source hashes with the real projectors before passing public DTOs.
 * Re-parsing here checks shape and cross-scope consistency, not authentication,
 * freshness, a paper signature, or successful physical printing. */
import { parseOutageResult } from "./merchantAttendanceOutage";
import type { OutageDeclaration, OutageResult } from "./merchantAttendanceOutageContract";
import type { OutageLinkSnapshot } from "./merchantAttendanceOutageLinksContract";
import { parseOutageReviewResult } from "./merchantAttendanceOutageReview";
import type { OutageReviewEntry, OutageReviewResult, OutageReviewStatus } from "./merchantAttendanceOutageReviewContract";
import { safeTree, same } from "./merchantAttendancePlanExceptionValidation";

const MAX_SOURCES = 10; // The existing 177 evidence limit; never silently truncate.
const MAX_DOCUMENT_BYTES = 256 * 1024;
const invalid = (): never => { throw Error("attendance_outage_print_invalid"); };
const tooLarge = (): never => { throw Error("attendance_outage_print_too_large"); };
const escape = (value: string | number) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const channels = { web: "网页", location: "定位入口", onsite: "现场扫码", pin: "固定终端工号／PIN入口（不记录PIN）", other: "其他" };
const actions = { propose: "负责人提出结果", confirm: "本人确认", dispute: "本人异议", resolve: "负责人结案", reopen: "负责人重开" };
const blockers: Record<OutageReviewStatus["blockers"][number], string> = {
  source_open: "来源班次尚未闭合", pending_source: "来源仍有待处理申请", source_changed: "来源依据已变化", source_unavailable: "来源无法核验",
  identity_changed: "人员身份已变化", source_outside_declaration: "来源不在声明区间内", duplicate_source: "存在重复来源", link_missing: "尚未关联来源",
  link_revoked: "来源关联已撤销", link_changed: "来源关联已变化", original_unknown: "原操作结果尚未查明", employee_unavailable: "员工当前资格不可用",
  account_suspended: "考勤账号处于暂停状态", result_missing: "尚未提出核对结果", result_changed: "保存结果已不对应当前依据",
  unconfirmed: "本人尚未确认本结果版本", disputed: "本人已提出异议", reopened: "结果已重开，须继续核对",
};
const css = `@page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#111;font:10pt/1.55 Arial,"Microsoft YaHei",sans-serif}h1{font-size:18pt;margin:0 0 3mm}h2{font-size:12pt;margin:5mm 0 2mm}h3{font-size:10.5pt;margin:3mm 0 1mm}p{margin:1.5mm 0;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:40mm 1fr;margin:2mm 0;gap:1mm 3mm}dt{font-weight:bold}dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}.notice{border:1px solid #333;padding:2.5mm}.small{font-size:8.5pt}.lines{min-height:20mm;border:1px solid #777;padding:2mm}.tall{min-height:34mm}.field{min-height:10mm;border-bottom:1px solid #888;padding-top:2mm}.page+.page{break-before:page;page-break-before:always}.block,li{break-inside:avoid;page-break-inside:avoid}ul,ol{padding-left:6mm;margin:2mm 0}footer{border-top:1px solid #999;margin-top:4mm;padding-top:2mm;font-size:8pt}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #888;text-align:left;padding:2mm;overflow-wrap:anywhere}.signature{min-height:15mm}@media screen{body{max-width:182mm;margin:8mm auto;padding:0 3mm}.page{margin-bottom:8mm}}`;

function document(kind: "blank" | "handoff", title: string, body: string): string {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${escape(title)}</title><style>${css}</style></head><body data-attendance-outage-print-document="${kind}">${body}</body></html>`;
  if (new TextEncoder().encode(html).byteLength > MAX_DOCUMENT_BYTES) tooLarge();
  return html;
}
const rows = (values: [string, string | number][]) => `<dl>${values.map(([name, value]) => `<dt>${escape(name)}</dt><dd>${escape(value)}</dd>`).join("")}</dl>`;
const field = (name: string) => `<div class="field">${escape(name)}：________________________________________________</div>`;
const safeguards = "本表不是打卡成功凭据、工资确认或申请期限豁免；不增加工时，不替代本人在线确认、负责人结案或周期封存。禁止填写PIN、密码、验证码、定位轨迹及无关敏感资料。";

/** Deterministic, personal-data-free blank form. Print/save it before an outage. */
export function buildOutageBlankPrintDocument(): string {
  return document("blank", "故障备用登记表（单人单表）", `<section class="page" aria-label="空白备用表第1页">
    <h1>故障备用登记表</h1><p>单人单表 · 第 1／2 页 · 声明记录</p><p class="notice">${safeguards}</p>
    <p class="small">请提前打印并妥善保管。服务器停机时，不承诺能够打开未缓存网页；本纸表不代表网页已离线完成可信打卡。</p>
    ${field("商户名称／编号")}${field("地点名称／编号")}${field("纸表编号（两页填写相同编号）")}
    <h2>一、故障与申报时段</h2><p>故障类型：□网络　□设备　□服务　□其他：________</p><p>使用入口：□网页　□定位　□现场扫码　□固定终端　□其他：________</p>
    ${field("申报开始（当地年月日、时分秒）")}${field("申报结束（当地年月日、时分秒）")}
    ${field("IANA时区（例如 Europe/Madrid）")}<p>开始UTC偏移：±____:____　结束UTC偏移：±____:____</p>
    <p class="small">记录两端偏移；跨午夜分别写日期。夏令时重复／不存在的时间须在恢复后明确核验；不确定就注明，不猜测。</p>
    <h2>二、本人声明</h2>${field("姓名")}${field("工号（如有）")}
    <p>原操作编号：________________________________　□未知／未保存</p><p>原通道：□网页　□定位　□现场扫码　□固定终端　□其他　□未知</p>
    <p class="small">未知、超时或查无回执不代表原操作失败；不得因此擅自重复打卡。</p>
    <div class="lines tall">事实说明（实际尝试、观察到的结果、工作／休息时段；不自行作核定结论）：</div>
    <footer>本页与第2页共同交接；空白表不含预填个人资料。纸张签字仅留证，不冒充系统本人确认。</footer></section>
    <section class="page" aria-label="空白备用表第2页"><h1>恢复核对与资料交接</h1><p>单人单表 · 第 2／2 页</p>
    ${field("商户／地点")}${field("纸表编号（与第1页一致）")}${field("声明人姓名／工号")}
    <h2>三、声明与代录分别留名</h2><div class="signature">声明人签名：________________　签名日期时间／时区：________________</div>
    <div class="signature">代录人姓名／签名（无则写无）：________________</div><p>代录日期时间／时区：________________　代录依据：________________</p>
    <p class="small">负责人代录必须标明实际登记人，不代替声明人在线确认。签字不证明打卡成功或核定工时。</p>
    <h2>四、恢复后逐项核对</h2><ol>
    <li>核对当前人员身份、故障区间、时区与偏移；沿既有故障入口录入并保存纸表参考。</li>
    <li>先按原编号查询；未知结果继续保留编号，不换号自动重提。发现重复登记，明确记录引用并交负责人处理，不静默合并。</li>
    <li>需要补正／整段漏卡时，先走原申请流程保存，再明确关联；关联失败不撤销或重复提交原申请。</li>
    <li>检查开放班次、待审申请及来源变化；负责人提出精确结果，本人确认或异议后再按权限结案。</li>
    <li>相关周期重新核对与确认；旧封存文件保持，不把本表当作解除封存或期限豁免。</li></ol>
    ${field("故障事件编号／逐人声明编号")}${field("待查原号／重复纸表引用／后续负责人")}
    <div class="lines">尚未完成事项与约定核查时间：</div>
    <h2>五、纸面交接签收（仅资料交接）</h2><p>交出人／签名：________________　接收人／签名：________________</p>
    <p>交接日期时间／时区：________________　页数／附件数（无则0）：________</p>
    <p class="notice">签收只表示接收资料，不表示本人确认、结案、出勤认可或工资认可。保管副本；平台撤权不能收回已打印资料。</p>
    <footer>${safeguards}</footer></section>`);
}

function checked(declaration: OutageResult, review: OutageReviewResult): { declaration: OutageDeclaration; detail: OutageResult; review: OutageReviewResult } {
  try {
    // Check descriptors before accessing untrusted fields (including getters).
    safeTree(declaration, 262144); safeTree(review, 1048576);
    if (declaration.access !== "owner" || declaration.mode !== "declaration" || declaration.detail?.kind !== "declaration"
      || review.access !== "owner" || review.mode !== "detail" || review.siteId !== declaration.siteId || review.actorId !== declaration.actorId
      || review.declarationId !== declaration.detail.id) return invalid();
    if (Array.isArray(review.proposal?.evidence?.linkEvidence?.items) && review.proposal.evidence.linkEvidence.items.length > MAX_SOURCES) return tooLarge();
    const detail = parseOutageResult(declaration, { siteId: declaration.siteId, access: "owner", mode: "declaration", declarationId: declaration.detail.id }, declaration.actorId);
    const result = parseOutageReviewResult(review, { siteId: detail.siteId, access: "owner", mode: "detail", declarationId: declaration.detail.id }, detail.actorId);
    if (detail.detail?.kind !== "declaration") return invalid();
    const saved = detail.detail, proposal = result.proposal;
    if (proposal) {
      const evidence = proposal.evidence.linkEvidence, original = proposal.evidence.original;
      // Version/generation are observations at different saves, not equalities.
      if (evidence.workerId !== saved.workerId || evidence.employeeId !== saved.employeeId || evidence.employeeAuthUserId !== saved.employeeAuthUserId
        || !same(evidence.declaredInterval, saved.interval) || original.operationId !== saved.originalOperationId || original.channel !== saved.originalChannel
        || proposal.recordedAt < saved.recordedAt) return invalid();
    }
    return { declaration: saved, detail, review: result };
  } catch (error) {
    if (error instanceof Error && error.message === "attendance_outage_print_too_large") throw error;
    return invalid();
  }
}
const offset = (value: number) => `${value < 0 ? "−" : "+"}${String(Math.floor(Math.abs(value) / 60)).padStart(2, "0")}:${String(Math.abs(value) % 60).padStart(2, "0")}`;
const spanText = (span: OutageLinkSnapshot["selected"]) => `${span.startAt} → ${span.endAt ?? "尚未闭合（无结束时刻）"}`;
function entrySection(title: string, entry: OutageReviewEntry | null): string {
  if (!entry) return `<section class="block"><h2>${escape(title)}</h2><p>尚无保存记录。</p></section>`;
  return `<section class="block"><h2>${escape(title)}</h2>${rows([["保存动作", actions[entry.action]], ["核对修订／结果版本", `${entry.revision}／${entry.resultVersion}`],
    ["操作编号", entry.operationId], ["记录时刻（UTC）", entry.recordedAt], ["保存理由", entry.reason]])}</section>`;
}
function source(item: OutageLinkSnapshot, index: number): string {
  const ref = item.reference;
  const refs: [string, string | number][] = ref.kind === "session"
    ? [["起始事件／末事件", `${ref.startEventId}／${ref.lastEventId}`], ["末序号", ref.lastSequence], ["核定操作／版本", ref.effectOperationId === null ? "无核定操作" : `${ref.effectOperationId}／${ref.effectRevision}`]]
    : [["漏卡申请／根申请", `${ref.requestId}／${ref.rootRequestId}`], ["批准操作编号", ref.approvalOperationId]];
  return `<section class="block"><h3>${index + 1}. ${ref.kind === "session" ? "真实班次引用" : "已批整段漏卡引用"}</h3>${rows([...refs,
    ["来源时区", item.timeZone], ["原始端点（UTC）", item.original ? spanText(item.original) : "无原始打卡；不得冒充原始班次"],
    ["采用端点（UTC）", spanText(item.selected)], ["保存时标记", `${item.open ? "开放班次" : "已闭合"}；${item.pending ? "存在待处理申请" : "当时无待处理标记"}`]])}</section>`;
}

/** Minimal single-declaration handoff; never prints Auth IDs, full evidence,
 * hashes or history pages. The two reads are not a cross-request atomic snapshot. */
export function buildOutageHandoffPrintDocument(declaration: OutageResult, review: OutageReviewResult): string {
  const { declaration: saved, detail, review: checkedReview } = checked(declaration, review);
  const status = checkedReview.status;
  if (!status) return invalid();
  const items = checkedReview.proposal?.evidence.linkEvidence.items ?? [];
  if (items.length > MAX_SOURCES) return tooLarge();
  const original = checkedReview.proposal?.evidence.original;
  const originalStatus = original?.status === "verified" ? "保存结果当时已核验原操作；不代表当前依据仍有效。"
    : original?.status === "unresolved" ? "原操作结果尚未查明，不代表失败；需继续按原号核查。"
      : saved.originalOperationId === null ? "未提供原操作编号；不据此认定没有原记录或原操作失败。" : "尚无保存结果证明原操作状态；需按原号核查。";
  return document("handoff", "故障声明与恢复核对交接单", `<h1>故障声明与恢复核对交接单</h1>
    <p class="notice">单声明、负责人授权读取的核对摘要；不是完整历史、打卡成功凭据、工资表或新的业务决定。${safeguards}</p>
    ${rows([["商户编号", detail.siteId], ["故障事件编号", saved.incidentId], ["逐人声明编号", saved.id], ["声明读取时刻（UTC）", detail.readAt], ["核对读取时刻（UTC）", checkedReview.readAt]])}
    <p class="small">两个读取时刻分别列示，并非跨请求原子快照；输出后状态仍可能变化。继续办理前须重新授权读取，不能凭纸面摘要恢复资格。</p>
    <section><h2>一、保存的逐人声明</h2>${rows([["考勤人员编号", saved.workerId], ["企业员工编号", saved.employeeId],
    ["保存时人员版／员工版／暂停代次", `${saved.workerVersion}／${saved.employeeVersion}／${saved.generation}`],
    ["记录方式", saved.recordedBy === "owner" ? "负责人代录（不是本人提交或本人确认）" : "本人声明（不是核对结果确认）"],
    ["声明保存时刻（UTC）", saved.recordedAt], ["纸面参考", saved.paperReference ?? "未提供"], ["申报开始（UTC）", saved.interval.startAt], ["申报结束（UTC）", saved.interval.endAt],
    ["申报IANA时区", saved.interval.timeZone], ["开始／结束UTC偏移", `${offset(saved.interval.startOffsetMinutes)}／${offset(saved.interval.endOffsetMinutes)}`],
    ["事实声明", saved.statement], ["原操作编号", saved.originalOperationId ?? "未知／未提供"], ["原操作通道", saved.originalChannel ? channels[saved.originalChannel] : "未知／未提供"]])}<p>${escape(originalStatus)}</p></section>
    <section class="block"><h2>二、读取时的当前状态</h2><p class="notice">${status.resolved ? "当前已核完（仅截至本次核对读取时刻）" : "当前尚未核完；不得将旧结案动作当作当前有效结案。"}</p>
    ${rows([["当前核对修订", checkedReview.revision], ["当前结果版本", checkedReview.resultVersion], ["当前关联操作／版本", status.linkOperationId ? `${status.linkOperationId}／${status.linkRevision}` : "尚无关联"]])}
    ${status.blockers.length ? `<ul>${status.blockers.map(code => `<li>${escape(blockers[code])}（${escape(code)}）</li>`).join("")}</ul>` : "<p>本次读取未列出阻断项；不替代正式操作时的重新核验。</p>"}</section>
    ${entrySection("三、保存的负责人提案（不是当前结案状态）", checkedReview.proposal)}
    ${entrySection("四、保存的本人回应（仅对应所列结果版本）", checkedReview.response)}
    ${entrySection("五、最新保存动作（历史动作，不等于当前有效性）", checkedReview.current)}
    <section><h2>六、提案保存时的来源摘要</h2><p>共 ${items.length} 条；此处全部列出本提案来源，不输出全部历史或完整证据。来源若已变化，以下端点仍是保存值，不冒充重新核验的当前端点。</p>
    ${items.length ? items.map(source).join("") : "<p>尚未提出结果，暂无已保存的提案来源；不代表没有考勤记录。</p>"}</section>
    <section class="block"><h2>七、资料交接签收</h2><p>纸面编号／份数：________________　尚需处理事项：________________</p><p>交出人／签名：________________　接收人／签名：________________</p><p>交接日期时间／时区：________________</p>
    <p class="notice">签收只表示接收资料，不新增本人确认、负责人结案或周期确认。纸张或另存文件无法通过平台撤权收回，请妥善保管；本系统不证明已经出纸。</p></section>
    <footer>不打印登录Auth标识、凭证、完整证据指纹或JSON；不自动修改工时、原始记录、旧封存或申请期限。</footer>`);
}
