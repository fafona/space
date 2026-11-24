// Read-only compatibility evidence. No network client, credentials, installer,
// grant, activation, release approval or automatic manifest refresh lives here.
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = value => createHash('sha256').update(value).digest('hex');
const lf = value => value.replace(/\r\n/g, '\n');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = 'scripts/fixtures/member-checkout-compatibility.json';
const canonType = value => ({ 'timestamp with time zone': 'timestamptz', int4: 'integer', int8: 'bigint', bool: 'boolean' }[value] ?? value);
const fail = () => { throw Error('checkout_compatibility_artifact_invalid'); };

async function localFile(base, relative) {
  if (!/^(?:src\/|database\/proposals\/|scripts\/supabase-migrations\/|scripts\/fixtures\/|package(?:-lock)?\.json$|tsconfig\.json$|next\.config\.[a-z]+$)/.test(relative) || relative.split('/').some(v => v === '..' || v === '.') || relative.includes('\\')) fail();
  const absolute = path.resolve(base, relative), resolved = await realpath(absolute);
  if (!resolved.startsWith(path.resolve(base) + path.sep) || resolved !== absolute) fail();
  return readFile(absolute);
}

/** One exact application-source/dependency baseline, not an ancestry-only or
 * arbitrary historical-version compatibility claim. Untracked source counts.
 * Text uses strict UTF-8 decoding (optional initial BOM ignored) and LF lines. */
export async function applicationFingerprint(base = root) {
  const files = [], walk = async relative => {
    for (const entry of await readdir(path.join(base, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) fail();
      const next = relative + '/' + entry.name;
      if (entry.isDirectory()) await walk(next); else if (entry.isFile()) files.push(next); else fail();
    }
  };
  await walk('src');
  files.push('package.json', 'package-lock.json', 'tsconfig.json');
  files.push(...(await readdir(base)).filter(name => /^next\.config\.(?:js|mjs|ts)$/.test(name)));
  files.sort();
  const hashes = [];
  for (const file of files) {
    const raw = await localFile(base, file), content = /\.(?:tsx?|jsx?|mjs|json|css|md)$/.test(file) ? Buffer.from(lf(new TextDecoder('utf-8', { fatal: true }).decode(raw))) : raw;
    hashes.push(file + '\0' + sha(content));
  }
  return { algorithm: 'sha256-lf-path-content-v1', files: files.length, sha256: sha(hashes.join('\n')) };
}

/** Deliberately limited to the pinned SQL sources' named IN arguments and
 * dollar-quoted function bodies. Unsupported DDL fails, never gets skipped. */
export function compileProtocolSources(sources) {
  const functions = new Map(), tables = new Set(), triggers = new Map();
  for (const { file, text: raw } of sources) {
    const text = lf(raw), privateSource = file.startsWith('database/proposals/');
    const declared = [...text.matchAll(/^[ \t]*create\s+(?:or\s+replace\s+)?function\s+/gim)].length;
    const matches = [...text.matchAll(/^[ \t]*create\s+(?:or\s+replace\s+)?function\s+(\w+)\.(\w+)\s*\(([^)]*)\)\s*returns\s+([\s\S]*?)\bas\s+(\$[a-z_0-9]*\$)([\s\S]*?)\5\s*;/gim)];
    if (matches.length !== declared) fail();
    for (const m of matches) {
      const args = m[3].trim() ? m[3].split(',').map(v => v.trim().match(/^(\w+)\s+(\w+(?:\[\])?)$/)) : [];
      if (args.some(v => !v)) fail();
      const types = args.map(v => canonType(v[2].toLowerCase())), header = m[4], language = header.match(/\blanguage\s+(sql|plpgsql)\b/i)?.[1].toLowerCase();
      const returnType = header.trim().match(/^(jsonb|boolean|trigger|void)\b/i)?.[1].toLowerCase();
      if (!language || !returnType) fail();
      const searchPath = header.match(/\bset\s+search_path\s*=\s*([a-z_, \t]+)\s*$/i)?.[1].replace(/\s/g, '');
      if (/\bset\s/i.test(header) && !searchPath) fail();
      const signature = `${m[1]}.${m[2]}(${types.join(',')})`;
      functions.set(signature, { signature, namespace: m[1], name: m[2], args: args.map(v => v[1]), types, language, returnType, returnsSet: false, bodySha256: sha(m[6]),
        securityDefiner: /\bsecurity\s+definer\b/i.test(header), volatility: /\bimmutable\b/i.test(header) ? 'i' : /\bstable\b/i.test(header) ? 's' : 'v',
        strict: /\bstrict\b|returns\s+null\s+on\s+null\s+input/i.test(header), parallel: /\bparallel\s+safe/i.test(header) ? 's' : /\bparallel\s+restricted/i.test(header) ? 'r' : 'u',
        config: searchPath ? ['search_path=' + searchPath] : [], privateSource });
    }
    for (const m of text.matchAll(/^[ \t]*create\s+table\s+(faolla_checkout_design\.\w+)\s*\(/gim)) tables.add(m[1]);
    const triggerDeclarations = [...text.matchAll(/^[ \t]*create\s+(?:constraint\s+)?trigger\s+/gim)].length;
    const parsedTriggers = [...text.matchAll(/^[ \t]*create\s+(constraint\s+)?trigger\s+(\w+)\s+(before|after)\s+((?:insert|update|delete|truncate)(?:\s+or\s+(?:insert|update|delete|truncate))*)\s+on\s+(\w+\.\w+)\s+([\s\S]*?)execute\s+function\s+(\w+\.\w+)\(\)\s*;/gim)];
    if (parsedTriggers.length !== triggerDeclarations) fail();
    for (const m of parsedTriggers) {
      if (!/for\s+each\s+(?:row|statement)/i.test(m[6]) || /\bwhen\b/i.test(m[6])) fail();
      const type = (/for\s+each\s+row/i.test(m[6]) ? 1 : 0) + (m[3].toLowerCase() === 'before' ? 2 : 0) + (/insert/i.test(m[4]) ? 4 : 0) + (/delete/i.test(m[4]) ? 8 : 0) + (/update/i.test(m[4]) ? 16 : 0) + (/truncate/i.test(m[4]) ? 32 : 0);
      triggers.set(m[5] + ':' + m[2], { table: m[5], name: m[2], function: m[7] + '()', type,
        constraint: !!m[1], deferrable: /\bdeferrable\b/i.test(m[6]) && !/\bnot\s+deferrable\b/i.test(m[6]), deferred: /initially\s+deferred/i.test(m[6]) });
    }
  }
  return { functions: [...functions.values()], tables: [...tables], triggers: [...triggers.values()] };
}

export async function loadCompatibilityBaseline(base = root) {
  const manifest = JSON.parse((await localFile(base, manifestPath)).toString('utf8'));
  if (manifest.version !== 1 || manifest.scope !== 'private-checkout-compatibility-evidence' || !/^[a-f0-9]{40}$/.test(manifest.basisCommit)
    || !Array.isArray(manifest.sources) || manifest.sources.length !== 37 || new Set(manifest.sources.map(v => v.file)).size !== 37) fail();
  const sources = [], issues = [];
  for (const item of manifest.sources) {
    if (!/^[a-f0-9]{64}$/.test(item.sha256)) fail();
    const text = lf(new TextDecoder('utf-8', { fatal: true }).decode(await localFile(base, item.file)));
    if (sha(text) !== item.sha256) issues.push('source_changed:' + item.file);
    sources.push({ file: item.file, text });
  }
  const installedSet = (await readdir(path.join(base, 'database/proposals'))).filter(v => /^\d+_member_checkout_.*\.sql$/.test(v)).sort();
  if (JSON.stringify(installedSet) !== JSON.stringify(manifest.sources.filter(v => v.file.startsWith('database/proposals/')).map(v => path.basename(v.file)).sort())) issues.push('proposal_set_changed');
  const application = await applicationFingerprint(base);
  if (JSON.stringify(application) !== JSON.stringify(manifest.application)) issues.push('application_baseline_changed');
  if (issues.length) return { manifest, application, issues, expected: null };
  return { manifest, application, issues, expected: compileProtocolSources(sources) };
}

// Fixed SELECT-only catalogue reads. No principal/member/order/booking values
// or business table contents, and no function is executed by this inspector.
export const compatibilityCatalogSql = Object.freeze({
  functions: `SELECT n.nspname AS namespace,p.proname AS name,
    ARRAY(SELECT format_type(x,NULL) FROM unnest(p.proargtypes) WITH ORDINALITY a(x,i) ORDER BY i) AS types,
    p.proargnames AS args,l.lanname AS language,format_type(p.prorettype,NULL) AS "returnType",p.proretset AS "returnsSet",p.prosrc AS body,p.prosecdef AS "securityDefiner",p.provolatile AS volatility,p.proisstrict AS strict,p.proparallel AS parallel,p.proconfig AS config,
    (o.rolsuper OR o.rolbypassrls) AS "ownerBypassesRls",p.prosqlbody IS NOT NULL AS "sqlBody",
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS "publicExecute",
    ARRAY(SELECT r.rolname::text FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role') AND has_function_privilege(r.oid,p.oid,'EXECUTE') ORDER BY r.rolname) AS executors
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang JOIN pg_roles o ON o.oid=p.proowner
    WHERE p.prokind='f' AND (n.nspname='faolla_checkout_design' OR n.nspname='public' AND p.proname LIKE 'faolla_%')
    ORDER BY n.nspname,p.proname,p.proargtypes::text`,
  tables: `SELECT n.nspname||'.'||c.relname AS name,c.relkind AS kind,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced,
    (SELECT count(*)::integer FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS "publicAccess",
    ARRAY(SELECT r.rolname::text FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role') AND has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') ORDER BY r.rolname) AS accessors
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='faolla_checkout_design' AND c.relkind IN ('r','p') ORDER BY n.nspname,c.relname`,
  triggers: `SELECT n.nspname||'.'||c.relname AS "table",t.tgname AS name,pn.nspname||'.'||p.proname||'()' AS function,t.tgtype::integer AS type,t.tgenabled AS enabled,
    t.tgconstraint<>0 AS constraint,t.tgdeferrable AS deferrable,t.tginitdeferred AS deferred,t.tgnargs AS args,t.tgqual IS NOT NULL AS qualified,t.tgattr::text AS columns
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE NOT t.tgisinternal AND n.nspname IN ('public','faolla_checkout_design') ORDER BY n.nspname,c.relname,t.tgname`,
  schemas: `SELECT n.nspname AS name,EXISTS(SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=0) AS "publicAccess",
    ARRAY(SELECT r.rolname::text FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role') AND has_schema_privilege(r.oid,n.oid,'USAGE,CREATE') ORDER BY r.rolname) AS accessors
    FROM pg_namespace n WHERE n.nspname='faolla_checkout_design' ORDER BY n.nspname`,
});

export async function readCompatibilityCatalog(query) {
  try {
    const value = {};
    for (const [key, sql] of Object.entries(compatibilityCatalogSql)) {
      const result = await query(sql);
      if (!Array.isArray(result?.rows) || result.rows.length > 10000) fail();
      value[key] = result.rows;
    }
    return value;
  } catch { throw Error('checkout_compatibility_catalog_unavailable'); }
}

export function inspectCompatibilityCatalog(expected, catalog) {
  const issues = [];
  try {
    if (!expected || !catalog || Object.keys(compatibilityCatalogSql).some(k => !Array.isArray(catalog[k]))) fail();
    const functionKey = p => `${p.namespace}.${p.name}(${p.types.map(canonType).join(',')})`;
    const functions = new Map(catalog.functions.map(p => [functionKey(p), p]));
    if (functions.size !== catalog.functions.length) fail();
    for (const wanted of expected.functions) {
      const actual = functions.get(wanted.signature);
      if (!actual) { issues.push('function_missing:' + wanted.signature); continue; }
      if (sha(lf(actual.body)) !== wanted.bodySha256 || actual.sqlBody !== false || ['language','returnType','returnsSet','securityDefiner','volatility','strict','parallel'].some(k => actual[k] !== wanted[k])
        || JSON.stringify(actual.args ?? []) !== JSON.stringify(wanted.args) || JSON.stringify((actual.config ?? []).map(v => v.replace(/\s/g, ''))) !== JSON.stringify(wanted.config)) issues.push('function_changed:' + wanted.signature);
      if (wanted.privateSource && (actual.publicExecute !== false || !Array.isArray(actual.executors) || actual.executors.length)) issues.push('private_function_exposed:' + wanted.signature);
      if (wanted.privateSource && wanted.securityDefiner && actual.ownerBypassesRls !== true) issues.push('guard_owner_invalid:' + wanted.signature);
    }
    for (const actual of catalog.functions) if ((actual.namespace === 'faolla_checkout_design' || actual.namespace === 'public' && /^faolla_(?:member_)?checkout_/.test(actual.name))
      && !expected.functions.some(v => v.signature === functionKey(actual))) issues.push('unexpected_private_function:' + functionKey(actual));
    for (const wanted of expected.tables) {
      const matches = catalog.tables.filter(v => v.name === wanted), actual = matches[0];
      if (matches.length !== 1) issues.push('table_missing_or_duplicate:' + wanted);
      else if (actual.kind !== 'r' || actual.rls !== true || actual.forced !== true || actual.policies !== 0 || actual.publicAccess !== false || !Array.isArray(actual.accessors) || actual.accessors.length) issues.push('table_boundary_changed:' + wanted);
    }
    for (const actual of catalog.tables) if (!expected.tables.includes(actual.name)) issues.push('unexpected_private_table:' + actual.name);
    for (const wanted of expected.triggers) {
      const matches = catalog.triggers.filter(v => v.table === wanted.table && v.name === wanted.name), actual = matches[0];
      if (matches.length !== 1) issues.push('trigger_missing_or_duplicate:' + wanted.table + ':' + wanted.name);
      else if (['function','type','constraint','deferrable','deferred'].some(k => actual[k] !== wanted[k]) || actual.enabled !== 'O' || actual.args !== 0 || actual.qualified || actual.columns !== '') issues.push('trigger_changed:' + wanted.table + ':' + wanted.name);
    }
    for (const actual of catalog.triggers) if ((actual.table.startsWith('faolla_checkout_design.') || actual.function.startsWith('faolla_checkout_design.'))
      && !expected.triggers.some(v => v.table === actual.table && v.name === actual.name)) issues.push('unexpected_private_trigger:' + actual.table + ':' + actual.name);
    if (catalog.schemas.length !== 1 || catalog.schemas[0].name !== 'faolla_checkout_design' || catalog.schemas[0].publicAccess !== false || !Array.isArray(catalog.schemas[0].accessors) || catalog.schemas[0].accessors.length) issues.push('schema_boundary_changed');
  } catch { issues.push('catalog_invalid'); }
  return { issues: [...new Set(issues)].sort(), protocolObjectsMatch: issues.length === 0, deploymentReady: false,
    notVerified: ['approved-runtime-transport-and-least-privilege', 'database-constraints-and-migration-registry', 'live-next-postgrest-and-real-session', 'deployment-and-rollback-rehearsal'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const baseline = await loadCompatibilityBaseline();
    console.log(JSON.stringify({ basisCommit: baseline.manifest.basisCommit, application: baseline.application, issues: baseline.issues,
      counts: baseline.expected ? { sources: baseline.manifest.sources.length, functions: baseline.expected.functions.length, tables: baseline.expected.tables.length, triggers: baseline.expected.triggers.length } : null,
      databaseChecked: false, deploymentReady: false }, null, 2));
    process.exitCode = baseline.issues.length ? 1 : 0;
  } catch { console.error('checkout_compatibility_artifact_invalid'); process.exitCode = 1; }
}
