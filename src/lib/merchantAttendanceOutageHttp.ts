import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { bool, exact, freeze, safeTree, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { OUTAGE_ERRORS, assertOutageWriteQuery, parseOutageCommand, parseOutageQuery, parseOutageResult } from "./merchantAttendanceOutage";
import { OUTAGE_LINKS_ERRORS, assertOutageLinksWriteQuery, parseOutageLinksCommand, parseOutageLinksQuery, parseOutageLinksResult } from "./merchantAttendanceOutageLinks";
import { OUTAGE_REVIEW_ERRORS, assertOutageReviewWriteQuery, parseOutageReviewCommand, parseOutageReviewQuery, parseOutageReviewResult } from "./merchantAttendanceOutageReview";
import { OUTAGE_RELATIONS_ERRORS, assertOutageRelationsWriteQuery, parseOutageRelationsCommand, parseOutageRelationsQuery, parseOutageRelationsResult } from "./merchantAttendanceOutageRelations";
import type { OutageCommand, OutageQuery, OutageResult } from "./merchantAttendanceOutageContract";
import type { OutageLinksCommand, OutageLinksQuery, OutageLinksResult } from "./merchantAttendanceOutageLinksContract";
import type { OutageReviewCommand, OutageReviewQuery, OutageReviewResult } from "./merchantAttendanceOutageReviewContract";
import type { OutageRelationsCommand, OutageRelationsQuery, OutageRelationsResult } from "./merchantAttendanceOutageRelationsContract";

export interface OutageHttpQueryMap { outages: OutageQuery; links: OutageLinksQuery; reviews: OutageReviewQuery; relations: OutageRelationsQuery }
export interface OutageHttpCommandMap { outages: OutageCommand; links: OutageLinksCommand; reviews: OutageReviewCommand; relations: OutageRelationsCommand }
export interface OutageHttpResultMap { outages: OutageResult; links: OutageLinksResult; reviews: OutageReviewResult; relations: OutageRelationsResult }
export type OutageHttpKind = keyof OutageHttpQueryMap;
export type OutageHttpResponse<K extends OutageHttpKind> = { canWrite: boolean; result: OutageHttpResultMap[K] };
export const OUTAGE_APIS = Object.freeze({ outages: "/api/merchant-enterprise/attendance/outages",
  links: "/api/merchant-enterprise/attendance/outage-links", reviews: "/api/merchant-enterprise/attendance/outage-reviews",
  relations: "/api/merchant-enterprise/attendance/outage-relations" });
export const OUTAGE_HTTP_BODY_LIMIT = 32768;
export const OUTAGE_HTTP_RESPONSE_LIMIT = 2097152;
export const OUTAGE_HTTP_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...OUTAGE_ERRORS, ...OUTAGE_LINKS_ERRORS, ...OUTAGE_REVIEW_ERRORS, ...OUTAGE_RELATIONS_ERRORS,
  unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503, enterprise_entitlement_unavailable: 503,
  enterprise_management_disabled: 403, employee_password_authentication_required: 403, forbidden_origin: 403,
  method_not_allowed: 405, attendance_rate_limited: 429, attendance_body_too_large: 413, attendance_invalid_content_type: 415 });

type Body<K extends OutageHttpKind> = { query: OutageHttpQueryMap[K]; command: OutageHttpCommandMap[K] };
type Adapter<K extends OutageHttpKind> = {
  query: (raw: unknown) => OutageHttpQueryMap[K];
  body: (raw: Record<string, unknown>, actor: string) => Body<K>;
  result: (raw: unknown, q: OutageHttpQueryMap[K], actor: string, c: OutageHttpCommandMap[K] | null) => OutageHttpResultMap[K];
  invalid: string;
};
const adapters: { [K in OutageHttpKind]: Adapter<K> } = {
  outages: { query: parseOutageQuery, result: parseOutageResult, invalid: "attendance_outage_invalid",
    body: (raw, actor) => { const query = parseOutageQuery(raw.query), command = parseOutageCommand(raw.command); assertOutageWriteQuery(query, command, actor); return { query, command }; } },
  links: { query: parseOutageLinksQuery, result: parseOutageLinksResult, invalid: "attendance_outage_links_invalid",
    body: raw => { const query = parseOutageLinksQuery(raw.query), command = parseOutageLinksCommand(raw.command); assertOutageLinksWriteQuery(query); return { query, command }; } },
  reviews: { query: parseOutageReviewQuery, result: parseOutageReviewResult, invalid: "attendance_outage_review_invalid",
    body: raw => { const query = parseOutageReviewQuery(raw.query), command = parseOutageReviewCommand(raw.command); assertOutageReviewWriteQuery(query, command); return { query, command }; } },
  relations: { query: parseOutageRelationsQuery, result: parseOutageRelationsResult, invalid: "attendance_outage_relations_invalid",
    body: raw => { const query = parseOutageRelationsQuery(raw.query), command = parseOutageRelationsCommand(raw.command); assertOutageRelationsWriteQuery(query); return { query, command }; } },
};
const fail = (code = "attendance_invalid_request"): never => { throw new MerchantAttendanceError(code); };
function adapter<K extends OutageHttpKind>(kind: K): Adapter<K> {
  if (typeof kind !== "string" || !Object.hasOwn(adapters, kind)) return fail();
  return adapters[kind];
}
function boundedRaw(raw: unknown, limit: number): unknown {
  if (typeof raw === "string") {
    if (new TextEncoder().encode(raw).byteLength > limit) return fail("attendance_body_too_large");
    raw = parseCaptureBrowserJson(raw);
  }
  try { safeTree(raw, limit); }
  catch (error) {
    if (error instanceof MerchantAttendanceError && error.code === "attendance_plan_exception_too_large") return fail("attendance_body_too_large");
    throw error;
  }
  return raw;
}

// Only the relevant mode receives absent nullable cursor fields. Literal
// "null", empty strings, mixed-mode keys and duplicate keys are not aliases.
export function parseOutageHttpQuery<K extends OutageHttpKind>(kind: K, url: string): OutageHttpQueryMap[K] {
  try {
    const a = adapter(kind);
    if (typeof url !== "string" || new TextEncoder().encode(url).byteLength > OUTAGE_HTTP_BODY_LIMIT
      || /\s|[\u0000-\u001f\u007f-\u009f]|[#\\]/.test(url) || !/^https?:\/\//.test(url)) return fail();
    safeTree(url, OUTAGE_HTTP_BODY_LIMIT);
    // URLSearchParams otherwise silently replaces invalid percent UTF-8. Check
    // the original spelling before URL normalization can discard it.
    if (/[\u0000-\u001f\u007f-\u009f]/.test(decodeURIComponent(url))) return fail();
    const parsed = new URL(url), values: Record<string, unknown> = Object.create(null);
    if (parsed.username || parsed.password || parsed.hash) return fail();
    const keys = kind === "outages" ? ["siteId", "access", "mode", "afterId", "incidentId", "declarationId", "operationId"]
      : ["siteId", "access", "mode", "declarationId", "beforeRevision", "operationId", ...(kind === "links" ? ["sources"] : []),
        ...(kind === "relations" ? ["relatedDeclarationId"] : [])];
    for (const [key, value] of parsed.searchParams) {
      if (!keys.includes(key) || Object.hasOwn(values, key)) return fail();
      if (key === "sources") values[key] = parseCaptureBrowserJson(value);
      else if (key === "beforeRevision") {
        if (!/^[1-9][0-9]*$/.test(value)) return fail();
        values[key] = Number(value);
      } else values[key] = value;
    }
    if (kind === "outages" && (values.mode === "incidents" || values.mode === "declarations") && !Object.hasOwn(values, "afterId")) values.afterId = null;
    if (kind !== "outages" && values.mode === "history" && !Object.hasOwn(values, "beforeRevision")) values.beforeRevision = null;
    return freeze(a.query(values));
  } catch { return fail(); }
}

export function outageHttpQueryString<K extends OutageHttpKind>(kind: K, query: OutageHttpQueryMap[K]): string {
  try {
    const q = adapter(kind).query(query), params = new URLSearchParams();
    for (const [key, value] of Object.entries(q)) if (value !== null) params.set(key, key === "sources" ? JSON.stringify(value) : String(value));
    return params.toString();
  } catch { return fail(); }
}

export function parseOutageHttpBody<K extends OutageHttpKind>(kind: K, raw: unknown, actorId: string): Body<K> {
  try { return freeze(adapter(kind).body(exact(boundedRaw(raw, OUTAGE_HTTP_BODY_LIMIT), ["query", "command"]), uuid(actorId))); }
  catch (error) {
    if (error instanceof MerchantAttendanceError && error.code === "attendance_body_too_large") throw error;
    return fail();
  }
}

// Recover is a GET with command=null. A client with a durable pending intent
// must separately match its original write tuple hash; do not convert recovery
// into a POST or pretend its query was the original write query.
export function parseOutageHttpResponse<K extends OutageHttpKind>(kind: K, raw: unknown, q: OutageHttpQueryMap[K], actor: string,
  c: OutageHttpCommandMap[K] | null = null): OutageHttpResponse<K> {
  const a = adapter(kind);
  try {
    const body = exact(boundedRaw(raw, OUTAGE_HTTP_RESPONSE_LIMIT), ["ok", "canWrite", "data"]);
    if (body.ok !== true) return fail();
    const canWrite = bool(body.canWrite), result = a.result(body.data, q, actor, c);
    if (!canWrite && result.canWrite) return fail();
    return freeze({ canWrite, result });
  } catch { return fail(a.invalid); }
}
