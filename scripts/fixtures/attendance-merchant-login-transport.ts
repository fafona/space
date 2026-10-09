// Limited PostgREST-shaped identity reads from the existing disposable schema.
// This adapter is not a real Auth/PostgREST service and never creates accounts.
import assert from "node:assert/strict";
import { databaseActors } from "./attendance-database-transport";

export function createAttendanceMerchantIdentityReads(exec: (sql: string) => string) {
  const errors: string[] = [];
  const read = (request: Request): Response => {
    try {
      const url = new URL(request.url), params = url.searchParams;
      assert.equal(request.method, "GET");assert.equal(params.get("select"), "id");
      const employee = url.pathname === "/rest/v1/merchant_enterprise_employees";
      assert(employee || url.pathname === "/rest/v1/merchants");
      assert.equal(params.get("limit"), employee ? "1" : "20");
      const filters = [...params].filter(([key]) => !["select", "limit"].includes(key));
      assert.equal(filters.length, 1);
      const [column, filter] = filters[0];assert(filter.startsWith("eq."));
      const value = filter.slice(3);
      if (employee) assert.equal(column, "auth_user_id");
      else assert(["user_id", "auth_user_id", "owner_user_id", "owner_id", "auth_id", "created_by", "created_by_user_id", "email", "owner_email", "contact_email", "user_email"].includes(column));
      if (column.includes("email")) {
        assert(databaseActors.some(actor => actor.email === value));
        // The minimal existing sandbox has no legacy email alias columns.
        return Response.json({ code: "42703", message: "synthetic legacy email column absent" }, { status: 400 });
      }
      assert(databaseActors.some(actor => actor.id === value));
      const table = employee ? "merchant_enterprise_employees" : "merchants";
      const rows = JSON.parse(exec(`select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]'::jsonb) from
        (select id from public.${table} where ${column}='${value}' limit ${employee ? 1 : 20}) identity_rows;`));
      return Response.json(rows);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));throw error;
    }
  };
  return { ownerId: databaseActors[0].id, read, errors };
}
