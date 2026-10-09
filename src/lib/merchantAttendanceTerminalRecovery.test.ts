import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import jsQR from "jsqr";
import {terminalRecoveryUrlFromOrigin,parseTerminalRecoveryUrl,createTerminalRecoveryQr} from "./merchantAttendanceTerminalRecovery";

test("terminal recovery accepts only an explicit secure configured origin and appends a credential-free portal path",()=>{
  for (const origin of ["https://www.faolla.com","https://launch.faolla.com","https://configured.example:8443"])
    assert.equal(terminalRecoveryUrlFromOrigin(origin+"/"),origin+"/enterprise");
  for (const input of [null,undefined,{},"", "http://www.faolla.com","//www.faolla.com","javascript:alert(1)","https://user:secret@www.faolla.com","https://www.faolla.com/?pin=12345678","https://www.faolla.com/#token","https://www.faolla.com/enterprise","https://www.faolla.com/ "," https://www.faolla.com","https://www.faolla.com\\evil"])assert.equal(terminalRecoveryUrlFromOrigin(input),null);
});
test("handoff parser refuses extra identity, operation, credentials, redirect parameters and paths",async()=>{
  const good="https://www.faolla.com/enterprise";assert.equal(parseTerminalRecoveryUrl(good),good);
  for(const input of [good+"/",good+"?siteId=99990001",good+"?returnTo=https://evil.invalid",good+"#secret",good+"/99990001",good+"%3Fpin=12345678","https://user:pass@www.faolla.com/enterprise","http://www.faolla.com/enterprise",null,{},"x".repeat(600)]){
    assert.equal(parseTerminalRecoveryUrl(input),null);await assert.rejects(createTerminalRecoveryQr(input),/attendance_recovery_link_unavailable/);
  }
});
test("locally rendered phone QR decodes exactly to login, never a punch or credentials",async()=>{
  const url=terminalRecoveryUrlFromOrigin("https://www.faolla.com")!,dataUrl=await createTerminalRecoveryQr(url);
  assert(dataUrl.startsWith("data:image/png;base64,"));const buffer=Buffer.from(dataUrl.split(",")[1],"base64");
  const {data,info}=await sharp(buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,240);assert.equal(info.height,240);assert.equal(jsQR(new Uint8ClampedArray(data),info.width,info.height)?.data,url);
});
