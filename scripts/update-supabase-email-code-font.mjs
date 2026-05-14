#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MANAGEMENT_API_BASE_URL = "https://api.supabase.com/v1";
const TEMPLATE_CONTENT_KEY_PATTERN = /^mailer_templates_.+_content$/;
const TOKEN_PATTERN = /{{\s*(?:\.Token|token)\s*}}/g;
const DEFAULT_CODE_FONT_SIZE = "18px";
const CODE_WRAPPER_MARKER = 'data-faolla-email-code="true"';

function loadLocalEnvFile(filePath = ".env.local") {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function emphasizeSupabaseEmailCodeTokens(content, fontSize = DEFAULT_CODE_FONT_SIZE) {
  const normalizedContent = String(content ?? "");
  const normalizedFontSize = String(fontSize || DEFAULT_CODE_FONT_SIZE).trim() || DEFAULT_CODE_FONT_SIZE;
  if (!TOKEN_PATTERN.test(normalizedContent)) return normalizedContent;
  TOKEN_PATTERN.lastIndex = 0;
  if (normalizedContent.includes(CODE_WRAPPER_MARKER)) return normalizedContent;

  const style = [
    `font-size:${normalizedFontSize}`,
    "line-height:1.35",
    "font-weight:700",
    "letter-spacing:0.04em",
    "font-family:Arial,Helvetica,sans-serif",
  ].join(";");

  return normalizedContent.replace(
    TOKEN_PATTERN,
    (token) => `<span ${CODE_WRAPPER_MARKER} style="${style}">${token}</span>`,
  );
}

function readArgValue(name) {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg === name || arg.startsWith(prefix));
  if (!match || match === name) return "";
  return match.slice(prefix.length).trim();
}

function hasArg(name) {
  return process.argv.slice(2).includes(name);
}

function resolveProjectRef() {
  const explicit = String(process.env.SUPABASE_PROJECT_REF || process.env.PROJECT_REF || readArgValue("--project-ref")).trim();
  if (explicit) return explicit;

  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  try {
    const url = new URL(supabaseUrl);
    const [projectRef] = url.hostname.split(".");
    return projectRef && projectRef !== "localhost" ? projectRef : "";
  } catch {
    return "";
  }
}

async function requestSupabaseAuthConfig(projectRef, accessToken, options = {}) {
  const response = await fetch(`${MANAGEMENT_API_BASE_URL}/projects/${encodeURIComponent(projectRef)}/config/auth`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase Management API ${options.method ?? "GET"} failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function buildTemplateUpdates(config, fontSize) {
  const updates = {};
  for (const [key, value] of Object.entries(config)) {
    if (!TEMPLATE_CONTENT_KEY_PATTERN.test(key) || typeof value !== "string") continue;
    const nextValue = emphasizeSupabaseEmailCodeTokens(value, fontSize);
    if (nextValue !== value) {
      updates[key] = nextValue;
    }
  }
  return updates;
}

async function main() {
  loadLocalEnvFile();
  const apply = hasArg("--apply");
  const fontSize = readArgValue("--font-size") || process.env.SUPABASE_EMAIL_CODE_FONT_SIZE || DEFAULT_CODE_FONT_SIZE;
  const projectRef = resolveProjectRef();
  const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || "").trim();

  if (!projectRef) {
    throw new Error("Missing SUPABASE_PROJECT_REF or NEXT_PUBLIC_SUPABASE_URL.");
  }
  if (!accessToken) {
    throw new Error("Missing SUPABASE_ACCESS_TOKEN. Create one in Supabase Dashboard > Account > Access Tokens.");
  }

  const config = await requestSupabaseAuthConfig(projectRef, accessToken);
  const updates = buildTemplateUpdates(config, fontSize);
  const changedKeys = Object.keys(updates);

  if (changedKeys.length === 0) {
    console.log("No Supabase auth email templates with unstyled OTP tokens were found.");
    return;
  }

  console.log(`Found ${changedKeys.length} template(s) to update:`);
  for (const key of changedKeys) {
    console.log(`- ${key}`);
  }

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to update Supabase.");
    return;
  }

  await requestSupabaseAuthConfig(projectRef, accessToken, {
    method: "PATCH",
    body: updates,
  });
  console.log(`Updated ${changedKeys.length} Supabase auth email template(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
