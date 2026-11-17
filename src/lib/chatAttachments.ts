export const CHAT_ATTACHMENT_MAX_BYTES=8*1024*1024;
export const CHAT_ATTACHMENT_ACCEPT="image/jpeg,image/png,image/webp,image/gif,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx";
export function safeChatAttachmentName(value:string) {return value.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,120)||"file";}
const types:Readonly<Record<string,string>>={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif",pdf:"application/pdf",txt:"text/plain",csv:"text/csv",zip:"application/zip",doc:"application/msword",xls:"application/vnd.ms-excel",ppt:"application/vnd.ms-powerpoint",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation"};
export function validateChatAttachment(name:string,claimedType:string,bytes:Uint8Array) {
  if(!bytes.length||bytes.length>CHAT_ATTACHMENT_MAX_BYTES)throw new Error("chat_attachment_size");
  const extension=safeChatAttachmentName(name).split(".").at(-1)?.toLowerCase()??"",mime=types[extension];
  if(!mime||claimedType&&!['application/octet-stream',mime].includes(claimedType.toLowerCase())&&!(extension==="zip"&&claimedType==="application/x-zip-compressed"))throw new Error("chat_attachment_type");
  const starts=(...prefix:number[])=>prefix.every((value,index)=>bytes[index]===value),ascii=(start:number,length:number)=>String.fromCharCode(...bytes.subarray(start,start+length));
  const valid=mime==="image/jpeg"?starts(255,216,255):mime==="image/png"?starts(137,80,78,71,13,10,26,10):mime==="image/webp"?ascii(0,4)==="RIFF"&&ascii(8,4)==="WEBP":mime==="image/gif"?/^GIF8[79]a$/.test(ascii(0,6)):extension==="pdf"?ascii(0,5)==="%PDF-":['zip','docx','xlsx','pptx'].includes(extension)?starts(80,75,3,4)||starts(80,75,5,6)||starts(80,75,7,8):['doc','xls','ppt'].includes(extension)?starts(208,207,17,224,161,177,26,225):true;
  if(!valid)throw new Error("chat_attachment_type");
  if(extension==="txt"||extension==="csv") {let text;try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{throw new Error("chat_attachment_type");}if(text.includes("\0")||/<\s*(?:!doctype|html|script|svg|iframe)\b/i.test(text.slice(0,4096)))throw new Error("chat_attachment_type");}
  return{mime,extension:extension==="jpeg"?"jpg":extension,name:safeChatAttachmentName(name),image:mime.startsWith("image/")};
}
export function buildChatAttachmentText(name:string,url:string,image:boolean,caption="") {return [`${image?"图片":"文件"}：${safeChatAttachmentName(name)}\n${url}`,caption.trim()].filter(Boolean).join("\n\n");}
export function parseChatAttachmentText(text:string) {
  const match=text.match(/^(图片|文件)[:：]([^\n]+)\n(https:\/\/[^\s]+|\/(?!\/)[^\s]+)(?:\n\n([\s\S]*))?$/);
  if(!match)return null;
  return{image:match[1]==="图片",name:match[2].trim(),url:match[3],caption:match[4]??""};
}
// Only our content-addressed guest upload namespace may be embedded as media.
// Return a root-relative path, never an arbitrary sender-supplied image host.
export function guestChatAttachmentPath(value:string,siteId?:string) {
  if(value.includes("\\")||!/^https:\/\//i.test(value)&&!/^\/(?!\/)/.test(value))return "";
  let url:URL;try{url=new URL(value,"https://attachment.invalid");}catch{return "";}
  if(url.username||url.password||url.search||url.hash)return "";
  const match=url.pathname.match(/^\/storage\/v1\/object\/public\/(?:page-assets|assets|uploads|public)\/guest-chat\/(\d{8})\/[a-f0-9]{64}\/[a-f0-9]{64}\.(?:jpg|png|webp|gif|pdf|txt|csv|zip|docx?|xlsx?|pptx?)$/);
  return match&&(!siteId||match[1]===siteId)?url.pathname:"";
}
