import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_ADMIN_BACKUP_WRITE_UNCONFIRMED as ERROR, readPlatformAdminBackupRowForWriteStrict as read,
  persistPlatformAdminBackupRowStrict as write, type StrictPlatformAdminBackupWriteClient } from "./platformAdminBackupStrictWrite";
import { PLATFORM_ADMIN_DATA_BACKUP_SLUG as SLUG } from "./platformAdminDataBackup";

function fixture() {
  const state = { exists: true, owner: null as string | null, duplicate: false, columnsMissing: false,
    id: "synthetic-id", blocks: { version: 1, values: [1, 2] } as unknown,
    ack: "good", tamper: false, writes: 0, queries: 0, filters: [] as string[], reading: false };
  const client = { from(table: string) {
    assert.equal(table, "pages"); state.queries += 1;
    let scoped = false; let slug = ""; let id: unknown; let body: Record<string, unknown> | null = null;
    let limit = 0;
    const execute = async () => {
      if (state.columnsMissing) return { error: { message: "PRIVATE column pages.merchant_id does not exist" }, data: null };
      if (body) {
        assert.equal(slug, SLUG); assert.equal(scoped, true); assert.equal(id, state.id);
        state.filters = [String(id), slug, "owner:null"];
        if (state.ack === "throw") throw new Error("PRIVATE");
        if (state.ack === "error") return { data: null, error: { message: "PRIVATE" } };
        if (state.ack === "zero") return { data: null, error: null };
        if (state.ack === "missing-error") return { data: { id: state.id } };
        if (state.ack === "false-error") return { data: { id: state.id }, error: false };
        state.writes += 1; state.blocks = state.tamper ? { changed: true } : structuredClone(body.blocks);
        return { data: state.ack === "wrong" ? { id: "wrong" } : state.ack === "array" ? [{ id: state.id }] : { id: state.id }, error: null };
      }
      assert.equal(slug, SLUG);
      if (scoped) assert.equal(limit, 2); else assert.equal(limit, 1);
      if (state.duplicate && scoped) return { data: null, error: { message: "PRIVATE multiple rows" } };
      const found = state.exists && (!scoped || state.owner === null);
      return { data: found ? { id: state.id, blocks: structuredClone(state.blocks) } : null, error: null };
    };
    const query = {
      select(columns: string) { assert.ok(columns === "id,blocks" || columns === "id"); return query; },
      is(column: string, value: unknown) { assert.equal(column, "merchant_id"); assert.equal(value, null); scoped = true; return query; },
      eq(column: string, value: unknown) { if (column === "id") id = value; else { assert.equal(column, "slug"); slug = String(value); } return query; },
      limit(count: number) { limit = count; return query; },
      update(value: Record<string, unknown>) { body = value; return query; },
      async insert(value: Record<string, unknown>) {
        assert.equal(value.slug, SLUG); assert.equal(value.merchant_id, null);
        state.writes += 1; state.exists = true; state.blocks = structuredClone(value.blocks); return { error: null };
      },
      maybeSingle: execute,
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); },
    };
    return query;
  } } as unknown as StrictPlatformAdminBackupWriteClient;
  return { state, client };
}

test("strict storage accepts the actual backup slug and confirms scoped update contents", async () => {
  const f = fixture(); const row = await read(f.client, SLUG);
  await write(f.client, SLUG, { nested: { b: 2, a: 1 }, values: [] }, row);
  assert.equal(f.state.writes, 1); assert.deepEqual(f.state.filters, ["synthetic-id", SLUG, "owner:null"]);
});
test("strict storage inserts only a confirmed absent null-owner record and then verifies it", async () => {
  const f = fixture(); f.state.exists = false;
  assert.equal(await read(f.client, SLUG), null);
  await write(f.client, SLUG, [], null); assert.equal(f.state.writes, 1);
});
for (const mode of ["owner", "duplicate", "schema", "invalid-id"] as const) {
  test(`strict storage refuses ${mode} without writes or compatibility fallback`, async () => {
    const f = fixture();
    if (mode === "owner") f.state.owner = "foreign-owner";
    if (mode === "duplicate") f.state.duplicate = true;
    if (mode === "schema") f.state.columnsMissing = true;
    if (mode === "invalid-id") f.state.id = "";
    await assert.rejects(read(f.client, SLUG), { message: ERROR }); assert.equal(f.state.writes, 0);
    if (mode === "schema") assert.equal(f.state.queries, 1);
  });
}
for (const ack of ["throw", "error", "zero", "wrong", "array", "missing-error", "false-error"]) {
  test(`strict storage ${ack} write acknowledgement cannot be reported as success`, async () => {
    const f = fixture(); const before = await read(f.client, SLUG); f.state.ack = ack;
    await assert.rejects(write(f.client, SLUG, [], before), { message: ERROR });
    assert.ok(f.state.writes <= 1, "no retry or compensation");
  });
}
test("strict storage rejects changed readback content, not merely HTTP success", async () => {
  const f = fixture(); const before = await read(f.client, SLUG); f.state.tamper = true;
  await assert.rejects(write(f.client, SLUG, [], before), { message: ERROR }); assert.equal(f.state.writes, 1);
});
for (const slug of ["merchant-page", "__platform_admin_data_backups__", "__platform_support_inbox__ ", ""]) {
  test(`strict storage rejects nonallowlisted slug ${JSON.stringify(slug)} before queries`, async () => {
    const f = fixture(); await assert.rejects(read(f.client, slug), { message: ERROR });
    await assert.rejects(write(f.client, slug, [], null), { message: ERROR }); assert.equal(f.state.queries, 0);
  });
}
for (const invalid of [NaN, Infinity, undefined, () => null, [undefined], new Date()]) {
  test(`strict storage rejects non-JSON ${String(invalid)} before write`, async () => {
    const f = fixture(); await assert.rejects(write(f.client, SLUG, invalid, null), { message: ERROR });
    assert.equal(f.state.writes, 0); assert.equal(f.state.queries, 0);
  });
}
test("strict storage matches JSON omission of optional object properties", async () => {
  const f = fixture(); await write(f.client, SLUG, { nested: { absent: undefined, present: true } }, await read(f.client, SLUG));
  assert.equal(f.state.writes, 1);
});
