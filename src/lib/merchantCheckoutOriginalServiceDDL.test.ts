import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("original service proposal compiles, defaults closed and grants no browser/API role authority", async () => {
  const db = new PGlite();
  try { await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema faolla_checkout_design;");
    await db.exec(await readFile("database/proposals/20261124_member_checkout_original_service.sql", "utf8"));
    assert.equal((await db.query<{ n: number }>("select count(*)::int n from faolla_checkout_design.original_service_pilots where enabled")).rows[0].n, 0);
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal((await db.query<{ allowed: boolean }>("select has_table_privilege($1,$2,$3) allowed", [role, "faolla_checkout_design.original_service_pilots", "SELECT,INSERT,UPDATE,DELETE"])).rows[0].allowed, false);
      for (const signature of ["faolla_member_checkout_original_service_review_v1(text,text,text)", "faolla_member_checkout_original_service_cancel_v1(text,text,text,text,text,text)"])
        assert.equal((await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,$3) allowed", [role, "public." + signature, "EXECUTE"])).rows[0].allowed, false);
    }
  } finally { await db.close(); }
});
