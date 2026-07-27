type SupabaseEnvironment = Record<string, string | undefined>;

function trimEnvironmentValue(value: string | undefined) {
  return String(value ?? "").trim();
}

export function resolveServerSupabaseUrl(
  environment: SupabaseEnvironment = process.env,
) {
  return (
    trimEnvironmentValue(environment.SUPABASE_INTERNAL_URL) ||
    trimEnvironmentValue(environment.NEXT_PUBLIC_SUPABASE_URL)
  );
}
