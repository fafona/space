import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATION_FILENAME_PATTERN = /^(\d{12})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

const destructivePatterns = [
  { label: "drop table", pattern: /\bdrop\s+table\b/i },
  { label: "truncate", pattern: /\btruncate(?:\s+table)?\b/i },
  { label: "drop column", pattern: /\bdrop\s+column\b/i },
  { label: "delete all rows", pattern: /\bdelete\s+from\s+(?:public\.)?[a-z0-9_]+\s*;/i },
];

function stripSqlComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\r\n]*/g, "");
}

// Mask only syntactically positioned read-only guard predicates and exact
// pg_temp-only template cleanup statements. The
// surrounding migration's DO/function dollar body is executable code, whereas
// dollar/single-quoted data inside that body remains unmasked. Keeping data
// strings visible to the later destructive scan also catches dynamic SQL.
function maskReadOnlyPrivilegePredicates(source) {
  const predicate = /^(?:pg_catalog\.)?has_table_privilege\s*\(\s*[a-z_][a-z0-9_]*\s*,\s*[a-z_][a-z0-9_]*\s*,\s*'(?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)(?:\s*,\s*(?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER))*'\s*\)/i;
  const triggerPredicate = /^tg_op\s*(?:=\s*'(?:INSERT|UPDATE|DELETE|TRUNCATE)'|\bin\s*\(\s*'(?:INSERT|UPDATE|DELETE|TRUNCATE)'(?:\s*,\s*'(?:INSERT|UPDATE|DELETE|TRUNCATE)')*\s*\))/i;
  const predicateEnd = /^\s*(?:[);,]|\b(?:and|or|then|when|else|end)\b|$)/i;
  const temporaryDrop = /^drop\s+table\s+pg_temp\.[a-z_][a-z0-9_]*(?:\s*,\s*pg_temp\.[a-z_][a-z0-9_]*)*\s*;/i;
  const replacements = [];
  const walk = (start, end, executableBody = false) => {
    let i = start, lastCodeWord = "", dynamicExecute = false, ordinaryBackslash = false;
    const triggerReplacements = [], temporaryReplacements = [], childReplacements = [];
    while (i < end) {
      const char = source[i];
      if (/\s/.test(char)) { i++; continue; }
      if (char === "'" || char === '"') {
        const delimiter = char;
        const escapeString = delimiter === "'" && i > start && /e/i.test(source[i - 1]) && (i - 1 === start || !/[a-z0-9_.$]/i.test(source[i - 2]));
        i++;
        while (i < end) {
          if (source[i] === delimiter) { if (source[i + 1] === delimiter) { i += 2; continue; } i++; break; }
          if (delimiter === "'" && source[i] === "\\") {
            if (escapeString) i++;
            else ordinaryBackslash = true;
          }
          i++;
        }
        lastCodeWord = ""; continue;
      }
      if (char === "$") {
        const tag = source.slice(i, end).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/i)?.[0];
        if (tag) {
          const bodyStart = i + tag.length, bodyEnd = source.indexOf(tag, bodyStart);
          if (bodyEnd < 0 || bodyEnd >= end) break;
          if (lastCodeWord === "do" || lastCodeWord === "as") {
            const child = walk(bodyStart, bodyEnd, true);
            dynamicExecute = child.dynamicExecute || dynamicExecute;
            childReplacements.push(...child.replacements);
          }
          i = bodyEnd + tag.length; lastCodeWord = ""; continue;
        }
      }
      if (/[a-z_]/i.test(char)) {
        const remaining = source.slice(i, end);
        const privilegeMatch = predicate.exec(remaining);
        const triggerMatch = executableBody ? triggerPredicate.exec(remaining) : null;
        const dropMatch = temporaryDrop.exec(remaining);
        const match = privilegeMatch || (triggerMatch && predicateEnd.test(remaining.slice(triggerMatch[0].length)) ? triggerMatch : null) || dropMatch;
        if (match && (i === start || !/[a-z0-9_.$]/i.test(source[i - 1]))) {
          const masked = dropMatch && match === dropMatch ? "__faolla_pg_temp_template_cleanup__;" : match[0].replace(/\btruncate\b/gi, "__faolla_truncate_guard_name__");
          const destination = match === dropMatch ? temporaryReplacements : match === triggerMatch ? triggerReplacements : replacements;
          destination.push({ start: i, end: i + match[0].length, text: masked });
          i += match[0].length; lastCodeWord = ""; continue;
        }
        const word = source.slice(i, end).match(/^[a-z_][a-z0-9_$]*/i)[0];
        if (word.toLowerCase() === "execute") dynamicExecute = true;
        lastCodeWord = word.toLowerCase(); i += word.length; continue;
      }
      lastCodeWord = ""; i++;
    }
    // Do not erase the only TRUNCATE literal that an EXECUTE may later use as
    // data via tg_op. Quoted EXECUTE text is not a lexical token. Plain SQL
    // strings use doubled quotes; only E'...' treats backslash as an escape.
    // A plain backslash is also conservatively ambiguous if a migration were
    // to change standard_conforming_strings: disable both new exemptions in
    // that lexical scope, never mistake dynamic SQL data for template cleanup.
    return { dynamicExecute, replacements: ordinaryBackslash ? [] : [
      ...childReplacements, ...temporaryReplacements, ...(!dynamicExecute ? triggerReplacements : []),
    ] };
  };
  replacements.push(...walk(0, source.length).replacements);
  let value = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) value = value.slice(0, replacement.start) + replacement.text + value.slice(replacement.end);
  return value;
}

export function validateMigrationSource(fileName, source) {
  const errors = [];
  const match = fileName.match(MIGRATION_FILENAME_PATTERN);
  if (!match) {
    return [`${fileName}: filename must match YYYYMMDDNNNN_snake_case.sql`];
  }

  if (source.charCodeAt(0) === 0xfeff) {
    errors.push(`${fileName}: UTF-8 BOM is not allowed`);
  }

  const normalized = stripSqlComments(source).trim();
  // TRUNCATE is also a valid statement-level trigger event. Mask only that
  // exact DDL phrase before applying the global destructive SQL scan so a
  // TRUNCATE hidden inside a DO block, function body, or dynamic SQL string
  // cannot bypass the migration gate.
  const destructiveScanSource = maskReadOnlyPrivilegePredicates(normalized).replace(
    /\bbefore\s+truncate\s+on\b/gi,
    "before __faolla_truncate_guard_event__ on",
  );
  if (!/^begin\s*;/i.test(normalized)) {
    errors.push(`${fileName}: migration must start with BEGIN`);
  }
  if (!/commit\s*;\s*$/i.test(normalized)) {
    errors.push(`${fileName}: migration must end with COMMIT`);
  }

  for (const destructive of destructivePatterns) {
    if (destructive.pattern.test(destructiveScanSource)) {
      errors.push(`${fileName}: destructive operation is not allowed (${destructive.label})`);
    }
  }

  const version = match[1];
  const registrationPattern = new RegExp(
    `insert\\s+into\\s+public\\.faolla_schema_migrations[\\s\\S]*?values\\s*\\(\\s*${version}\\s*,`,
    "i",
  );
  if (!registrationPattern.test(normalized)) {
    errors.push(`${fileName}: migration must register version ${version}`);
  }

  return errors;
}

export function checkSupabaseMigrations(rootDir = process.cwd()) {
  const migrationDir = path.join(rootDir, "scripts", "supabase-migrations");
  if (!fs.existsSync(migrationDir)) {
    return {
      files: [],
      errors: [`missing migration directory: ${migrationDir}`],
    };
  }

  const files = fs
    .readdirSync(migrationDir)
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  const errors = [];
  const versions = new Set();

  if (files.length === 0) {
    errors.push("at least one Supabase migration is required");
  }

  for (const file of files) {
    const match = file.match(MIGRATION_FILENAME_PATTERN);
    if (match) {
      const version = match[1];
      if (versions.has(version)) {
        errors.push(`${file}: duplicate migration version ${version}`);
      }
      versions.add(version);
    }
    const source = fs.readFileSync(path.join(migrationDir, file), "utf8");
    errors.push(...validateMigrationSource(file, source));
  }

  return { files, errors };
}

function run() {
  const result = checkSupabaseMigrations();
  if (result.errors.length > 0) {
    result.errors.forEach((error) => console.error(`[db-migrations] ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log(`[db-migrations] ${result.files.length} migration(s) validated`);
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedFile && path.resolve(currentFile) === invokedFile) {
  run();
}
