export type SupportConversationScrollMessage = {
  key: string;
  createdAt: string;
  isSelf: boolean;
};

export function findFirstNewIncomingSupportMessageKey(
  messages: readonly SupportConversationScrollMessage[],
  previousMessageKeys: readonly string[],
) {
  if (previousMessageKeys.length === 0) {
    return messages.find((message) => !message.isSelf)?.key ?? "";
  }

  const previousKeys = new Set(previousMessageKeys);
  let lastKnownMessageIndex = -1;
  messages.forEach((message, index) => {
    if (previousKeys.has(message.key)) {
      lastKnownMessageIndex = index;
    }
  });
  if (lastKnownMessageIndex < 0) return "";

  for (let index = lastKnownMessageIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message.isSelf && !previousKeys.has(message.key)) {
      return message.key;
    }
  }
  return "";
}
