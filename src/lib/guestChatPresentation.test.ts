import test from "node:test";
import assert from "node:assert/strict";
import { LANGUAGE_OPTIONS } from "./i18n";
import { guestChatLabel, localizedGuestChatName } from "./guestChatPresentation";
test("every supported locale has a concise native guest label without translating the number", () => {
  for (const {code} of LANGUAGE_OPTIONS) {
    const label=guestChatLabel(code),name=localizedGuestChatName("83676658",code);
    assert.ok(label.length>0&&label.length<=12,code);assert.ok(name.endsWith("83676658"));
    assert.equal(name.match(/83676658/g)?.length,1);
    if(!code.startsWith("zh"))assert.doesNotMatch(name,/游客|访客|訪客/);
  }
  assert.equal(localizedGuestChatName("83676658","es-ES"),"Invitado 83676658");
  assert.equal(localizedGuestChatName("83676658","en-GB"),"Guest 83676658");
  assert.equal(localizedGuestChatName("83676658","zh-CN"),"访客83676658");
  assert.equal(guestChatLabel("zh-Hant-HK"),"訪客");assert.equal(guestChatLabel("unsupported"),"Guest");
  assert.equal(localizedGuestChatName("<script>","en-GB"),"Guest");
});
