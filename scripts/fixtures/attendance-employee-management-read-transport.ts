// Local synthetic acceptance only. The caller supplies an ownership-checked,
// namespace-rewriting exec. Never install this transport in an application.
import { buildPlatformMerchantSnapshotBlocks, normalizePlatformMerchantSnapshotPayload, PLATFORM_MERCHANT_SNAPSHOT_SLUG } from "../../src/lib/platformMerchantSnapshot";

const site = "99990001", origin = "https://attendance-auth.invalid", service = "attendance-synthetic-service";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const syntheticAuth = /^00000000-0000-4000-8000-\d{12}$/;
const ownerColumns = ["user_id", "auth_user_id", "owner_user_id", "owner_id", "auth_id", "created_by", "created_by_user_id"];
const roleColumns = "id,merchant_id,name,description,permissions,access_scope,status,is_system,version,created_at,updated_at";
const employeeAuthColumns = "id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,version,created_at,updated_at";
const snapshots = {
  merchant_enterprise_roles: [roleColumns, "created_at.asc,id.asc"],
  merchant_enterprise_role_boards: ["merchant_id,role_id,board_id,created_at", "created_at.asc,role_id.asc,board_id.asc"],
  merchant_enterprise_employees: ["id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,invitation_version,invitation_expires_at,invitation_revoked_at,invitation_sent_at,invitation_delivery_status,version,created_at,updated_at", "created_at.asc,id.asc"],
  merchant_task_boards: ["id,merchant_id,name,description,position,status,version,created_at,updated_at", "position.asc,id.asc"],
  merchant_task_columns: ["id,merchant_id,board_id,name,color,position,is_done,status,version,created_at,updated_at", "position.asc,id.asc"],
  merchant_tasks: ["id,merchant_id,board_id,column_id,title,description,priority,due_at,completed_at,archived_at,position,source_type,source_id,created_by_employee_id,version,created_at,updated_at", "position.asc,created_at.asc,id.asc"],
  merchant_task_assignees: ["merchant_id,task_id,employee_id,assigned_at", "assigned_at.asc,task_id.asc,employee_id.asc"],
} as const;
type SnapshotTable = keyof typeof snapshots;
type Options = { syntheticAuthUserIds: readonly string[]; enterpriseEnabled?: () => boolean };
type Call = { table: string; shape: string; offset: number; limit: number; object: boolean };
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function requireShape(condition: unknown): asserts condition { if (!condition) throw Error("employee_management_read_forbidden"); }
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function createAttendanceEmployeeManagementReadTransport(exec: (sql: string) => string, options: Options) {
  requireShape(options && Array.isArray(options.syntheticAuthUserIds) && options.syntheticAuthUserIds.length > 0
    && options.syntheticAuthUserIds.length <= 32 && options.syntheticAuthUserIds.every(id => syntheticAuth.test(id))
    && new Set(options.syntheticAuthUserIds).size === options.syntheticAuthUserIds.length);
  const actors = new Set(options.syntheticAuthUserIds), calls: Call[] = [], errors: string[] = [];
  const read = (request: Request): Response => {
    try {
      const url = new URL(request.url), p = url.searchParams;
      requireShape(request.method === "GET" && url.origin === origin && !url.hash && !url.username && !url.password);
      requireShape(request.headers.get("apikey") === service && request.headers.get("authorization") === "Bearer " + service);
      requireShape(!request.headers.has("prefer") && !request.headers.has("content-profile")
        && (!request.headers.has("accept-profile") || request.headers.get("accept-profile") === "public"));
      requireShape([...p.keys()].length === new Set(p.keys()).size && url.pathname.startsWith("/rest/v1/"));
      const table = url.pathname.slice("/rest/v1/".length), columns = p.get("select");
      requireShape(columns && (table === "merchants" || table === "pages" || Object.hasOwn(snapshots, table)));
      const accept = request.headers.get("accept") ?? "application/json";
      requireShape(["application/json", "*/*", "application/vnd.pgrst.object+json"].includes(accept));
      const object = accept === "application/vnd.pgrst.object+json";
      const keys = (names: string[]) => [...p.keys()].sort().join(",") === names.sort().join(",");
      const eqUuid = (name: string) => {
        const value = p.get(name); requireShape(typeof value === "string");
        requireShape(value.startsWith("eq.") && uuid.test(value.slice(3))); return value.slice(3);
      };
      const authId = (name: string) => { const id = eqUuid(name); requireShape(actors.has(id)); return id; };
      const noRange = () => requireShape(!request.headers.has("range") && !request.headers.has("range-unit"));
      let shape = "", where = "", order = "", offset = 0, limit = 1;
      if (table === "pages") {
        noRange();
        requireShape(keys(["select", "merchant_id", "slug", "limit"]) && p.get("merchant_id") === "is.null"
          && p.get("slug") === "eq." + PLATFORM_MERCHANT_SNAPSHOT_SLUG && p.get("limit") === "1"
          && ["blocks", "id,blocks"].includes(columns));
        // Explicit synthetic platform entitlement: no pages SQL, cache or live fallback.
        const blocks = buildPlatformMerchantSnapshotBlocks(normalizePlatformMerchantSnapshotPayload({ revision: "synthetic-employee-management",
          snapshot: [{ id: site, name: "合成员工管理企业", merchantName: "合成员工管理企业", status: "online",
            permissionConfig: { allowEnterpriseManagement: options.enterpriseEnabled?.() ?? true } }] }));
        const row = columns === "blocks" ? { blocks } : { id: "synthetic-employee-management-platform", blocks };
        calls.push({ table, shape: "synthetic-platform-entitlement", offset, limit, object });
        return response(object ? row : [row]);
      }
      if (table === "merchants") {
        noRange(); requireShape(keys(["select", "id", "or", "limit"]) && columns === "id,name,email"
          && p.get("id") === "eq." + site && p.get("limit") === "1");
        const filter = p.get("or") ?? "";
        const actor = [...actors].find(id => filter === "(" + ownerColumns.map(column => column + ".eq." + id).join(",") + ")");
        requireShape(actor); where = "id=" + quote(site) + " and (" + ownerColumns.map(column => column + "=" + quote(actor)).join(" or ") + ")";
        shape = "current-owner";
      } else if (table === "merchant_enterprise_employees" && columns === "id") {
        noRange(); requireShape(keys(["select", "auth_user_id", "limit"]) && p.get("limit") === "1" && !object);
        // isMerchantStaffPrincipal is globally keyed in production. This fixture
        // deliberately sees only its synthetic tenant and explicitly named actors.
        where = "merchant_id=" + quote(site) + " and auth_user_id=" + quote(authId("auth_user_id")); shape = "synthetic-tenant-staff-principal";
      } else {
        requireShape(p.get("merchant_id") === "eq." + site); where = "merchant_id=" + quote(site);
        const snapshot = snapshots[table as SnapshotTable];
        if (snapshot && columns === snapshot[0] && p.get("order") === snapshot[1]) {
          requireShape(!object); shape = "snapshot-page";
          const range = request.headers.get("range");
          if (range !== null) {
            requireShape(keys(["select", "merchant_id", "order"]) && /^\d+-\d+$/.test(range)
              && (!request.headers.has("range-unit") || request.headers.get("range-unit") === "items"));
            const [from, to] = range.split("-").map(Number); offset = from; limit = to - from + 1;
          } else {
            noRange(); requireShape(keys(["select", "merchant_id", "order", "offset", "limit"]));
            requireShape(/^(0|[1-9]\d*)$/.test(p.get("offset") ?? "") && p.get("limit") === "500");
            offset = Number(p.get("offset")); limit = 500;
          }
          requireShape(Number.isSafeInteger(offset) && offset >= 0 && offset <= 9500 && offset % 500 === 0 && limit === 500);
          order = snapshot[1].split(",").map(term => term.replace(".asc", " asc")).join(",");
        } else if (table === "merchant_enterprise_employees" && columns === employeeAuthColumns) {
          noRange(); requireShape(keys(["select", "merchant_id", "auth_user_id", "status", "limit"]) && p.get("status") === "eq.active" && p.get("limit") === "1");
          where += " and auth_user_id=" + quote(authId("auth_user_id")) + " and status='active'"; shape = "current-employee";
        } else if (table === "merchant_enterprise_roles" && columns === roleColumns) {
          noRange(); requireShape(keys(["select", "merchant_id", "id", "status", "limit"]) && p.get("status") === "eq.active" && p.get("limit") === "1");
          where += " and id=" + quote(eqUuid("id")) + " and status='active'"; shape = "current-role";
        } else if (table === "merchant_enterprise_role_boards" && columns === "board_id") {
          noRange(); requireShape(keys(["select", "merchant_id", "role_id", "order"]) && p.get("order") === "board_id.asc" && !object);
          where += " and role_id=" + quote(eqUuid("role_id")); order = "board_id asc"; limit = 10001; shape = "current-role-boards";
        } else if (table === "merchant_enterprise_roles" && columns === "system_key") {
          noRange(); requireShape(keys(["select", "merchant_id", "system_key"]) && p.get("system_key") === "in.(administrator,supervisor,employee)" && !object);
          where += " and system_key in ('administrator','supervisor','employee')"; limit = 10001; shape = "bootstrap-roles";
        } else if (table === "merchant_task_boards" && columns === "id,system_key") {
          noRange(); requireShape(keys(["select", "merchant_id", "system_key", "limit"]) && p.get("system_key") === "eq.default" && p.get("limit") === "1");
          where += " and system_key='default'"; shape = "bootstrap-board";
        } else if (table === "merchant_task_columns" && columns === "system_key") {
          noRange(); requireShape(keys(["select", "merchant_id", "board_id", "system_key"]) && p.get("system_key") === "in.(todo,in_progress,blocked,done)" && !object);
          where += " and board_id=" + quote(eqUuid("board_id")) + " and system_key in ('todo','in_progress','blocked','done')"; limit = 10001; shape = "bootstrap-columns";
        } else throw Error("employee_management_read_forbidden");
      }
      calls.push({ table, shape, offset, limit, object });
      // All SQL identifiers originate exclusively in exact allowed shapes above.
      const sql = `begin read only; set local role service_role; select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb)::text from (select ${columns} from public.${table} where ${where}${order ? " order by " + order : ""} limit ${limit} offset ${offset}) q; rollback;`;
      let rows: unknown;
      try { rows = JSON.parse(exec(sql).trim()); } catch { throw Error("employee_management_read_unavailable"); }
      requireShape(Array.isArray(rows) && rows.length <= limit && rows.length <= 10000 && rows.every(row => row !== null && typeof row === "object" && !Array.isArray(row)));
      if (object) {
        if (rows.length !== 1) return response({ code: "PGRST116", details: `The result contains ${rows.length} rows`, message: "Cannot coerce the result to a single JSON object" }, 406);
        return response(rows[0]);
      }
      return response(rows);
    } catch (error) {
      const code = error instanceof Error && error.message === "employee_management_read_unavailable" ? error.message : "employee_management_read_forbidden";
      errors.push(code); throw Error(code); // Never expose URL credentials or raw SQL failures.
    }
  };
  return { read, calls, errors };
}
