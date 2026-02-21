import { createClient } from "@supabase/supabase-js";

function getRequiredPublicEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`[supabase] Missing required environment variable: ${name}. Please set it in .env.local.`);
  }
  return value;
}

const url = getRequiredPublicEnv("NEXT_PUBLIC_SUPABASE_URL");
const anon = getRequiredPublicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export const supabase = createClient(url, anon);
