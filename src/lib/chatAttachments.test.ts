import test from "node:test";
import assert from "node:assert/strict";
import {buildChatAttachmentText,CHAT_ATTACHMENT_MAX_BYTES,guestChatAttachmentPath,parseChatAttachmentText,safeChatAttachmentName,validateChatAttachment} from "./chatAttachments";
import {createGuestChatUploadGate,createGuestChatUploadLimiter} from "./guestChatUploadRateLimit.server";
const png=Uint8Array.of(137,80,78,71,13,10,26,10,0);
test("chat upload validates size, extensions, MIME and magic rather than trusting filenames",()=>{
 assert.deepEqual(validateChatAttachment("../photo.PNG","image/png",png),{mime:"image/png",extension:"png",name:"photo.PNG",image:true});
 assert.equal(validateChatAttachment("note.txt","",new TextEncoder().encode("Synthetic attachment" )).mime,"text/plain");
 for(const [name,type,bytes]of [["x.svg","image/svg+xml",png],["x.png","image/jpeg",png],["x.pdf","application/pdf",png],["x.exe","",png],["x.txt","text/plain",Uint8Array.of(255)],["x.txt","text/plain",new TextEncoder().encode("<script>alert(1)</script>")],["x.png","image/png",new Uint8Array()],["x.png","image/png",new Uint8Array(CHAT_ATTACHMENT_MAX_BYTES+1)]] as const)assert.throws(()=>validateChatAttachment(name,type,bytes),/chat_attachment_/);
});
test("attachment formatting preserves captions and restricts embedded assets to own upload paths",()=>{
 const path=`/storage/v1/object/public/page-assets/guest-chat/99990001/${"a".repeat(64)}/${"b".repeat(64)}.png`;
 assert.equal(guestChatAttachmentPath("https://old-assets.invalid"+path,"99990001"),path);
 for(const value of ["//evil.invalid"+path,path+"?redirect=x",path+"#x",path.replace("99990001","99990002"),"https://evil.invalid/image.png","javascript:alert(1)",path.replace("/public/","/public/../")])assert.equal(guestChatAttachmentPath(value,"99990001"),"");
 const text=buildChatAttachmentText("../../picture\n.png",path,true,"Caption 😀");
 assert.deepEqual(parseChatAttachmentText(text),{image:true,name:"picture .png",url:path,caption:"Caption 😀"});
 assert.equal(safeChatAttachmentName("C:\\fakepath\\photo.png"),"photo.png");
 assert.equal(parseChatAttachmentText("图片：x\njavascript:alert(1)"),null);
});
test("upload quotas are scoped to principal and client IP; expired limits recover without evicting live identities",()=>{
 const allow=createGuestChatUploadLimiter();
 for(let i=0;i<8;i++)assert.equal(allow("a","one",0),true);
 assert.equal(allow("a","two",0),false);
 for(let i=0;i<8;i++)assert.equal(allow("b","one",0),true);
 assert.equal(allow("c","one",0),false);
 assert.equal(allow("a","one",60000),true);
});
test("global upload gate bounds simultaneous multipart buffers and releases exactly once",()=>{
 const acquire=createGuestChatUploadGate(2),first=acquire()!,second=acquire()!;assert.equal(acquire(),null);
 first();first();const third=acquire()!;assert.equal(acquire(),null);second();third();assert.ok(acquire());
});
