import {
  createPasswordRecoveryIntent,
  createPasswordRecoveryProofToken,
} from "@/lib/passwordRecoveryGrant.server";

type PasswordRecoveryIntentClient = Parameters<
  typeof createPasswordRecoveryIntent
>[0];

export async function preparePasswordRecoveryRequest(
  service: PasswordRecoveryIntentClient,
  input: {
    email: string;
    redirectTo: string;
    source: "reset_email" | "reset_code";
  },
) {
  const proofToken = createPasswordRecoveryProofToken();
  await createPasswordRecoveryIntent(service, {
    proofToken,
    email: input.email,
    source: input.source,
  });
  const redirect = new URL(input.redirectTo);
  redirect.searchParams.set("reset_intent", proofToken);
  return { redirectTo: redirect.toString() };
}
