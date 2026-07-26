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
  if (!/^begin\s*;/i.test(normalized)) {
    errors.push(`${fileName}: migration must start with BEGIN`);
  }
  if (!/commit\s*;\s*$/i.test(normalized)) {
    errors.push(`${fileName}: migration must end with COMMIT`);
  }

  for (const destructive of destructivePatterns) {
    if (destructive.pattern.test(normalized)) {
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
