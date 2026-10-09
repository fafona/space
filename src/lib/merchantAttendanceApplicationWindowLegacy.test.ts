// 194 narrow protocol-upgrade regression only; existing retry policy is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { CORRECTION_ERRORS } from "./merchantAttendanceCorrection";
import { ATTENDANCE_REVISION_ERRORS } from "./merchantAttendanceRevision";
import { MISSING_ERRORS, missingMessage, type MissingQuery } from "./merchantAttendanceMissing";
import { AttendanceCorrectionClient, correctionMessage } from "./merchantAttendanceCorrectionClient";
import { AttendanceRevisionCycleClient } from "./merchantAttendanceRevisionCycleClient";
import { AttendanceMissingClient } from "./merchantAttendanceMissingClient";
import { createCorrectionFixture, correctionId as id, correctionSite, correctionEmployee, correctionWorker, correctionProposal } from "../../scripts/fixtures/attendance-correction-model";
import { wire } from "../../scripts/fixtures/attendance-revision-cycle-model";
import { revisionCommand } from "../../scripts/fixtures/attendance-revision-model";
import { applicationWindowFixture } from "./merchantAttendanceApplicationWindowTestFixtures";
const code = "attendance_application_window_protocol_required";
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
test("194 old maps preserve exact409 and Chinese new-entry guidance, not unknown503", () => {
  for (const map of [CORRECTION_ERRORS, ATTENDANCE_REVISION_ERRORS, MISSING_ERRORS]) assert.equal(map[code], 409);
  assert.match(correctionMessage(Error(code)), /新入口.*编号保留/); assert.match(missingMessage(code), /新入口.*编号保留/);
});
test("194 old correction first rejection retains full pending; subsequent GET not-found never clears or reposts", async () => {
  const model = createCorrectionFixture(), store = storage(), methods: string[] = [];
  const client = new AttendanceCorrectionClient({ siteId: correctionSite, employeeId: correctionEmployee, storage: () => store, randomId: () => id(300),
    apiFetch: async (path, init) => { methods.push(init?.method ?? "GET"); if (init?.method === "POST") return Response.json({ ok: false, error: code }, { status: 409 }); return model.apiFetch(path, init); } });
  await client.initialize(); await client.prepare(id(10)); await client.submit(correctionProposal, "Synthetic correction");
  const raw = store.getItem(client.storageKey); assert(raw); assert.equal(client.getSnapshot().pending?.command.operationId, id(300)); assert.match(client.getSnapshot().message, /编号保留/);
  await client.initialize(); assert.equal(store.getItem(client.storageKey), raw); assert.equal(methods.filter(m => m === "POST").length, 1); client.pause();
});
test("194 old revision-cycle first rejection retains full pending and GET-only restore", async () => {
  const model = createCorrectionFixture(), store = storage(), methods: string[] = [];
  const client = new AttendanceRevisionCycleClient({ siteId: correctionSite, employeeId: correctionEmployee, storage: () => store, randomId: () => id(300),
    apiFetch: async (path, init) => { methods.push(init?.method ?? "GET"); if (init?.method === "POST") return Response.json({ ok: false, error: code }, { status: 409 });
      if (path.includes("/context?")) return model.apiFetch(path, init); if (new URL(path, "https://local.invalid").searchParams.get("mode") === "detail") return Response.json({ ok: false, error: "attendance_correction_not_found" }, { status: 404 });
      return Response.json({ ok: true, ...wire(), moduleEnabled: true }); } });
  await client.initialize({ workerId: correctionWorker, baseRequestId: id(100) }); await client.submit(revisionCommand.proposal, "Synthetic revision");
  const raw = store.getItem(client.storageKey); assert(raw); assert.match(client.getSnapshot().message, /编号保留/); await client.initialize();
  assert.equal(store.getItem(client.storageKey), raw); assert.equal(methods.filter(m => m === "POST").length, 1); client.pause();
});
test("194 old missing first rejection retains full pending and GET-only restore", async () => {
  const f = await applicationWindowFixture("missing"), store = storage(), methods: string[] = [];
  const query: MissingQuery = { siteId: correctionSite, access: "self", fromDate: "2026-09-30", throughDate: "2026-09-30", requestId: null, operationId: null, beforeAt: null, beforeId: null };
  const client = new AttendanceMissingClient({ query, actorId: correctionEmployee, storage: () => store, randomId: () => id(300),
    apiFetch: async (_path, init) => { methods.push(init?.method ?? "GET"); return init?.method === "POST" ? Response.json({ ok: false, error: code }, { status: 409 }) : Response.json({ ok: true, ...f.result.application, moduleEnabled: true }); } });
  await client.initialize(); await client.submit({ action: "submit", proposal: correctionProposal, reason: "Synthetic missing" });
  const raw = store.getItem(client.storageKey); assert(raw); assert.match(client.getSnapshot().message, /编号保留/); await client.initialize();
  assert.equal(store.getItem(client.storageKey), raw); assert.equal(methods.filter(m => m === "POST").length, 1); client.pause();
});
