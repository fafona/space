// Observe the close event of actual directly spawned ChildProcess objects.
// OS disappearance alone does not mean Node has reaped its process/stdio.
// No signal, close, unref, forced exit, caller PID or JSON-derived authority.
import {ChildProcess} from 'node:child_process';
const states=new WeakMap(),need=(value)=>{if(!value)throw Error('release_toolchain_owned_child_close_invalid');};
const roles=new Set(['web-baseline','web-primary','web-rollback','worker','controller','nginx']);
export function watchOwnedRehearsalChildClose(child,role){
 need(child instanceof ChildProcess&&roles.has(role)&&child.exitCode===null&&child.signalCode===null);
 const token=Object.freeze({}),state={child,role,closed:false,spawnError:false,code:null,signal:null};
 state.done=new Promise(resolve=>{child.once('error',()=>{state.spawnError=true;});child.once('close',(code,signal)=>{state.closed=true;state.code=code;state.signal=signal;resolve();});});
 states.set(token,state);return token;
}
function selected(tokens){need(Array.isArray(tokens)&&tokens.length>0&&new Set(tokens).size===tokens.length);return tokens.map(token=>{const state=states.get(token);need(state);return state;});}
export function ownedRehearsalChildCloseSnapshot(tokens){return selected(tokens).map(state=>({role:state.role,pid:Number.isSafeInteger(state.child.pid)?state.child.pid:null,closed:state.closed,spawnError:state.spawnError,code:state.code,signal:state.signal}));}
export async function waitOwnedRehearsalChildrenClosed(tokens,{timeoutMs=5000}={}){
 need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=5000);const values=selected(tokens);let timer;
 try{await Promise.race([Promise.all(values.map(state=>state.done)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('release_toolchain_owned_children_close_unconfirmed')),timeoutMs);})]);}
 finally{clearTimeout(timer);}
 const snapshot=ownedRehearsalChildCloseSnapshot(tokens);need(snapshot.every(value=>value.closed&&!value.spawnError&&Number.isSafeInteger(value.pid)&&value.pid>0));return snapshot;
}
export function assertOwnedRehearsalChildCloseProof(proof){
 need(proof?.kind==='owned-active-rehearsal-direct-children-closed'&&proof.publicationAuthority===false&&Array.isArray(proof.children)&&proof.children.length===roles.size);
 need(new Set(proof.children.map(value=>value.role)).size===roles.size&&new Set(proof.children.map(value=>value.pid)).size===roles.size);
 for(const value of proof.children)need(roles.has(value.role)&&Number.isSafeInteger(value.pid)&&value.pid>0&&value.closed===true&&value.spawnError===false&&
  ((Number.isInteger(value.code)&&value.code>=0&&value.signal===null)||(value.code===null&&/^SIG[A-Z0-9]+$/.test(value.signal??''))));
 const at=Date.parse(proof.at);need(Number.isFinite(at)&&new Date(at).toISOString()===proof.at);return true;
}
