import {handlePinVerify} from "./route-handler";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const POST=(request:Request)=>handlePinVerify(request);
