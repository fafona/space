import { captureBrowserExact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
export const exact = captureBrowserExact;
export const fail = (code = "attendance_plan_exception_invalid"): never => { throw new MerchantAttendanceError(code); };
export const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 ? captureBrowserUuid(v) : fail();
export const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^\d{8}$/.test(v) ? v : fail();
export const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[a-f0-9]{64}$/.test(v) ? v : fail();
export const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
export const integer = (v: unknown, min = 1, max = 9007199254740990): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
export const optionalUuid = (v: unknown): string | null => v === null ? null : uuid(v);
export function label(v: unknown, max = 120): string {
  if (typeof v !== "string" || !v || v !== v.trim() || [...v].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return fail();
  wellFormed(v); return v;
}
export function stamp(v: unknown, precision: 3 | 6 = 6): string {
  if (typeof v !== "string" || v.length !== (precision === 3 ? 24 : 27) || !(precision === 3 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).test(v) || v.startsWith("0000-")) return fail();
  const short = v.slice(0, 23) + "Z", ms = Date.parse(short);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== short) fail(); return v;
}
export function day(v: unknown): string {
  if (typeof v !== "string" || v.length !== 10 || v < "2000-01-01" || v > "2100-12-31") return fail();
  stamp(v + "T00:00:00.000Z", 3); return v;
}
export function micros(v: string): bigint { const s = stamp(v, v.length === 24 ? 3 : 6); return BigInt(Date.parse(s.slice(0, 23) + "Z")) * BigInt(1000) + BigInt(s.length === 27 ? s.slice(23, 26) : "0"); }
export function enumValue<T extends string>(v: unknown, choices: readonly T[]): T { return typeof v === "string" && choices.includes(v as T) ? v as T : fail(); }
function wellFormed(v: string) {
  for (let i = 0; i < v.length; i++) { const n = v.charCodeAt(i); if (n >= 0xd800 && n <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); } else if (n >= 0xdc00 && n <= 0xdfff) fail(); }
}
function checkedTree(raw: unknown, limit: number, maxArray: number, maxNodes: number) {
  let nodes = 0; const ancestors = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > maxNodes || depth > 32) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > limit) fail(); wellFormed(v); return; }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || ancestors.has(v)) return fail(); ancestors.add(v);
    const proto = Object.getPrototypeOf(v), keys = Reflect.ownKeys(v), descriptors = Object.getOwnPropertyDescriptors(v);
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > maxArray || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) { const d = descriptors[String(i)]; if (!d || !("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    } else {
      if (proto !== Object.prototype && proto !== null) fail();
      for (const key of keys) { if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return fail(); wellFormed(key); const d = descriptors[key]; if (!("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    } ancestors.delete(v);
  }; visit(raw, 0);
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > limit) fail("attendance_plan_exception_too_large");
}
export function safeTree(raw: unknown, limit = 1048576) { checkedTree(raw, limit, 1000, 50000); }
// Explicit private complete-source profile. Semantic parsers still enforce
// 2002 events/session and 4000 total; ordinary browser/archive defaults stay
// byte-for-byte bounded as before. This does not certify source completeness.
export function safePeriodSourceTree(raw: unknown, limit = 1048576) { checkedTree(raw, limit, 4000, 160000); }
export function parsePlanExceptionJson(text: string): unknown { if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > 1048576) fail("attendance_plan_exception_too_large"); const value = parseCaptureBrowserJson(text); safeTree(value); return value; }
export function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>, keys = Object.keys(aa);
  return keys.length === Object.keys(bb).length && keys.every(k => Object.hasOwn(bb, k) && same(aa[k], bb[k]));
}
