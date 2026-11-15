// A Promise alone does not keep Node alive (e.g. a pooled unreferenced HTTP
// socket). Keep the supervised CLI alive until its whole awaited closure ends.
// There is no retry, signal, state write or new publication authority here.
export async function withApplicationCliLifetime(work){
 if(typeof work!=='function')throw Error('application_cli_lifetime_work');
 const reference=setInterval(()=>{},1000);
 try{return await work();}finally{clearInterval(reference);}
}
