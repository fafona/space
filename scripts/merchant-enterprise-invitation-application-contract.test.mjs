import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relativePath) {
  return fs
    .readFileSync(path.join(process.cwd(), ...relativePath.split("/")), "utf8")
    .replace(/\r\n?/g, "\n");
}

const portalPath =
  "src/app/enterprise/[siteId]/EnterprisePortalClient.tsx";
const portalPagePath = "src/app/enterprise/[siteId]/page.tsx";
const acceptRoutePath =
  "src/app/api/merchant-enterprise/employees/accept/route.ts";
const membershipsRoutePath =
  "src/app/api/merchant-enterprise/memberships/route.ts";
const initialPasswordRoutePath =
  "src/app/api/merchant-enterprise/invitations/initial-password/route.ts";
const employeeRoutePath =
  "src/app/api/merchant-enterprise/employees/route.ts";
const invitationStorePath =
  "src/lib/merchantEnterpriseInvitationStore.server.ts";
const invitationEmailPath =
  "src/lib/merchantEnterpriseInvitationEmail.server.ts";
const enterpriseStorePath = "src/lib/merchantEnterpriseStore.server.ts";

test("acceptance hashes the URL bearer token before the service-role RPC", () => {
  const source = read(acceptRoutePath);
  assert.match(
    source,
    /createHash\("sha256"\)\.update\(token,\s*"utf8"\)\.digest\("hex"\)/,
  );
  assert.match(
    source,
    /tokenHash = hasInvitationVersion[\s\S]{0,100}invitationTokenHash\(invitationToken\)[\s\S]+service\.rpc\([\s\S]{0,100}"faolla_waive_employee_initial_password_v1"[\s\S]{0,400}invitation_version:\s*invitationVersion,[\s\S]{0,120}token_hash:\s*tokenHash[\s\S]+service\.rpc\("faolla_accept_merchant_employee_invitation_v1",[\s\S]{0,400}token_hash:\s*tokenHash/,
  );
  assert.doesNotMatch(
    source,
    /p_input:\s*\{[\s\S]{0,400}invitation_token:\s*invitationToken/,
  );
});

test("employee acceptance and membership selection require password authentication", () => {
  const acceptSource = read(acceptRoutePath);
  const acceptAuthContext = acceptSource.indexOf(
    "resolveValidatedMerchantEnterpriseAuthContext(request)",
  );
  const acceptPasswordGate = acceptSource.indexOf(
    "requireMerchantEnterprisePasswordAuthentication(authContext)",
  );
  const acceptEntitlement = acceptSource.indexOf(
    "requireMerchantEnterpriseEntitlement(siteId)",
  );
  const acceptRpc = acceptSource.indexOf(
    'service.rpc("faolla_accept_merchant_employee_invitation_v1"',
  );
  const waiverRpc = acceptSource.indexOf(
    '"faolla_waive_employee_initial_password_v1"',
  );
  assert.ok(acceptAuthContext >= 0);
  assert.ok(acceptPasswordGate > acceptAuthContext);
  assert.ok(acceptEntitlement > acceptPasswordGate);
  assert.ok(waiverRpc > acceptEntitlement);
  assert.ok(acceptRpc > waiverRpc);
  assert.doesNotMatch(
    acceptSource,
    /resolveValidatedMerchantEnterpriseAuthUser\(request\)/,
  );

  const membershipsSource = read(membershipsRoutePath);
  const defaultDependenciesStart = membershipsSource.indexOf(
    "const DEFAULT_DEPENDENCIES",
  );
  const handlerStart = membershipsSource.indexOf(
    "export async function handleMerchantEnterpriseMembershipsGet",
  );
  const defaultDependenciesSource = membershipsSource.slice(
    defaultDependenciesStart,
    handlerStart,
  );
  const membershipAuthContext = defaultDependenciesSource.indexOf(
    "resolveValidatedMerchantEnterpriseAuthContext(request)",
  );
  const membershipPasswordGate = defaultDependenciesSource.indexOf(
    "requireMerchantEnterprisePasswordAuthentication(authContext)",
  );
  const returnUser = defaultDependenciesSource.indexOf(
    "return authContext.user",
  );
  assert.ok(defaultDependenciesStart >= 0 && handlerStart > defaultDependenciesStart);
  assert.ok(membershipAuthContext >= 0);
  assert.ok(membershipPasswordGate > membershipAuthContext);
  assert.ok(returnUser > membershipPasswordGate);
  assert.doesNotMatch(
    defaultDependenciesSource,
    /resolveValidatedMerchantEnterpriseAuthUser\(request\)/,
  );
});

test("initial password setup revalidates invitation and identity before the Auth mutation", () => {
  const source = read(initialPasswordRoutePath);
  const handlerStart = source.indexOf(
    "export function createMerchantEnterpriseInitialPasswordHandler",
  );
  const postStart = source.indexOf("export async function POST", handlerStart);
  assert.ok(handlerStart >= 0 && postStart > handlerStart);
  const handlerSource = source.slice(handlerStart, postStart);

  const originGate = handlerSource.indexOf(
    "isTrustedSameOriginMutationRequest(request)",
  );
  const explicitSessionGate = handlerSource.indexOf(
    "requireExplicitInviteSession(request)",
  );
  const parseInput = handlerSource.indexOf("await parseRequest(request)");
  const resolveUser = handlerSource.indexOf(
    "await dependencies.resolveAuthUser(request)",
  );
  const firstInvitationRead = handlerSource.indexOf(
    "dependencies.loadInvitation(",
  );
  const firstRoleRead = handlerSource.indexOf(
    "dependencies.loadRole(",
    firstInvitationRead,
  );
  const identityRead = handlerSource.indexOf(
    "dependencies.loadStaffIdentity(",
  );
  const finalInvitationRead = handlerSource.indexOf(
    "dependencies.loadInvitation(",
    firstInvitationRead + 1,
  );
  const finalRoleRead = handlerSource.indexOf(
    "dependencies.loadRole(",
    finalInvitationRead,
  );
  const setupClaim = handlerSource.indexOf(
    "dependencies.claimInitialPasswordSetup(",
    finalRoleRead,
  );
  const currentAuthRead = handlerSource.indexOf(
    "dependencies.getAuthUserById(",
    setupClaim,
  );
  const passwordStateGate = handlerSource.indexOf(
    "requireKnownUninitializedPasswordState(",
    currentAuthRead,
  );
  const authMutation = handlerSource.indexOf(
    "dependencies.updateAuthUserById(",
    currentAuthRead,
  );
  const successResponse = handlerSource.indexOf(
    "return jsonResponse({ ok: true }, 200)",
    authMutation,
  );

  assert.ok(originGate >= 0);
  assert.ok(explicitSessionGate > originGate);
  assert.ok(parseInput > explicitSessionGate);
  assert.ok(resolveUser > parseInput);
  assert.ok(firstInvitationRead > resolveUser);
  assert.ok(firstRoleRead > firstInvitationRead);
  assert.ok(identityRead > firstRoleRead);
  assert.ok(finalInvitationRead > identityRead);
  assert.ok(finalRoleRead > finalInvitationRead);
  assert.ok(setupClaim > finalRoleRead);
  assert.ok(currentAuthRead > setupClaim);
  assert.ok(passwordStateGate > currentAuthRead);
  assert.ok(authMutation > currentAuthRead);
  assert.ok(successResponse > authMutation);
  assert.ok(
    (handlerSource.match(/invitationVersion:\s*input\.invitationVersion/g)?.length ??
      0) >= 4,
    "both invitation reads and normalizations must bind the submitted generation",
  );
  assert.match(
    handlerSource.slice(finalInvitationRead, authMutation),
    /finalInvitation\.id !== firstInvitation\.id[\s\S]{0,500}finalInvitation\.roleId !== firstInvitation\.roleId[\s\S]{0,500}finalInvitation\.invitationTokenHash !== firstInvitation\.invitationTokenHash/,
  );
  assert.match(
    handlerSource.slice(authMutation, successResponse),
    /MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY[\s\S]{0,160}true/,
  );
  assert.doesNotMatch(
    handlerSource,
    /faolla_accept_merchant_employee_invitation_v1|status:\s*["']active["']/,
  );
});

test("portal completes server-validated password setup before fresh login and acceptance", () => {
  const source = read(portalPath);
  const initializerStart = source.indexOf(
    "async function initializeEnterpriseStaffPassword",
  );
  const componentStart = source.indexOf(
    "export default function EnterprisePortalClient",
    initializerStart,
  );
  assert.ok(initializerStart >= 0 && componentStart > initializerStart);
  const initializerSource = source.slice(initializerStart, componentStart);
  assert.match(
    initializerSource,
    /fetch\(\s*"\/api\/merchant-enterprise\/invitations\/initial-password"/,
  );
  assert.match(initializerSource, /"x-merchant-access-token": accessToken/);
  assert.match(initializerSource, /credentials:\s*"same-origin"/);
  assert.match(initializerSource, /cache:\s*"no-store"/);
  assert.match(
    initializerSource,
    /JSON\.stringify\(\{[\s\S]{0,240}siteId,[\s\S]{0,120}invitationVersion: invitation\.invitationVersion,[\s\S]{0,120}invitationToken: invitation\.invitationToken,[\s\S]{0,120}operationId,[\s\S]{0,120}newPassword/,
  );

  const setupStart = source.indexOf(
    "async function completeInitialPasswordSetup",
  );
  const setupEnd = source.indexOf(
    "async function retryInvitationAcceptance",
    setupStart,
  );
  assert.ok(setupStart >= 0 && setupEnd > setupStart);
  const setupSource = source.slice(setupStart, setupEnd);
  const serverSetup = setupSource.indexOf(
    "await initializeEnterpriseStaffPassword(",
  );
  const clearOperation = setupSource.indexOf(
    "clearInitialPasswordOperation(initialPasswordOperation.operationId)",
  );
  const clearSubmittedPassword = setupSource.indexOf('setNewPassword("")');
  const markPasswordCompleted = setupSource.indexOf(
    "markInvitationPasswordCompleted(",
  );
  const signOut = setupSource.indexOf(
    'supabase.auth.signOut({ scope: "local" })',
  );
  const passwordSignIn = setupSource.indexOf(
    "supabase.auth.signInWithPassword(",
  );
  const acceptInvitation = setupSource.indexOf(
    "await acceptPendingInvitationWithPasswordSession(passwordSessionToken)",
  );
  assert.ok(serverSetup >= 0);
  assert.ok(clearOperation > serverSetup);
  assert.ok(clearSubmittedPassword > serverSetup);
  assert.ok(clearSubmittedPassword < markPasswordCompleted);
  assert.ok(markPasswordCompleted > serverSetup);
  assert.ok(signOut > markPasswordCompleted);
  assert.ok(passwordSignIn > signOut);
  assert.ok(acceptInvitation > passwordSignIn);
  assert.match(
    setupSource,
    /initialPasswordOperationFor\([\s\S]{0,160}storedInvitation,[\s\S]{0,80}submittedPassword[\s\S]{0,240}initialPasswordOperation\.operationId/,
  );
  assert.match(
    setupSource,
    /error instanceof EnterpriseInitialPasswordSetupError[\s\S]{0,100}error\.existingPasswordRequired[\s\S]{0,220}setNewPassword\(""\)[\s\S]{0,120}setConfirmNewPassword\(""\)/,
  );
  assert.doesNotMatch(setupSource, /supabase\.auth\.updateUser\(/);
});

test("legacy Auth callbacks preserve credentials while durable email uses a fragment", () => {
  const source = read(employeeRoutePath);
  const emailSource = read(invitationEmailPath);
  const redirectStart = source.indexOf("function invitationRedirect(");
  const redirectEnd = source.indexOf("\n}\n", redirectStart);
  assert.ok(redirectStart >= 0 && redirectEnd > redirectStart);
  const redirectSource = source.slice(redirectStart, redirectEnd + 3);
  assert.match(
    redirectSource,
    /new URL\(\s*`\/enterprise\/\$\{encodeURIComponent\(siteId\)\}`/,
  );
  assert.match(redirectSource, /["']iv["']\s*[,):]|\biv\s*:/);
  assert.match(redirectSource, /String\(invitationVersion\)/);
  assert.match(redirectSource, /["']it["']\s*[,):]|\bit\s*:/);
  assert.match(redirectSource, /invitationToken/);
  assert.match(redirectSource, /searchParams\.set\(\s*["']iv["']/);
  assert.match(redirectSource, /searchParams\.set\(\s*["']it["']/);
  assert.doesNotMatch(redirectSource, /redirect\.hash\s*=/);
  assert.match(
    emailSource,
    /url\.hash\s*=\s*new URLSearchParams\(\{[\s\S]{0,160}iv:[\s\S]{0,80}it:/,
  );
  assert.doesNotMatch(
    emailSource,
    /url\.searchParams\.set\(\s*["'](?:iv|it)["']/,
  );
  assert.match(
    source,
    /reserveMerchantEnterpriseEmployeeInvitation\(store,[\s\S]*tokenHash:\s*secret\.tokenHash/,
  );
  assert.doesNotMatch(
    source,
    /reserveMerchantEnterpriseEmployeeInvitation\(store,[\s\S]{0,400}(?:token|tokenHash):\s*secret\.token(?:,|\s*\})/,
  );
});

test("legacy staff creation writes the immutable email marker required by durable delivery", () => {
  const routeSource = read(employeeRoutePath);
  assert.match(routeSource, /import \{ createHash \} from "node:crypto"/);
  assert.match(
    routeSource,
    /async function markAuthUserAsStaff\([\s\S]{0,220}expectedEmail: string/,
  );
  assert.match(
    routeSource,
    /const expectedEmailHash = createHash\("sha256"\)[\s\S]{0,400}merchant_staff_email_hash/,
  );
  assert.match(
    routeSource,
    /currentEmailHash && currentEmailHash !== expectedEmailHash\) return false/,
    "a different immutable email marker must be rejected rather than overwritten",
  );
  assert.match(
    routeSource,
    /app_metadata:[\s\S]{0,240}merchant_staff_email_hash: expectedEmailHash/,
  );
  assert.match(
    routeSource,
    /MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY[\s\S]{0,300}: false/,
    "new staff identities must start with a server-owned uninitialized password marker",
  );
  assert.match(
    routeSource,
    /markAuthUserAsStaff\(service, user, employee\.email\)/,
  );
  assert.match(
    routeSource,
    /markAuthUserAsStaff\([\s\S]{0,80}service,[\s\S]{0,80}authUser,[\s\S]{0,80}employee\.email,[\s\S]{0,80}invitationAlreadySent/,
  );
});

test("legacy invitation delivery exposes only allowlisted Auth failure categories", () => {
  const routeSource = read(employeeRoutePath);
  const classifierStart = routeSource.indexOf(
    "export function classifyMerchantEnterpriseInvitationAuthError(",
  );
  const classifierEnd = routeSource.indexOf("\n}\n", classifierStart);
  assert.ok(classifierStart >= 0 && classifierEnd > classifierStart);
  const classifierSource = routeSource.slice(classifierStart, classifierEnd + 3);
  assert.match(classifierSource, /typeof candidate\?\.code === "string"/);
  assert.match(classifierSource, /code === "unexpected_failure"/);
  assert.doesNotMatch(classifierSource, /\.message|\.stack/);
  assert.match(
    routeSource,
    /invite\.error[\s\S]{0,320}classifyMerchantEnterpriseInvitationAuthError\(invite\.error\)/,
  );
  assert.match(
    routeSource,
    /sendExistingStaffAccessEmail[\s\S]*classifyMerchantEnterpriseInvitationAuthError\(result\.error\)/,
  );
});

test("durable invitation retries reach database idempotency before stale local checks", () => {
  const source = read(employeeRoutePath);
  const postStart = source.indexOf("export async function POST(request: Request)");
  const patchStart = source.indexOf("export async function PATCH(request: Request)");
  assert.ok(postStart >= 0 && patchStart > postStart);
  const postSource = source.slice(postStart, patchStart);
  const postOutbox = postSource.indexOf(
    'resolveMerchantEnterpriseInvitationDeliveryMode() === "outbox"',
  );
  const duplicateEmail = postSource.indexOf(
    "snapshot.employees.some((employee) => employee.email === email)",
  );
  const snapshotLoad = postSource.indexOf("loadMerchantEnterpriseSnapshot(");
  assert.ok(postOutbox >= 0 && snapshotLoad > postOutbox);
  assert.ok(postOutbox >= 0 && duplicateEmail > postOutbox);

  const patchSource = source.slice(patchStart);
  const schedule = patchSource.indexOf(
    "scheduleMerchantEnterpriseEmployeeInvitationDeliveryV2(store",
  );
  const localVersionConflict = patchSource.indexOf(
    "currentEmployee.version !== body.version",
  );
  const localActionCheck = patchSource.indexOf(
    "getMerchantEnterpriseInvitationActionError(",
  );
  assert.ok(schedule >= 0 && localVersionConflict > schedule);
  assert.ok(localActionCheck > schedule);
  assert.match(
    patchSource.slice(schedule, schedule + 700),
    /version:\s*body\.version/,
  );
});

test("invitation lifecycle writes carry the server-derived actor into every RPC", () => {
  const routeSource = read(employeeRoutePath);
  const storeSource = read(invitationStorePath);

  assert.equal(
    routeSource.match(
      /const mutationActor = getMerchantEnterpriseEmployeeMutationActor\(actor\);/g,
    )?.length,
    2,
  );
  assert.match(
    routeSource,
    /reserveEmployeeInvitationResend\(\s*store,\s*employee,\s*mutationActor,/,
  );
  assert.match(
    routeSource,
    /revokeMerchantEnterpriseEmployeeInvitation\(store,\s*\{[\s\S]{0,240}\.\.\.mutationActor/,
  );
  assert.match(
    routeSource,
    /removeMerchantEnterpriseEmployeeInvitation\(store,\s*\{[\s\S]{0,240}\.\.\.mutationActor/,
  );
  assert.match(
    routeSource,
    /reserveEmployeeInvitationResend\(\s*store,\s*currentEmployee,\s*mutationActor,/,
  );

  for (const functionName of [
    "reserveMerchantEnterpriseEmployeeInvitation",
    "revokeMerchantEnterpriseEmployeeInvitation",
    "removeMerchantEnterpriseEmployeeInvitation",
  ]) {
    const start = storeSource.indexOf(`export async function ${functionName}`);
    assert.ok(start >= 0, functionName);
    const nextExport = storeSource.indexOf("export async function", start + 1);
    const body = storeSource.slice(
      start,
      nextExport >= 0 ? nextExport : storeSource.length,
    );
    assert.match(body, /actorType:\s*"owner"\s*\|\s*"employee"|MerchantEnterpriseInvitationMutationActor/);
    assert.match(body, /actor_type:\s*actor\.actorType/);
    assert.match(body, /actor_id:\s*actor\.actorId/);
  }
});

test("employee invitation compensation uses the versioned removal RPC without direct table DML", () => {
  const routeSource = read(employeeRoutePath);
  const enterpriseStoreSource = read(enterpriseStorePath);

  assert.match(
    routeSource,
    /invitation\.error === "employee_email_already_registered"[\s\S]{0,500}removeMerchantEnterpriseEmployeeInvitation\(store,\s*\{[\s\S]{0,180}version:\s*employee\.version,[\s\S]{0,120}\.\.\.mutationActor/,
  );
  assert.doesNotMatch(
    routeSource,
    /\.from\(["']merchant_enterprise_employees["']\)[\s\S]{0,160}\.(?:delete|update)\(/,
  );
  assert.doesNotMatch(
    enterpriseStoreSource,
    /\.from\(["']merchant_enterprise_employees["']\)[\s\S]{0,160}\.(?:delete|update)\(/,
  );
  assert.doesNotMatch(
    enterpriseStoreSource,
    /export async function bindMerchantEnterpriseEmployeeAuthUser\(/,
  );
});

test("portal persists fragment credentials, scrubs the URL, and performs a top-level POST exchange", () => {
  const source = read(portalPath);
  const resolveStart = source.indexOf("async function resolveSession(");
  const resolveEnd = source.indexOf("void resolveSession(initializationGeneration);", resolveStart);
  assert.ok(resolveStart >= 0 && resolveEnd > resolveStart);
  const resolveSource = source.slice(resolveStart, resolveEnd);
  const parseQuery = resolveSource.indexOf("parseInvitationCredential(url.searchParams)");
  const parseFragment = resolveSource.indexOf("parseInvitationCredential(hash)");
  const storeCredential = resolveSource.indexOf(
    "storeInvitationCredential(siteId, incomingCredential)",
  );
  const replaceUrl = resolveSource.indexOf("window.history.replaceState(");
  const postExchange = resolveSource.indexOf(
    "submitInvitationExchange(siteId, storedInvitation)",
  );

  for (const index of [parseQuery, parseFragment, storeCredential, replaceUrl, postExchange]) {
    assert.ok(index >= 0);
  }
  assert.ok(parseQuery < storeCredential);
  assert.ok(parseFragment < storeCredential);
  assert.ok(storeCredential < replaceUrl);
  assert.ok(replaceUrl < postExchange);
  assert.match(source, /params\.getAll\("iv"\)\.length\s*!==\s*1/);
  assert.match(source, /params\.getAll\("it"\)\.length\s*!==\s*1/);
  assert.match(source, /const hash = new URLSearchParams\(url\.hash\.replace\(\/\^#\/, ""\)\)/);
  assert.match(source, /url\.searchParams\.delete\("code"\)/);
  assert.match(source, /url\.searchParams\.delete\("iv"\)/);
  assert.match(source, /url\.searchParams\.delete\("it"\)/);
  assert.match(source, /url\.searchParams\.delete\("invitation_error"\)/);
  assert.match(source, /url\.searchParams\.delete\("retry_after"\)/);
  assert.match(source, /url\.hash\s*=\s*""/);
  assert.match(
    source,
    /function invitationStorageKey\(siteId: string\)[\s\S]{0,100}`\$\{INVITATION_STORAGE_PREFIX\}:\$\{siteId\}`/,
  );
  assert.match(
    source,
    /window\.sessionStorage\.setItem\([\s\S]{0,120}JSON\.stringify\(credential\)/,
  );
  assert.match(source, /window\.sessionStorage\.getItem\(invitationStorageKey\(siteId\)\)/);
  assert.match(source, /attemptId:\s*createInvitationAttemptId\(\)/);
  assert.match(source, /createdAt:\s*Date\.now\(\)/);
  const ttl = source.match(
    /const INVITATION_HANDOFF_TTL_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
  );
  assert.ok(ttl);
  const ttlMs = Number(ttl[1]) * 60 * 60 * 1000;
  assert.ok(61 * 60 * 1000 < ttlMs, "a 61-minute auth round trip must retain the invitation");
  assert.ok(2 * 60 * 60 * 1000 >= ttlMs, "the handoff must expire by two hours");
  assert.ok(ttlMs <= 7 * 24 * 60 * 60 * 1000, "the handoff must not outlive the invitation");
  assert.match(source, /now - createdAt\s*>=\s*INVITATION_HANDOFF_TTL_MS/);
  assert.match(source, /new URL\(\s*"\/api\/merchant-enterprise\/invitations\/exchange",\s*window\.location\.origin/);
  assert.match(source, /form\.method\s*=\s*"POST"/);
  assert.match(source, /form\.target\s*=\s*"_top"/);
  assert.match(source, /form\.submit\(\)/);
  assert.match(source, /\["invitationToken", credential\.invitationToken\]/);
  assert.doesNotMatch(
    source,
    /(?:window\.)?localStorage\.(?:setItem|getItem)\(/,
  );
  assert.doesNotMatch(source, /fetch\(\s*["']\/api\/merchant-enterprise\/invitations\/exchange/);
  assert.doesNotMatch(source, /searchParams\.set\(\s*["']it["']/);
});

test("exchange failures return to the portal without reposting stored credentials", () => {
  const source = read(portalPath);
  assert.match(source, /function parseInvitationExchangeError\(params: URLSearchParams\)/);
  assert.match(source, /code === "invalid"/);
  assert.match(source, /code === "unavailable"/);
  assert.match(source, /code === "rate_limited"/);
  const resolveStart = source.indexOf("async function resolveSession(");
  const errorRead = source.indexOf(
    "parseInvitationExchangeError(url.searchParams)",
    resolveStart,
  );
  const clearTerminal = source.indexOf("clearInvitationCredential();", errorRead);
  const storedRead = source.indexOf("readStoredInvitationCredential(siteId)", errorRead);
  assert.ok(errorRead >= 0 && clearTerminal > errorRead && storedRead > clearTerminal);
});

test("portal coalesces simultaneous auth callbacks and consumes credentials only after success", () => {
  const source = read(portalPath);
  assert.match(
    source,
    /const acceptanceKey = invitationAcceptanceKey\(token, siteId, invitationVersion\);/,
  );
  assert.match(
    source,
    /if \(!token \|\| acceptedAcceptanceKeysRef\.current\.has\(acceptanceKey\)\) return;/,
  );
  assert.match(
    source,
    /const inFlight = acceptanceInFlightRef\.current\.get\(acceptanceKey\);[\s\S]{0,80}if \(inFlight\) return inFlight;/,
  );
  const acceptCall = source.indexOf(
    "acceptEnterpriseMembership(siteId, token, invitation)",
  );
  const markAccepted = source.indexOf(
    "acceptedAcceptanceKeysRef.current.add(acceptanceKey)",
    acceptCall,
  );
  const consumeCredential = source.indexOf(
    "clearInvitationCredential(invitation)",
    acceptCall,
  );
  const clearInFlight = source.indexOf(
    "acceptanceInFlightRef.current.delete(acceptanceKey)",
    acceptCall,
  );
  assert.ok(acceptCall >= 0);
  assert.ok(acceptCall < markAccepted);
  assert.ok(markAccepted < consumeCredential);
  assert.ok(consumeCredential < clearInFlight);
  assert.match(
    source,
    /acceptanceInFlightRef\.current\.set\(acceptanceKey, acceptance\);/,
  );
  assert.match(
    source,
    /supabase\.auth\.onAuthStateChange\([\s\S]*ensureMembershipAccepted\(token\)/,
  );
  assert.match(
    source,
    /error instanceof EnterpriseInvitationAcceptanceError[\s\S]{0,100}error\.terminal[\s\S]{0,100}clearInvitationCredential\(invitation\)/,
  );
});

test("portal resumes an authenticated invitation acceptance without issuing another Auth link", () => {
  const source = read(portalPath);
  assert.match(
    source,
    /stage: "exchange_pending" \| "password_pending" \| "accept_pending"/,
  );
  assert.match(
    source,
    /function markInvitationAcceptPending\([\s\S]{0,500}requiresInitialPassword = false[\s\S]{0,500}stage: requiresInitialPassword \? "password_pending" : "accept_pending"[\s\S]{0,160}persistStoredInvitationCredential/,
  );
  assert.match(
    source,
    /storedInvitation\.stage === "exchange_pending"[\s\S]{0,420}submitInvitationExchange\(siteId, storedInvitation\)/,
    "only a pre-authentication handoff may submit the exchange form",
  );
  const callbackSession = source.indexOf(
    "callbackSession = exchanged.data.session;",
  );
  const markPending = source.indexOf(
    "markInvitationAcceptPending(",
    callbackSession,
  );
  const callbackGenerationGuard = source.indexOf(
    "authGeneration.isGenerationCurrent(generation, cancelled)",
    callbackSession,
  );
  const scrubCallback = source.indexOf(
    "scrubResolvedCallbackUrl?.();",
    markPending,
  );
  const fallbackSessionRead = source.indexOf(
    "const result = await supabase.auth.getSession();",
    scrubCallback,
  );
  const passwordPendingGate = source.indexOf(
    'if (token && storedInvitation?.stage === "password_pending")',
    fallbackSessionRead,
  );
  const passwordPendingReturn = source.indexOf("return;", passwordPendingGate);
  const acceptMembership = source.indexOf(
    "ensureMembershipAccepted(token)",
    fallbackSessionRead,
  );
  assert.ok(
    callbackSession >= 0 &&
      callbackGenerationGuard > callbackSession &&
      markPending > callbackGenerationGuard &&
      scrubCallback > markPending &&
      fallbackSessionRead > scrubCallback &&
      passwordPendingGate > fallbackSessionRead &&
      passwordPendingReturn > passwordPendingGate &&
      acceptMembership > fallbackSessionRead,
    "the callback result must persist password_pending and scrub before any fallback session read",
  );
  assert.ok(
    passwordPendingReturn < acceptMembership,
    "an invitation bootstrap session must return before membership acceptance",
  );
  assert.match(
    source.slice(markPending, markPending + 420),
    /callbackSession\.user\.id,\s*true/,
    "an Auth invitation callback must enter password_pending",
  );
  assert.match(
    source,
    /storedInvitation\?\.stage === "password_pending"[\s\S]{0,100}storedInvitation\?\.stage === "accept_pending"[\s\S]{0,120}session\?\.user\?\.id !== storedInvitation\.authUserId/,
    "a different cached employee session must never consume the stored invitation",
  );
  assert.match(
    source,
    /payload\?\.error === "invalid_employee_invitation_credentials"[\s\S]{0,160}true/,
    "invalid credentials are terminal and must not loop on reload",
  );
  assert.match(
    source,
    /!authCallbackInProgress \|\| invitationError \|\| storageError/,
    "a valid Auth callback must retain its code or hash until the session is durably bound to the invitation",
  );
  assert.match(
    source,
    /markInvitationAcceptPending\([\s\S]{0,650}storedInvitationCredentialRef\.current = storedInvitation;[\s\S]{0,650}scrubResolvedCallbackUrl\?\.\(\)/,
    "the callback URL may be scrubbed only after password_pending survives a reload",
  );

  const listenerStart = source.indexOf("supabase.auth.onAuthStateChange");
  const listenerPasswordGate = source.indexOf(
    'if (storedInvitation?.stage === "password_pending")',
    listenerStart,
  );
  const listenerPasswordReturn = source.indexOf("return;", listenerPasswordGate);
  const listenerAccept = source.indexOf(
    "void ensureMembershipAccepted(token)",
    listenerStart,
  );
  assert.ok(listenerPasswordGate > listenerStart);
  assert.ok(listenerPasswordReturn > listenerPasswordGate);
  assert.ok(listenerAccept > listenerPasswordReturn);

  const passwordUiGate = source.indexOf(
    "if (accessToken && initialPasswordSetupState)",
  );
  const workspaceRender = source.indexOf("<MerchantEmployeeWorkspace");
  assert.ok(passwordUiGate >= 0 && workspaceRender > passwordUiGate);

  const passwordAcceptanceStart = source.indexOf(
    "async function acceptPendingInvitationWithPasswordSession",
  );
  const passwordAcceptanceEnd = source.indexOf(
    "async function signIn()",
    passwordAcceptanceStart,
  );
  const passwordAcceptanceSource = source.slice(
    passwordAcceptanceStart,
    passwordAcceptanceEnd,
  );
  const markPasswordCompleted = source.indexOf(
    "markInvitationPasswordCompleted(siteId, storedInvitation)",
    passwordAcceptanceStart,
  );
  const acceptanceGeneration = passwordAcceptanceSource.indexOf(
    "beginPasswordAuthenticatedPortalSession(token)",
  );
  const passwordSessionAccept = passwordAcceptanceSource.indexOf(
    "await ensureMembershipAccepted(token)",
  );
  const currentGenerationGuard = passwordAcceptanceSource.indexOf(
    "authGeneration.isCurrent(generation, token)",
    passwordSessionAccept,
  );
  const acceptanceSuccess = passwordAcceptanceSource.indexOf(
    "setInitialPasswordSetupState(null)",
    currentGenerationGuard,
  );
  assert.ok(passwordAcceptanceStart >= 0);
  assert.ok(passwordAcceptanceEnd > passwordAcceptanceStart);
  assert.ok(markPasswordCompleted > passwordAcceptanceStart);
  assert.ok(acceptanceGeneration > 0);
  assert.ok(passwordSessionAccept > acceptanceGeneration);
  assert.ok(currentGenerationGuard > passwordSessionAccept);
  assert.ok(acceptanceSuccess > currentGenerationGuard);
  assert.match(
    passwordAcceptanceSource,
    /finally\s*\{[\s\S]{0,160}authGeneration\.isCurrent\(generation, token\)[\s\S]{0,100}setChecking\(false\)/,
  );
  assert.doesNotMatch(
    passwordAcceptanceSource.slice(passwordSessionAccept),
    /beginPasswordAuthenticatedPortalSession\(token\)|authGeneration\.begin\(\)/,
    "an old acceptance completion must never create a newer generation",
  );
});

test("portal exits terminal password acceptance states and never traps sign-out", () => {
  const source = read(portalPath);
  const signInStart = source.indexOf("async function signIn()");
  const signInEnd = source.indexOf(
    "async function completeInitialPasswordSetup()",
    signInStart,
  );
  const signInSource = source.slice(signInStart, signInEnd);
  const terminalBranch = signInSource.indexOf(
    "error instanceof EnterpriseInvitationAcceptanceError",
  );
  const credentialRetry = signInSource.indexOf(
    'storedInvitationCredentialRef.current?.stage === "accept_pending"',
    terminalBranch,
  );
  assert.ok(signInStart >= 0 && signInEnd > signInStart);
  assert.ok(terminalBranch >= 0 && credentialRetry > terminalBranch);
  assert.match(
    signInSource.slice(terminalBranch, credentialRetry),
    /error\.terminal[\s\S]{0,220}setAuthContext\(null\)[\s\S]{0,120}setInitialPasswordSetupState\(null\)[\s\S]{0,120}setChecking\(false\)/,
  );
  assert.doesNotMatch(
    source,
    /disabled=\{busy \|\| initialPasswordSetupState === "accepting"\}/,
  );
  const exitText = source.indexOf("退出并稍后处理");
  const exitButton = source.lastIndexOf("<button", exitText);
  assert.ok(exitText > 0 && exitButton > 0);
  assert.match(source.slice(exitButton, exitText), /disabled=\{busy\}/);
});

test("portal clears initial password secrets before leaving onboarding", () => {
  const source = read(portalPath);
  assert.match(
    source,
    /error instanceof EnterpriseInitialPasswordSetupError[\s\S]{0,120}error\.existingPasswordRequired[\s\S]{0,260}setNewPassword\(""\)[\s\S]{0,120}setConfirmNewPassword\(""\)/,
  );
  assert.match(
    source,
    /aria-controls="enterprise-portal-account-security"[\s\S]{0,220}clearInitialPasswordOperation\(\)[\s\S]{0,100}setNewPassword\(""\)[\s\S]{0,100}setConfirmNewPassword\(""\)/,
  );
});

test("portal persists one UUID for the invitation across reload-safe password retries", () => {
  const source = read(portalPath);
  const operationStart = source.indexOf("function initialPasswordOperationFor(");
  const operationEnd = source.indexOf(
    "function clearInitialPasswordOperation(",
    operationStart,
  );
  const operationSource = source.slice(operationStart, operationEnd);
  assert.ok(operationStart >= 0 && operationEnd > operationStart);
  assert.match(
    operationSource,
    /current\?\.invitationVersion === invitation\.invitationVersion[\s\S]{0,180}current\.invitationToken === invitation\.invitationToken[\s\S]{0,160}current\.password === submittedPassword[\s\S]{0,100}return current/,
  );
  assert.match(
    operationSource,
    /invitation\.initialPasswordOperationId[\s\S]{0,900}operationId: invitation\.initialPasswordOperationId[\s\S]{0,100}password: submittedPassword[\s\S]{0,120}initialPasswordOperationRef\.current = operation/,
  );
  assert.match(
    source,
    /initialPasswordOperationId: requiresInitialPassword[\s\S]{0,160}credential\.initialPasswordOperationId \?\? createInvitationAttemptId\(\)/,
    "the password operation UUID must be persisted before the setup form is shown",
  );
  assert.match(
    source,
    /initialPasswordOperationId,invitationToken,invitationVersion,stage[\s\S]{0,700}stage === "password_pending"[\s\S]{0,180}INVITATION_ATTEMPT_ID_PATTERN\.test\(initialPasswordOperationId\)/,
    "a reloaded password-pending handoff must require the persisted UUID",
  );
  assert.match(
    source,
    /payload\?\.error === "employee_initial_password_setup_in_progress"[\s\S]{0,180}response\.status >= 400 && !retryableOperationFailure/,
    "an in-progress response must preserve the operation UUID for retry",
  );
});

test("portal ignores stale session events while an Auth callback establishes the invited account", () => {
  const source = read(portalPath);
  assert.match(source, /const authCallbackInProgressRef = useRef\(false\)/);
  const resolveStart = source.indexOf("async function resolveSession(");
  const exchangeCode = source.indexOf("supabase.auth.exchangeCodeForSession(code)", resolveStart);
  const markCallback = source.indexOf(
    "authCallbackInProgressRef.current = true",
    resolveStart,
  );
  assert.ok(markCallback > resolveStart && exchangeCode > markCallback);
  const listenerStart = source.indexOf("supabase.auth.onAuthStateChange", resolveStart);
  const listenerEnd = source.indexOf("return () =>", listenerStart);
  const listenerSource = source.slice(listenerStart, listenerEnd);
  const staleGuard = listenerSource.indexOf(
    "if (authCallbackInProgressRef.current) return",
  );
  const begin = listenerSource.indexOf("authGeneration.begin()");
  assert.ok(staleGuard >= 0 && begin > staleGuard);
  assert.match(source, /if \(authCallbackInProgress\) \{\s*authCallbackInProgressRef\.current = false/);
});

test("portal explains that a disabled employee account needs owner action", () => {
  const source = read(portalPath);
  assert.match(
    source,
    /payload\?\.error === "employee_account_disabled"[\s\S]{0,180}员工账号已停用，请联系企业负责人/,
  );
});

test("enterprise callback forbids credential referrer leakage", () => {
  const source = read(portalPagePath);
  assert.match(
    source,
    /export const metadata:\s*Metadata\s*=\s*\{[\s\S]*referrer:\s*"no-referrer"/,
  );
});
