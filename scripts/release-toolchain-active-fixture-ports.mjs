// Owned disposable fixtures only. Keep all four sockets bound simultaneously
// until the complete set is known; a released ephemeral port can be reused by
// the next listen(0). This grants no publication or formal-host authority.
import net from 'node:net';
const ROLES=Object.freeze(['baseline','primary','rollback','ingress']);
export async function allocateOwnedActiveFixturePorts(createServer=()=>net.createServer()){
 const owned=[],ports={};let failure;
 try{
  for(const role of ROLES){
   const server=createServer();owned.push(server);
   await new Promise((resolve,reject)=>{
    const failed=error=>{server.removeListener('listening',ready);reject(error);},ready=()=>{server.removeListener('error',failed);resolve();};
    server.once('error',failed);server.once('listening',ready);
    try{server.listen(0,'127.0.0.1');}catch(error){server.removeListener('error',failed);server.removeListener('listening',ready);reject(error);}
   });
   const address=server.address();if(!address||typeof address==='string'||address.address!=='127.0.0.1'||!Number.isSafeInteger(address.port)||address.port<1||address.port>65535)throw Error('owned_active_fixture_port_unconfirmed');
   ports[role]=address.port;
  }
  if(new Set(Object.values(ports)).size!==ROLES.length)throw Error('owned_active_fixture_ports_not_distinct');
 }catch(error){failure=error;}
 const closed=await Promise.allSettled(owned.map(server=>server.listening?new Promise((resolve,reject)=>{try{server.close(error=>error?reject(error):resolve());}catch(error){reject(error);}}):Promise.resolve()));
 const errors=closed.filter(value=>value.status==='rejected').map(value=>value.reason);
 if(errors.length)throw new AggregateError([...(failure?[failure]:[]),...errors],'owned_active_fixture_port_cleanup_unconfirmed');
 if(failure)throw failure;return ports;
}
