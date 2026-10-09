// Strict synthetic HTTP/Auth only. No database, inventories or authority claims.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createPeriodEnterpriseModel,periodEnterprisePaths} from './attendance-period-enterprise-browser.mjs';
const require=createRequire(import.meta.url),base='/api/merchant-enterprise/attendance/';
export const managementBrowserPaths=Object.freeze({management:base+'management-delegation',audit:base+'delegated-audit',groups:base+'delegated-groups',configuration:base+'delegated-configuration',rules:base+'delegated-rules',terminals:base+'delegated-terminals',pin:base+'delegated-pin',revisions:base+'delegated-revisions',
 admin:periodEnterprisePaths.admin,overview:periodEnterprisePaths.overview,todos:periodEnterprisePaths.todos,operations:periodEnterprisePaths.operations});
export async function createManagementBrowserModel(){
 const m=require('../../src/lib/merchantAttendanceManagementDelegation.ts'),a=require('../../src/lib/merchantAttendanceDelegatedAudit.ts'),
  g=require('../../src/lib/merchantAttendanceDelegatedGroups.ts'),cfg=require('../../src/lib/merchantAttendanceDelegatedConfiguration.ts'),r=require('../../src/lib/merchantAttendanceDelegatedRules.ts'),
  oldRules=require('../../src/lib/merchantAttendanceRuleDraft.ts'),op=require('../../src/lib/merchantAttendanceOperationalRuleLedger.ts'),opRules=require('../../src/lib/merchantAttendanceOperationalRules.ts'),admin=require('../../src/lib/merchantAttendanceAdmin.ts'),
  client=require('../../src/lib/merchantAttendanceManagementDelegatedClient.ts'),cr=require('../../src/lib/merchantAttendanceDelegatedCredentials.ts'),rv=require('../../src/lib/merchantAttendanceDelegatedRevisions.ts'),
  revisionModel=require('./attendance-revision-approval-model.ts');
 const enterprise=createPeriodEnterpriseModel(),id=n=>`20400000-0000-4000-8000-${String(n).padStart(12,'0')}`,
  at='2026-10-08T12:00:00.000001Z',readAt='2026-10-08T14:00:00.000000Z',siteId=enterprise.seed.siteId,
  owner=enterprise.seed.ownerId,delegate=enterprise.seed.authUserId;
 const seed={siteId,owner,delegate,employeeId:enterprise.seed.actorEmployeeId,other:enterprise.seed.otherAuthUserId,
  auditGrantId:id(1),groupGrantId:id(2),groupId:id(3),workerConfigurationGrantId:id(20),locationConfigurationGrantId:id(21),
  configurationWorkerId:id(22),configurationEmployeeId:id(23),configurationLocationId:id(24),baseRulesGrantId:id(100),operationalDraftGrantId:id(101),operationalPublishGrantId:id(102),
  knownRouteEmployeeId:id(103),knownRouteAuthId:id(104),terminalPrepareGrantId:id(201),terminalRevokeGrantId:id(202),memberPinIssueGrantId:id(203),memberPinRevokeGrantId:id(204),independentPinIssueGrantId:id(205),
  credentialTerminalId:id(206),credentialLocationId:id(207),credentialWorkerId:id(208),credentialEmployeeId:id(209),credentialAuthId:id(210),credentialIndependentWorkerId:id(211),credentialSubjectId:id(212),
  revisions:{approve:{grantId:id(301),requestId:id(303),workerId:id(305),employeeId:id(307),employeeAuthUserId:id(309),locationId:id(311)},
   reject:{grantId:id(302),requestId:id(304),workerId:id(306),employeeId:id(308),employeeAuthUserId:id(310),locationId:id(312)}},
  enterprise:enterprise.seed,paths:Object.values(managementBrowserPaths),
  slots:{owner:client.attendanceManagementPendingKey(siteId,owner),delegate:client.attendanceManagementPendingKey(siteId,delegate)}};
 const records=new Map(),writes=[];let recovery='valid';
 //Two independently identified, explicitly synthetic submitted requests. Reuse
 //the actual old later-cycle model and strict parser, not a weakened DTO stub.
 const revisionContexts=new Map();
 for(const [which,target]of Object.entries(seed.revisions)){
  const old=revisionModel.revisionApprovalResponse(),app=old.review.review.application,
   ids=new Map([[old.requestId,target.requestId],[app.workerId,target.workerId],[app.employeeId,target.employeeId],[app.basis.events[0].locationId,target.locationId]]);let serial=which==='approve'?350:400;
  const clone=value=>{if(typeof value==='string'){if(value===old.siteId)return siteId;if(/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(value)){if(!ids.has(value))ids.set(value,id(serial++));return ids.get(value);}return value;}
   if(Array.isArray(value))return value.map(clone);return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,v])=>[key,clone(v)])):value;};
  const review=clone(old);review.review.review.item.workerName='Synthetic208 '+which+' employee';review.review.review.item.workerNo='S208-'+which;
  revisionContexts.set(target.grantId,{protocol:rv.DELEGATED_REVISIONS_PROTOCOL,siteId,actorId:delegate,readAt,kind:'context',grantId:target.grantId,action:'revision_'+which,
   scope:{kind:'revision',workerId:target.workerId,employeeId:target.employeeId,employeeAuthUserId:target.employeeAuthUserId,locationIds:[target.locationId],includePending:which==='reject'},
   context:{review,canApprove:which==='approve',canReject:which==='reject'}});
 }
 const secretChecks={preparePosts:0,pinPosts:0,pairHashChecked:true,pinFormatChecked:true},credentialAt='2026-10-08T13:59:00.000001Z';
 const credentialsContext=(grantId,actor=delegate)=>{
  assert.equal(actor,delegate,'credentials_actual_delegate');
  const terminals=[seed.terminalPrepareGrantId,seed.terminalRevokeGrantId].includes(grantId),member=[seed.memberPinIssueGrantId,seed.memberPinRevokeGrantId].includes(grantId);
  assert(terminals||member||grantId===seed.independentPinIssueGrantId,'known_credentials_grant');
  const action=grantId===seed.terminalPrepareGrantId?'terminal_prepare':grantId===seed.terminalRevokeGrantId?'terminal_revoke':grantId===seed.memberPinRevokeGrantId?'pin_revoke':'pin_issue',
   common={protocol:terminals?cr.DELEGATED_TERMINALS_PROTOCOL:cr.DELEGATED_PIN_PROTOCOL,siteId,actorId:actor,readAt,kind:'context',grantId,action};
  if(terminals){const created=writes.find(w=>w.domain==='terminals'&&w.command.action==='terminal_prepare'),revoked=writes.some(w=>w.domain==='terminals'&&w.command.action==='terminal_revoke');
   assert(action==='terminal_prepare'?!created:!!created,'synthetic_terminal_existence_matches_grant');return{...common,scope:{kind:'terminal',terminalId:seed.credentialTerminalId,locationId:seed.credentialLocationId,create:action==='terminal_prepare'},
   context:{location:{locationId:seed.credentialLocationId,name:'Synthetic207 scoped entrance',timeZone:'UTC',version:2,active:true},
    terminal:action==='terminal_prepare'?null:{id:seed.credentialTerminalId,label:created.command.label,locationId:seed.credentialLocationId,locationName:'Synthetic207 scoped entrance',timeZone:'UTC',state:revoked?'revoked':'pending',
     createdAt:credentialAt,pairExpiresAt:'2026-10-08T14:04:00.000001Z',pairedAt:null,deviceExpiresAt:null,revokedAt:revoked?credentialAt:null}}};}
  if(member){const entries=writes.filter(w=>w.domain==='pin'&&w.command.kind==='member_pin'),revision=1+entries.length;
   return{...common,scope:{kind:'member_pin',workerId:seed.credentialWorkerId,employeeId:seed.credentialEmployeeId,employeeAuthUserId:seed.credentialAuthId,locationIds:[seed.credentialLocationId]},
    context:{employeeAuthUserId:seed.credentialAuthId,status:{siteId,workerId:seed.credentialWorkerId,employeeId:seed.credentialEmployeeId,workerNo:'S207-member',workerName:'Synthetic207 member',ready:true,revision,
     enabled:entries.at(-1)?.command.action!=='pin_revoke',bindingCurrent:true,changedAt:credentialAt,receipt:null}}};}
  return{...common,scope:{kind:'independent_pin',workerId:seed.credentialIndependentWorkerId,subjectId:seed.credentialSubjectId,generation:1,locationIds:[seed.credentialLocationId]},context:{settingsVersion:7,detail:{kind:'detail',
   subject:{workerId:seed.credentialIndependentWorkerId,subjectId:seed.credentialSubjectId,workerNo:'S207-independent',displayName:'Synthetic207 independent',startsOn:'2026-10-01',locationId:seed.credentialLocationId,enabled:true,generation:1,
    revision:2,workerVersion:3,state:'independent',createdAt:at},credential:{credentialId:id(213),enabled:true,revision:1,generation:1,changedAt:credentialAt},
   head:{sequence:0,status:'off',lastEventId:null,lastAction:null,lastAt:null},binding:null}}};
 };
 const baseBaseline={...oldRules.emptyAttendanceRuleDraft(),earlyGraceMinutes:{mode:'value',minutes:23}},
  opBaseline=opRules.parseOperationalRules({...Object.fromEntries(opRules.OPERATIONAL_RULE_KEYS.map(key=>[key,{mode:'inherit'}])),
   correctionWindow:{mode:'value',value:{days:7}},timesheetCycle:{mode:'value',value:{kind:'monthly'}},
   reviewRouting:{mode:'value',value:{correction:{delegateEmployeeId:seed.knownRouteEmployeeId,delegateAuthUserId:seed.knownRouteAuthId},missing:'owner',leave:'owner',work_arrangement:'owner'}}}),
  opScope={kind:'enterprise'},opContext={settingsVersion:9,timeZone:'UTC',subject:null},
  opReferences={subject:null,locations:[],routes:[{category:'correction',employeeId:seed.knownRouteEmployeeId,employeeAuthUserId:seed.knownRouteAuthId,employeeVersion:7,active:true}]},
  opDraftCommand={siteId,scope:opScope,action:'save_draft',operationId:id(160),expectedRevision:2,reason:'Synthetic206 saved same-layer baseline',expectedContext:opContext,rules:opBaseline},
  opDraft={scope:opScope,action:'save_draft',operationId:opDraftCommand.operationId,actorId:delegate,revision:3,reason:opDraftCommand.reason,recordedAt:at,
   commandFingerprint:await op.operationalRuleLedgerCommandFingerprint(opDraftCommand,delegate),context:opContext,rules:opBaseline,
   rulesFingerprint:await op.operationalRuleLedgerRulesFingerprint(opBaseline),references:opReferences,
   referenceFingerprint:await op.operationalRuleLedgerReferenceFingerprint(siteId,opScope,opContext,opReferences)};
 const rulesContext=grantId=>{
  assert([seed.baseRulesGrantId,seed.operationalDraftGrantId,seed.operationalPublishGrantId].includes(grantId),'known_rules_grant');
  const operational=grantId!==seed.baseRulesGrantId;
  return{protocol:r.DELEGATED_RULES_PROTOCOL,siteId,actorId:delegate,readAt,kind:'context',grantId,
   action:!operational?'rule_draft':grantId===seed.operationalDraftGrantId?'operational_rule_draft':'operational_rule_publish',
   scope:{kind:'rules',family:operational?'operational':'base',subject:opScope,allowedRuleKeys:operational?['reviewRouting','timesheetCycle']:['lateGraceMinutes'],locationIds:[]},
   context:operational?{family:'operational',detail:{kind:'detail',scope:opScope,revision:3,context:opContext,draft:opDraft,currentPublication:null,nextPublication:null,canWithdraw:false},
    baselineRules:opBaseline,baselineRevision:3,baselineKind:'draft'}
    :{family:'base',revision:4,settingsVersion:9,timeZone:'UTC',group:null,draft:{revision:4,settingsVersion:9,groupRevision:null,timeZone:'UTC',rules:baseBaseline},
     baselineRules:baseBaseline,baselineRevision:4,baselineKind:'draft'}};
 };
 const rulesPreview=async query=>{
  assert.equal(query.grantId,seed.operationalPublishGrantId);assert.equal(query.sourceDraftRevision,3);assert.equal(query.endsOn,null);
  const preview={kind:'preview',scope:opScope,revision:3,sourceDraftRevision:3,context:opContext,rulesFingerprint:opDraft.rulesFingerprint,
   references:opReferences,referenceFingerprint:opDraft.referenceFingerprint,effectiveOn:query.effectiveOn,endsOn:null,effectiveAt:query.effectiveOn+'T00:00:00.000000Z',endsAt:null};
  return{...rulesContext(query.grantId),kind:'preview',context:undefined,preview:{...preview,previewFingerprint:await op.operationalRuleLedgerPreviewFingerprint(siteId,preview),applied:false}};
 };
 const auditItem={operationId:id(10),recordedAt:'2026-10-08T11:00:00.000001Z',kind:'worker',version:1,targetId:id(11),actorRef:'a'.repeat(32),byCurrentOwner:false,holderRef:null};
 const auditRow={item:auditItem,before:null,after:{id:id(11),employeeId:id(12),workerNo:'S204',displayName:'Synthetic browser worker',locationId:id(13),active:true,startsOn:'2026-10-01'}};
 // Explicit scoped fixtures, not a merchant inventory. Global version differs
 // from target version so a real UI cannot substitute the target's CAS value.
 const configurationContext=grantId=>{
  assert([seed.workerConfigurationGrantId,seed.locationConfigurationGrantId].includes(grantId),'known_configuration_grant');
  const worker=grantId===seed.workerConfigurationGrantId,location={id:seed.configurationLocationId,name:'Synthetic205 scoped location',timeZone:'Europe/Madrid',active:true};
  return{protocol:cfg.DELEGATED_CONFIGURATION_PROTOCOL,siteId,actorId:delegate,readAt,kind:'context',grantId,action:worker?'worker_save':'location_save',
   scope:worker?{kind:'worker',create:false,workerId:seed.configurationWorkerId,employeeId:seed.configurationEmployeeId,employeeAuthUserId:seed.other,locationIds:[location.id]}
    :{kind:'location',create:false,locationId:location.id},
   context:{settingsVersion:worker?10:14,targetVersion:worker?3:4,worker:worker?{id:seed.configurationWorkerId,employeeId:seed.configurationEmployeeId,
    workerNo:'S205',displayName:'Synthetic205 scoped worker',locationId:location.id,active:true,startsOn:'2026-10-01'}:null,
    employee:worker?{id:seed.configurationEmployeeId,displayName:'Synthetic205 target employee'}:null,locations:[location]}};
 };
 const grant=command=>({grantId:command.operationId,revision:1,status:'granted',ownerId:owner,
  delegate:{employeeId:command.delegateEmployeeId,authUserId:command.delegateAuthUserId,generation:0},delegatedAction:command.delegatedAction,
  capability:m.MANAGEMENT_DELEGATION_ACTION_CAPABILITY[command.delegatedAction],scope:command.scope,targetGeneration:null,
  validFrom:command.validFrom,validUntil:command.validUntil,reason:command.reason,grantedAt:at,revocation:null,authorityCurrent:true});
 const reply=(data,extras={})=>({status:200,text:JSON.stringify({ok:true,data}),...extras});
 async function respond(url,method,text,headers={}){
  const u=new URL(url);assert(seed.paths.includes(u.pathname));assert(['GET','POST'].includes(method));
  const token=headers['x-merchant-access-token'],identity=Object.entries(enterprise.seed.tokens).find(([,t])=>t===token)?.[0],
   actor=headers['x-synthetic-actor']??(identity==='employee'?delegate:identity==='other'?seed.other:identity==='owner'?owner:null);
  assert([owner,delegate,seed.other].includes(actor),'synthetic_identity_required');
  if([managementBrowserPaths.overview,managementBrowserPaths.todos,managementBrowserPaths.operations].includes(u.pathname)){
   assert.equal(method,'GET');const value=enterprise.respond(url,method,text,token);
   if(u.pathname===managementBrowserPaths.overview&&identity==='employee'){
    // Explicit synthetic permission, solely to exercise BOTH real leave-guard lanes.
    value.body.actor.permissions.push('attendance.correction.review');value.text=JSON.stringify(value.body);
   }return{status:200,text:value.text,actor};
  }
  if(u.pathname===managementBrowserPaths.admin){assert.equal(method,'GET');assert.equal(actor,owner);const query=admin.parseAttendanceAdminQuery(url);
   assert.equal(query.siteId,siteId);assert.equal(query.view,'settings');const data={ok:true,moduleEnabled:true,siteId,view:'settings',version:1,
    settings:{timeZone:'Europe/Madrid',enabled:true,webClockEnabled:true,webBreakPaid:false},items:[],nextCursor:null,receipt:null};
   admin.parseAttendanceAdminResult(data,query);return{status:200,text:JSON.stringify(data),query,actor};
  }
  if(u.pathname===managementBrowserPaths.revisions){
   assert.equal(actor,delegate,'revisions_actual_delegate');let query,command=null;
   if(method==='GET'){const entries=[...u.searchParams];assert.equal(new Set(entries.map(([key])=>key)).size,entries.length);assert.equal(u.hash,'');assert.equal(text,'');query=rv.parseDelegatedRevisionsQuery(Object.fromEntries(entries));}
   else{const pair=rv.parseDelegatedRevisionsBody(rv.parseDelegatedRevisionsJson(text));query=pair.query;command=pair.command;}
   assert.equal(query.siteId,siteId);const common={protocol:rv.DELEGATED_REVISIONS_PROTOCOL,siteId,actorId:actor,readAt};let result;
   if(query.mode==='recover'){const saved=records.get(query.operationId);assert(saved,'only_known_fixture_operation');assert.equal(saved.domain,'revisions');assert.equal(saved.actor,actor);assert.equal(saved.query.grantId,query.grantId);
    const receipt=recovery==='null'?null:structuredClone(saved.result.receipt);if(receipt&&recovery==='wrong-sha')receipt.commandFingerprint='f'.repeat(64);result={...common,kind:'receipt',receipt};
   }else{const context=revisionContexts.get(query.grantId);assert(context,'known_revision_grant');assert.equal(context.context.review.requestId,query.requestId,'exact_revision_request');
    assert(!writes.some(w=>w.domain==='revisions'&&w.query.requestId===query.requestId),'synthetic_request_already_decided');
    await rv.parseDelegatedRevisionsResult(context,query,actor);
    if(command){rv.delegatedRevisionsCommandForContext(context,command);const review=context.context.review;
     result={...common,kind:'receipt',receipt:{operationId:command.operationId,actorId:actor,grantId:query.grantId,action:context.action,
      reference:{kind:'revision',requestId:query.requestId,rootRequestId:review.review.base.lineage.rootRequestId,workerId:context.scope.workerId,employeeId:context.scope.employeeId,
       employeeAuthUserId:context.scope.employeeAuthUserId,requestRevision:command.expectedRevision,baseOperationId:command.expectedBaseOperationId,effectRevision:command.action==='approve'?review.current.revision+1:null},
      commandFingerprint:await rv.delegatedRevisionsCommandFingerprint(query,actor,command),businessFingerprint:'e'.repeat(64),recordedAt:at}};
    }else result=context;
   }
   await rv.parseDelegatedRevisionsResult(result,query,actor,command);
   if(command){assert(!records.has(command.operationId),'duplicate_POST');records.set(command.operationId,{domain:'revisions',actor,query,command,result});writes.push({domain:'revisions',actor,query,command});}
   return reply(result,{query,command,actor,domain:'revisions'});
  }
  if([managementBrowserPaths.terminals,managementBrowserPaths.pin].includes(u.pathname)){
   const domain=u.pathname===managementBrowserPaths.terminals?'terminals':'pin',terminal=domain==='terminals';let query,command=null;
   if(method==='GET'){
    const entries=[...u.searchParams];assert.equal(new Set(entries.map(([key])=>key)).size,entries.length);assert.equal(u.hash,'');assert.equal(text,'');
    const input=Object.fromEntries(entries);if(input.operationId==='')input.operationId=null;query=cr.parseDelegatedCredentialsQuery(input);
   }else{
    //Ephemeral fields are validated here and discarded. They never enter
    //records, writes, response extras or the runner's diagnostic request log.
    const input=cr.parseDelegatedCredentialsJson(text),action=input.command?.action;
    const pair=terminal&&action==='terminal_prepare'?cr.parseDelegatedTerminalPrepareEphemeralBody(input):!terminal&&action==='pin_issue'?cr.parseDelegatedPinIssueEphemeralBody(input)
     :terminal?cr.parseDelegatedTerminalBody(input):cr.parseDelegatedPinBody(input);
    query=pair.query;command=pair.command;
    if('pairSecret' in pair){assert(createHash('sha256').update(pair.pairSecret,'utf8').digest('hex')===command.pairHash,'synthetic_pair_hash_mismatch');secretChecks.preparePosts++;}
    if('pin' in pair){assert(/^[0-9]{8,12}$/.test(pair.pin),'synthetic_pin_format');secretChecks.pinPosts++;}
   }
   assert.equal(query.siteId,siteId);assert.equal(actor,delegate);let result;
   const common={protocol:terminal?cr.DELEGATED_TERMINALS_PROTOCOL:cr.DELEGATED_PIN_PROTOCOL,siteId,actorId:actor,readAt};
   if(query.mode==='recover'){
    const saved=records.get(query.operationId);assert(saved,'only_known_fixture_operation');assert.equal(saved.domain,domain);assert.equal(saved.actor,actor);assert.equal(query.grantId,saved.query.grantId);
    const receipt=recovery==='null'?null:structuredClone(saved.result.receipt);if(receipt&&recovery==='wrong-sha')receipt.commandFingerprint='f'.repeat(64);result={...common,kind:'receipt',receipt};
   }else{
    const context=credentialsContext(query.grantId,actor);
    if(command){if(terminal)cr.delegatedTerminalCommandForContext(context,command);else cr.delegatedPinCommandForContext(context,command);
     const reference=terminal?{kind:'terminal',terminalId:command.terminalId,locationId:command.locationId,auditAction:command.action==='terminal_prepare'?'create':'revoke'}
      :command.kind==='member_pin'?{kind:'member_pin',workerId:command.workerId,employeeId:command.employeeId,employeeAuthUserId:command.employeeAuthUserId,revision:command.expectedRevision+1}
       :{kind:'independent_pin',workerId:command.workerId,subjectId:command.subjectId,subjectRevision:command.expectedSubjectRevision+1,generation:command.expectedGeneration+(command.action==='pin_revoke'?1:0),
        workerVersion:command.expectedWorkerVersion+1,credentialRevision:command.expectedCredentialRevision+1};
     result={...common,kind:'receipt',receipt:{operationId:command.operationId,actorId:actor,grantId:query.grantId,action:command.action,reference,
      commandFingerprint:await(terminal?cr.delegatedTerminalCommandFingerprint:cr.delegatedPinCommandFingerprint)(query,actor,command),businessFingerprint:'d'.repeat(64),recordedAt:credentialAt}};
    }else result=context;
   }
   await(terminal?cr.parseDelegatedTerminalResult:cr.parseDelegatedPinResult)(result,query,actor,command);
   if(command){assert(!records.has(command.operationId),'duplicate_POST');records.set(command.operationId,{domain,actor,query,command,result});writes.push({domain,actor,query,command});}
   assert(!/"(?:pin|pairSecret|p_material|verifier|salt)":/.test(JSON.stringify({result,command})),'credential_secret_retained');
   return reply(result,{query,command,actor,domain});
  }
  const protocol=u.pathname===managementBrowserPaths.management?m:u.pathname===managementBrowserPaths.audit?a:u.pathname===managementBrowserPaths.groups?g:u.pathname===managementBrowserPaths.configuration?cfg:r;
  const pair=method==='POST'?protocol[u.pathname===managementBrowserPaths.management?'parseManagementDelegationBody':u.pathname===managementBrowserPaths.audit?'parseDelegatedAuditBody':u.pathname===managementBrowserPaths.groups?'parseDelegatedGroupsBody':u.pathname===managementBrowserPaths.configuration?'parseDelegatedConfigurationBody':'parseDelegatedRulesBody'](JSON.parse(text)):null;
  const parseScopedUrl=()=>{const entries=[...u.searchParams];assert.equal(u.hash,'');assert.equal(new Set(entries.map(([key])=>key)).size,entries.length);
   const raw=Object.fromEntries(entries);if(raw.operationId==='')raw.operationId=null;
   if(u.pathname===managementBrowserPaths.rules){if(Object.hasOwn(raw,'sourceDraftRevision'))raw.sourceDraftRevision=Number(raw.sourceDraftRevision);if(raw.endsOn==='')raw.endsOn=null;return r.parseDelegatedRulesQuery(raw);}
   return u.pathname===managementBrowserPaths.groups?g.parseDelegatedGroupsQuery(raw):cfg.parseDelegatedConfigurationQuery(raw);};
  const query=pair?.query??([managementBrowserPaths.groups,managementBrowserPaths.configuration,managementBrowserPaths.rules].includes(u.pathname)?parseScopedUrl():protocol[u.pathname===managementBrowserPaths.management?'parseManagementDelegationHttpQuery':'parseDelegatedAuditHttpQuery'](url)),command=pair?.command??null;
  assert.equal(query.siteId,siteId);if(method==='GET')assert.equal(text,'');let result;
  const domain=u.pathname===managementBrowserPaths.management?'management':u.pathname===managementBrowserPaths.audit?'audit':u.pathname===managementBrowserPaths.groups?'groups':u.pathname===managementBrowserPaths.configuration?'configuration':'rules',
   common={protocol:domain==='management'?m.MANAGEMENT_DELEGATION_PROTOCOL:domain==='audit'?a.DELEGATED_AUDIT_PROTOCOL:domain==='groups'?g.DELEGATED_GROUPS_PROTOCOL:domain==='configuration'?cfg.DELEGATED_CONFIGURATION_PROTOCOL:r.DELEGATED_RULES_PROTOCOL,siteId,actorId:actor,readAt};
  if(query.mode==='recover'){
   const saved=records.get(query.operationId);assert(saved,'only_known_fixture_operation');assert.equal(saved.domain,domain);assert.equal(saved.actor,actor);
   if(domain==='groups'||domain==='configuration'||domain==='rules')assert.equal(query.grantId,saved.query.grantId);
   const receipt=recovery==='null'?null:structuredClone(saved.result.receipt);if(receipt&&recovery==='wrong-sha')receipt.commandFingerprint='f'.repeat(64);
   result={...common,kind:'receipt',receipt};
  }else if(domain==='management'){
   assert.equal(actor,owner);
   if(command){assert.equal(command.action,'grant');
    if(r.DELEGATED_RULES_ACTIONS.includes(command.delegatedAction)){assert.equal(command.delegatedAction,'operational_rule_draft');
     assert.deepEqual(command.scope,{kind:'rules',family:'operational',subject:{kind:'enterprise'},allowedRuleKeys:['reviewRouting','timesheetCycle'],locationIds:[]});}
    else{assert.equal(command.delegatedAction,'audit_view');assert.deepEqual(command.scope,{kind:'audit_company',sources:['config']});}
    assert.equal(command.delegateEmployeeId,seed.employeeId);assert.equal(command.delegateAuthUserId,delegate);
    result={...common,kind:'receipt',receipt:{operationId:command.operationId,actorId:actor,action:'grant',grantId:command.operationId,revision:1,
     commandFingerprint:await m.managementDelegationCommandFingerprint(siteId,actor,command),recordedAt:at}};
   }else{assert.equal(query.mode,'list');assert.equal(query.afterId,null);result={...common,kind:'list',canGrant:true,items:[],nextId:null};}
  }else if(domain==='audit'){
   assert.equal(actor,delegate);assert.equal(query.grantId,seed.auditGrantId);assert.equal(query.source,'config');
   const authority={grantId:seed.auditGrantId,source:'config',scopeKind:'audit_company',target:null};
   if(command){assert.equal(command.action,'export');const payload={schemaVersion:1,fromAt:query.fromAt,toAt:query.toAt,asOf:at,count:1,rows:[auditRow]},
     resultFingerprint=createHash('sha256').update(JSON.stringify(['attendance-delegated-audit-snapshot-v1',siteId,actor,seed.auditGrantId,query,payload])).digest('hex');
    result={...common,...authority,kind:'export',payload,receipt:{operationId:command.operationId,actorId:actor,grantId:seed.auditGrantId,action:'export',
     commandFingerprint:await a.delegatedAuditCommandFingerprint(query,actor,command),asOf:at,count:1,resultFingerprint,recordedAt:at}};
   }else if(query.mode==='detail'){assert.equal(query.sourceOperationId,auditItem.operationId);result={...common,...authority,kind:'detail',row:auditRow};}
   else{assert.equal(query.mode,'list');assert.equal(query.asOf,null);result={...common,...authority,kind:'list',asOf:at,items:[auditItem],nextCursor:null};}
  }else if(domain==='groups'){
   assert.equal(actor,delegate);assert.equal(query.grantId,seed.groupGrantId);assert.equal(query.mode,'context');
   if(command){assert.equal(command.action,'save_group');assert.equal(command.groupId,seed.groupId);assert.equal(command.expectedRevision,3);
    result={...common,kind:'receipt',receipt:{operationId:command.operationId,actorId:actor,grantId:seed.groupGrantId,action:'group_save',referenceId:seed.groupId,revision:4,
     commandFingerprint:await g.delegatedGroupsCommandFingerprint(query,actor,command),businessFingerprint:'a'.repeat(64),recordedAt:at}};
   }else result={...common,kind:'context',grantId:seed.groupGrantId,action:'group_save',scope:{kind:'group',groupId:seed.groupId,create:false},
    context:{protocol:'groups-v1',siteId,actorId:actor,settingsVersion:2,timeZone:'UTC',view:'context',
     group:{groupId:seed.groupId,revision:3,name:'Synthetic204 Kitchen',description:'Synthetic scoped group, no directory',active:true,createdAt:at,updatedAt:at},
     worker:null,items:[],nextCursor:null,detail:null,receipt:null}};
  }else if(domain==='configuration'){
   assert.equal(actor,delegate);assert.equal(query.mode,'context');const context=configurationContext(query.grantId);
   if(command){cfg.delegatedConfigurationCommandForContext(context,command);
    result={...common,kind:'receipt',receipt:{operationId:command.operationId,actorId:actor,grantId:query.grantId,action:cfg.delegatedConfigurationAction(command),
     referenceId:command.values.id,revision:command.expectedVersion+1,commandFingerprint:await cfg.delegatedConfigurationCommandFingerprint(query,actor,command),
     businessFingerprint:'b'.repeat(64),recordedAt:at}};
   }else result=context;
  }else{
   assert.equal(actor,delegate);
   if(command){assert.equal(query.mode,'context');const context=rulesContext(query.grantId),decision=command.decision;
    assert.equal(r.delegatedRulesAction(command),context.action);
    if(command.family==='base'){assert.equal(decision.action,'save_draft');assert.equal(decision.expectedRevision,4);assert.equal(decision.expectedSettingsVersion,9);
     assert.deepEqual(decision.rules.earlyGraceMinutes,baseBaseline.earlyGraceMinutes);assert.deepEqual(decision.rules.openSpanWarningMinutes,baseBaseline.openSpanWarningMinutes);assert.deepEqual(decision.rules.completedBreakMinimumMinutes,baseBaseline.completedBreakMinimumMinutes);}
    else{assert.equal(command.family,'operational');assert.equal(decision.action,'publish');assert.equal(decision.expectedRevision,3);assert.equal(decision.sourceDraftRevision,3);
     const preview=await rulesPreview({grantId:query.grantId,sourceDraftRevision:decision.sourceDraftRevision,effectiveOn:decision.effectiveOn,endsOn:decision.endsOn});assert.equal(decision.previewFingerprint,preview.preview.previewFingerprint);}
    result={...common,kind:'receipt',receipt:{operationId:decision.operationId,actorId:actor,grantId:query.grantId,family:command.family,action:r.delegatedRulesAction(command),referenceId:decision.operationId,
     revision:decision.expectedRevision+1,commandFingerprint:await r.delegatedRulesCommandFingerprint(query,actor,command),businessFingerprint:'c'.repeat(64),recordedAt:at}};
   }else if(query.mode==='preview'){result=await rulesPreview(query);delete result.context;}
   else{assert.equal(query.mode,'context');result=rulesContext(query.grantId);}
  }
  await protocol[domain==='management'?'parseManagementDelegationResult':domain==='audit'?'parseDelegatedAuditResult':domain==='groups'?'parseDelegatedGroupsResult':domain==='configuration'?'parseDelegatedConfigurationResult':'parseDelegatedRulesResult'](result,query,actor,command);
  if(command){const operationId=domain==='rules'?command.decision.operationId:command.operationId;assert(!records.has(operationId),'duplicate_POST');records.set(operationId,{domain,actor,query,command,result,grant:domain==='management'?grant(command):null});writes.push({domain,actor,query,command});}
  return reply(result,{query,command,actor,domain});
 }
 return{seed,writes,respond,secretChecks,recovery(value){assert(['valid','null','wrong-sha'].includes(value));recovery=value;}};
}
