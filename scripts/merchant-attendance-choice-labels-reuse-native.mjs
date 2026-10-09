// Reuse only an explicitly named, stopped, synthetic attendance PG15 cluster.
// Existing-schema writes roll back. Concurrency checks may use and remove a
// separately owned synthetic schema; no initdb, database creation or deletion.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attendanceNativeConfig } from "./merchant-attendance-foundation-native.mjs";
import { checkAttendanceChoiceLabelsNative } from "./merchant-attendance-choice-labels-native-checks.mjs";
import { attendanceNativeConnections } from "./merchant-attendance-native-connections.mjs";

export function attendanceLabelsReuseDirectory(args, temporaryRoot, platform = process.platform) {
  assert.equal(platform, "win32", "attendance_reuse_windows_only");
  assert.equal(args.length, 3, "attendance_reuse_explicit_directory_required");
  assert.equal(args[0], "--run-local"); assert.equal(args[1], "--directory");
  assert.ok(path.win32.isAbsolute(args[2]), "attendance_reuse_absolute_directory_required");
  const directory = path.win32.resolve(args[2]);
  assert.equal(path.win32.dirname(directory).toLowerCase(), path.win32.resolve(temporaryRoot).toLowerCase(), "attendance_reuse_temp_parent_required");
  assert.match(path.win32.basename(directory), /^faolla-attendance-foundation-[a-zA-Z0-9]{6}$/);
  return directory;
}

export async function runAttendanceLabelsReuse(args, check = checkAttendanceChoiceLabelsNative) {
  const directory = attendanceLabelsReuseDirectory(args, realpathSync(tmpdir()));
  assert.equal(realpathSync(directory).toLowerCase(), directory.toLowerCase(), "attendance_reuse_no_directory_redirect");
  const dataDirectory = path.join(directory, "data");
  assert.equal(realpathSync(dataDirectory).toLowerCase(), dataDirectory.toLowerCase(), "attendance_reuse_no_data_redirect");
  assert.equal(readFileSync(path.join(dataDirectory, "PG_VERSION"), "utf8").trim(), "15");
  assert.ok(!existsSync(path.join(dataDirectory, "postmaster.pid")), "attendance_reuse_cluster_must_be_stopped");
  const config = attendanceNativeConfig(["--run-local"]);
  const windows = process.env.SystemRoot || "C:\\Windows";
  const environment = {
    SystemRoot: windows, WINDIR: windows, COMSPEC: path.join(windows, "System32", "cmd.exe"),
    PATH: `${path.dirname(config.binaries.pg_ctl)};${path.join(windows, "System32")}`,
    TEMP: directory, TMP: directory, PGHOSTADDR: "127.0.0.1", PGSSLMODE: "disable", PGCONNECT_TIMEOUT: "5",
    PGPASSFILE: path.join(directory, "no-credentials.pgpass"), PGAPPNAME: "faolla_attendance_labels_local",
    PGOPTIONS: "-c lc_messages=C -c statement_timeout=10000 -c lock_timeout=3000",
  };
  assert.ok(!existsSync(environment.PGPASSFILE), "attendance_reuse_must_not_load_credentials");
  const run = (binary, parameters, input, start = false) => {
    const result = spawnSync(binary, parameters, { encoding: "utf8", input, env: environment,
      windowsHide: true, shell: false, timeout: 25_000, maxBuffer: 2_000_000,
      stdio: start ? "ignore" : ["pipe", "pipe", "pipe"],
    });
    assert.ok(!result.error && !result.signal, `attendance_reuse_process_failed:${result.error?.code || result.signal}`);
    return result;
  };
  const status = () => run(config.binaries.pg_ctl, ["-D", dataDirectory, "status"]).status;
  assert.equal(status(), 3, "attendance_reuse_cluster_must_be_stopped");
  await new Promise((resolve, reject) => {
    const socket = net.createServer(); socket.once("error", () => reject(new Error("attendance_reuse_port_in_use")));
    socket.listen({host:"127.0.0.1", port:config.port, exclusive:true}, () => socket.close(resolve));
  });
  const query = source => {
    const result = run(config.binaries.psql, ["--host=127.0.0.1", `--port=${config.port}`, "--username=postgres",
      `--dbname=${config.database}`, "--no-password", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align",
      "--set=ON_ERROR_STOP=1"], source);
    assert.equal(result.status, 0, `attendance_reuse_sql_failed:${result.stderr}`);
    return result.stdout.trim();
  };
  // Larger synthetic setups keep ONE transaction/connection while retaining the
  // existing 10s SQL and 25s per-step deadlines. No global timeout relaxation.
  const querySteps = async sources => {
    assert.ok(Array.isArray(sources)&&sources.length>0&&sources.length<=100,"attendance_reuse_bounded_steps_required");
    const child=spawn(config.binaries.psql,["--host=127.0.0.1",`--port=${config.port}`,"--username=postgres",
      `--dbname=${config.database}`,"--no-password","--no-psqlrc","--quiet","--tuples-only","--no-align","--set=ON_ERROR_STOP=1"],
      {env:environment,windowsHide:true,shell:false,stdio:["pipe","pipe","pipe"]});
    child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
    let pending=null,stdout="",stderr="",terminalError=null;
    const finished=new Promise(resolve=>child.once("close",code=>resolve(code)));
    const fail=error=>{terminalError=error;pending?.reject(error);pending=null;};
    child.on("error",fail);child.stdin.on("error",fail);
    child.on("close",code=>{if(pending)fail(new Error(`attendance_reuse_step_closed:${code}:${stderr}`));});
    child.stderr.on("data",chunk=>{stderr=(stderr+chunk).slice(-200000);});
    child.stdout.on("data",chunk=>{
      stdout+=chunk;
      if(stdout.length>2000000){fail(new Error("attendance_reuse_step_output_limit"));child.kill();return;}
      if(pending&&stdout.split(/\r?\n/).includes(pending.marker)){
        const current=pending;pending=null;const at=stdout.indexOf(current.marker);
        const output=stdout.slice(0,at).trim();stdout=stdout.slice(at+current.marker.length).replace(/^\r?\n/,"");current.resolve(output);
      }
    });
    const outputs=[];
    try{
      for(const source of sources){
        assert.equal(typeof source,"string");if(terminalError)throw terminalError;
        const marker=`attendance_step_${randomUUID().replaceAll("-","")}`;
        const output=await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{fail(new Error("attendance_reuse_step_deadline"));child.kill();},25000);
          pending={marker,resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};
          child.stdin.write(`${source}\nselect '${marker}';\n`);
        });
        if(output)outputs.push(output);
      }
      child.stdin.end();assert.equal(await finished,0,`attendance_reuse_steps_failed:${stderr}`);
      return outputs.join("\n");
    }finally{
      if(child.exitCode===null&&child.signalCode===null)child.kill();
      await finished;
    }
  };
  let startAttempted = false;
  const connections = attendanceNativeConnections(config, environment);
  try {
    startAttempted = true;
    assert.equal(run(config.binaries.pg_ctl, ["-D", dataDirectory, "-l", path.join(directory,"postgres.log"),
      "-w", "-t", "20", "-o", `-h 127.0.0.1 -p ${config.port}`, "start"], undefined, true).status, 0);
    const identity = JSON.parse(query(`select jsonb_build_object('database',current_database(),'user',current_user,
      'address',host(inet_server_addr()),'port',inet_server_port(),'major',current_setting('server_version_num')::int/10000,
      'directory',current_setting('data_directory'));`));
    assert.deepEqual({...identity,directory:path.resolve(identity.directory).toLowerCase()}, {
      database:config.database, user:"postgres", address:"127.0.0.1", port:config.port, major:15, directory:dataDirectory.toLowerCase(),
    });
    const merchants = JSON.parse(query("select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from public.merchants;"));
    assert.ok(merchants.length > 0 && merchants.every(id => /^9999000[1-6]$/.test(id)), "attendance_reuse_synthetic_merchants_only");
    assert.equal(query("select count(*) from public.faolla_schema_migrations where version=202609290067;"), "1");
    const tableNames = JSON.parse(query(`select jsonb_agg(tablename order by tablename) from pg_tables
      where schemaname='public';`));
    assert.ok(tableNames.length > 0 && tableNames.every(name => /^[a-z_]+$/.test(name)));
    // Fingerprint every public table, indexes, public functions and their ACLs,
    // including any function created by a rollback-only draft migration.
    const snapshot = () => query(`select jsonb_build_object(${tableNames.map(name => `'${name}',
      (select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text) from public.${name} t)`).join(",")},
      'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p
        where p.pronamespace='public'::regnamespace and p.prokind='f'),
      'indexes',(select md5(string_agg(indexdef,'' order by indexname)) from pg_indexes where schemaname='public'));`);
    const namespaces = () => query("select jsonb_agg(jsonb_build_array(oid,nspname,nspowner,nspacl) order by oid) from pg_namespace where nspname !~ '^pg_(temp|toast_temp)_';");
    const tableInventory = () => query("select jsonb_agg(jsonb_build_array(tablename,tableowner) order by tablename) from pg_tables where schemaname='public';");
    const before = snapshot(), beforeNamespaces = namespaces(), beforeTables = tableInventory();
    let checks = 0;
    let checkFailure = null;
    try {
      await check({root:fileURLToPath(new URL("../", import.meta.url)), query, querySteps, connect:connections.connect,
        pass: label => { checks++; console.log(`PASS ${label}`); }});
    } catch (error) { checkFailure = error; }
    try {
      await connections.closeAll();
      assert.equal(snapshot(), before, "attendance_reuse_transaction_did_not_restore_state");
      assert.equal(namespaces(), beforeNamespaces, "attendance_reuse_namespace_not_restored");
      assert.equal(tableInventory(), beforeTables, "attendance_reuse_table_inventory_not_restored");
    } catch (error) {
      if (checkFailure) throw new AggregateError([checkFailure,error], "attendance_reuse_check_and_restore_failed");
      throw error;
    }
    if (checkFailure) throw checkFailure;
    console.log(JSON.stringify({checks, passed:true, baselineRestored:true, productionAccess:false, newCluster:false}));
  } finally {
    await connections.closeAll();
    if (startAttempted) {
      const currentStatus = status(); assert.ok(currentStatus === 0 || currentStatus === 3);
      if (currentStatus === 0) {
        const pid = readFileSync(path.join(dataDirectory,"postmaster.pid"),"utf8").split(/\r?\n/);
        assert.equal(path.resolve(pid[1]).toLowerCase(), dataDirectory.toLowerCase(), "attendance_reuse_stop_directory_mismatch");
        assert.equal(Number(pid[3]),config.port,"attendance_reuse_stop_port_mismatch");
        assert.equal(run(config.binaries.pg_ctl,["-D",dataDirectory,"-m","fast","-w","-t","20","stop"]).status,0);
      }
      assert.equal(status(),3); console.log(JSON.stringify({stopped:true, localSyntheticDirectory:directory}));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runAttendanceLabelsReuse(process.argv.slice(2)).catch(error => {console.error(error); process.exitCode=1;});
}
