import {
  WebSummaryConversationMeta,
  WebSummaryItemChatLink,
} from "./webSummaryTypes";

export const WEB_AI_RELATION_PREFIX = "urn:ainote:web-ai-chat:";
export const WEB_AI_RELATION_PREDICATE: _ZoteroTypes.RelationsPredicate =
  "dc:relation";
const MAX_CONVERSATION_TITLE_LENGTH = 140;

export function buildConversationTitleFromItem(item: Zotero.Item): string {
  const author = sanitizeTitlePart(item.firstCreator || "UnknownAuthor");
  const year = sanitizeTitlePart(extractYear(item.getField("date")) || "UnknownYear");
  const title = sanitizeTitlePart(item.getField("title") || "Untitled");
  const raw = `${author}-${year}-${title}`;
  return raw.slice(0, MAX_CONVERSATION_TITLE_LENGTH) || "UnknownAuthor-UnknownYear-Untitled";
}

export function extractYear(dateText: string): string {
  const match = String(dateText || "").match(/\b(19|20)\d{2}\b/);
  return match?.[0] || "";
}

export function sanitizeTitlePart(value: string): string {
  return String(value || "")
    .replace(/[\\/:*?"<>|\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Unknown";
}

export function normalizeConversationUrl(value: string): string {
  let text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const markdownLinkMatch = text.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/i);
  if (markdownLinkMatch) {
    text = markdownLinkMatch[2].trim();
  }

  text = text.replace(/^<|>$/g, "").trim();
  text = text.replace(/^['"]|['"]$/g, "").trim();

  const directUrlMatch = text.match(/https?:\/\/\S+/i);
  if (!directUrlMatch) {
    return text;
  }

  let normalized = directUrlMatch[0].trim();
  normalized = normalized.replace(/[)\],.;]+$/g, "");
  return normalized;
}

export function encodeChatLinkToRelationValue(
  link: WebSummaryItemChatLink,
): string {
  const json = JSON.stringify(link);
  return `${WEB_AI_RELATION_PREFIX}${btoa(unescape(encodeURIComponent(json)))}`;
}

export function decodeChatLinkFromRelationValue(
  value: string,
): WebSummaryItemChatLink | null {
  if (!value.startsWith(WEB_AI_RELATION_PREFIX)) {
    return null;
  }

  try {
    const encoded = value.slice(WEB_AI_RELATION_PREFIX.length);
    const json = decodeURIComponent(escape(atob(encoded)));
    const parsed = JSON.parse(json) as WebSummaryItemChatLink;
    if (!parsed?.platform) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function mergeConversationMetaIntoChatLink(
  meta: WebSummaryConversationMeta,
): WebSummaryConversationMeta {
  return {
    conversationId: meta.conversationId,
    conversationUrl: normalizeConversationUrl(meta.conversationUrl || ""),
    conversationTitle: meta.conversationTitle,
    folderName: meta.folderName,
    folderResolved: meta.folderResolved,
    createdAt: meta.createdAt,
    lastUsedAt: meta.lastUsedAt,
  };
}
