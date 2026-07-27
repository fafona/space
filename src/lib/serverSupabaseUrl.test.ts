import assert from "node:assert/strict";
import test from "node:test";
import { resolveServerSupabaseUrl } from "./serverSupabaseUrl";

test("prefers the server-only Supabase URL", () => {
  assert.equal(
    resolveServerSupabaseUrl({
      SUPABASE_INTERNAL_URL: " http://127.0.0.1:8000 ",
      NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.com",
    }),
    "http://127.0.0.1:8000",
  );
});

test("falls back to the public Supabase URL", () => {
  assert.equal(
    resolveServerSupabaseUrl({
      NEXT_PUBLIC_SUPABASE_URL: " https://supabase.example.com ",
    }),
    "https://supabase.example.com",
  );
});

test("returns an empty value when Supabase is not configured", () => {
  assert.equal(resolveServerSupabaseUrl({}), "");
});
