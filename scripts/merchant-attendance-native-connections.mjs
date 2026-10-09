// Bounded, independently addressable psql sessions for the owned local PG cluster.
// The caller must finish/rollback every session before verifying the baseline.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";

// Only an explicitly opted-in long local fixture may extend the whole-session
// deadline: 90s legacy fixtures or the frozen 180s day-review fixture. This does
// not change the per-step or caller's SQL/lock deadlines.
export function attendanceNativeConnectionLifetime(options) {
  if (options === undefined) return 25000;
  assert.ok(options !== null && typeof options === "object" && !Array.isArray(options)
    && (Object.getPrototypeOf(options) === Object.prototype || Object.getPrototypeOf(options) === null),
  "attendance_concurrency_lifetime_options");
  assert.deepEqual(Reflect.ownKeys(options), ["lifetimeMs"], "attendance_concurrency_lifetime_options");
  const descriptor = Object.getOwnPropertyDescriptor(options, "lifetimeMs");
  assert.ok(descriptor && Object.hasOwn(descriptor, "value")
    && (descriptor.value === 25000 || descriptor.value === 90000 || descriptor.value === 180000), "attendance_concurrency_lifetime_options");
  return descriptor.value;
}

export function attendanceNativeConnections(config, environment) {
  const active = new Set();
  function connect(options) {
    const lifetimeMs = attendanceNativeConnectionLifetime(options);
    assert.ok(active.size < 4, "attendance_concurrency_connection_limit");
    const name = `attendance_race_${randomUUID().replaceAll("-", "")}`;
    const child = spawn(config.binaries.psql, ["--host=127.0.0.1", `--port=${config.port}`, "--username=postgres",
      `--dbname=${config.database}`, "--no-password", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1"],
    {env:{...environment, PGAPPNAME:name}, windowsHide:true, shell:false, stdio:["pipe","pipe","pipe"]});
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    let pending = null, output = "", error = "", failed = null, closed = false;
    const fail = failure => { failed = failure; pending?.reject(failure); pending = null; };
    const finished = new Promise(resolve => child.once("close", code => {
      closed = true; clearTimeout(lifetime); active.delete(session);
      fail(new Error(`attendance_concurrency_closed:${code}:${error}`)); resolve(code);
    }));
    const lifetime = setTimeout(() => { fail(new Error("attendance_concurrency_lifetime")); child.kill(); }, lifetimeMs);
    child.on("error", fail); child.stdin.on("error", fail);
    child.stderr.on("data", text => { error = (error + text).slice(-200000); });
    child.stdout.on("data", text => {
      output += text;
      if (output.length > 2000000) { fail(new Error("attendance_concurrency_output_limit")); child.kill(); return; }
      if (pending && output.split(/\r?\n/).includes(pending.marker)) {
        const current = pending; pending = null;
        const at = output.indexOf(current.marker), value = output.slice(0, at).trim();
        output = output.slice(at + current.marker.length).replace(/^\r?\n/, ""); current.resolve(value);
      }
    });
    const session = {name,
      step(source) {
        assert.equal(typeof source, "string"); assert.ok(source.length < 1500000);
        assert.equal(pending, null, "attendance_concurrency_one_command_per_session");
        if (failed) return Promise.reject(failed);
        assert.ok(!closed, "attendance_concurrency_session_closed");
        const marker = `attendance_race_step_${randomUUID().replaceAll("-", "")}`;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { fail(new Error("attendance_concurrency_step_deadline")); child.kill(); }, 12000);
          pending = {marker, resolve:value => { clearTimeout(timer); resolve(value); }, reject:e => { clearTimeout(timer); reject(e); }};
          child.stdin.write(`${source}\nselect '${marker}';\n`);
        });
      },
      async close() {
        if (!closed) { child.kill(); await finished; }
      },
    };
    active.add(session); return session;
  }
  return {connect, async closeAll() { await Promise.all([...active].map(session => session.close())); }};
}
