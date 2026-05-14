import assert from "node:assert/strict";
import test from "node:test";
import { emphasizeSupabaseEmailCodeTokens } from "./update-supabase-email-code-font.mjs";

test("wraps Supabase OTP tokens with larger email-safe inline style", () => {
  const result = emphasizeSupabaseEmailCodeTokens("<p>Alternatively, enter the code: {{ .Token }}</p>");

  assert.match(result, /data-faolla-email-code="true"/);
  assert.match(result, /font-size:18px/);
  assert.match(result, /<span[^>]+>{{ \.Token }}<\/span>/);
});

test("supports compact token syntax and custom size", () => {
  const result = emphasizeSupabaseEmailCodeTokens("<p>Enter the code: {{token}}</p>", "20px");

  assert.match(result, /font-size:20px/);
  assert.match(result, /<span[^>]+>{{token}}<\/span>/);
});

test("does not double-wrap templates that were already updated", () => {
  const input = '<p>Code: <span data-faolla-email-code="true" style="font-size:18px">{{ .Token }}</span></p>';

  assert.equal(emphasizeSupabaseEmailCodeTokens(input), input);
});

test("leaves templates without OTP tokens unchanged", () => {
  const input = '<p><a href="{{ .ConfirmationURL }}">Confirm your email</a></p>';

  assert.equal(emphasizeSupabaseEmailCodeTokens(input), input);
});
