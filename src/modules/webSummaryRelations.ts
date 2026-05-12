import {
  decodeChatLinkFromRelationValue,
  encodeChatLinkToRelationValue,
  WEB_AI_RELATION_PREDICATE,
  WEB_AI_RELATION_PREFIX,
} from "./webSummaryConversation";
import {
  WebSummaryItemChatLink,
  WebSummaryPlatform,
} from "./webSummaryTypes";

/**
 * 基于 Zotero item relation 保存网页 AI 会话映射。
 * Zotero relation 的 predicate 类型比较固定，因此使用 dc:relation + 私有 urn 前缀承载插件数据。
 */
export class WebSummaryRelationStore {
  public static getLinks(item: Zotero.Item): WebSummaryItemChatLink[] {
    const values = item
      .getRelationsByPredicate(WEB_AI_RELATION_PREDICATE)
      .filter((value) => value.startsWith(WEB_AI_RELATION_PREFIX));

    return values
      .map((value) => decodeChatLinkFromRelationValue(value))
      .filter((value): value is WebSummaryItemChatLink => !!value);
  }

  public static getLatestLink(
    item: Zotero.Item,
    platform: WebSummaryPlatform,
  ): WebSummaryItemChatLink | null {
    const links = this.getLinks(item).filter((link) => link.platform === platform);
    if (!links.length) {
      return null;
    }
    return links.sort((a, b) =>
      String(b.lastUsedAt || b.createdAt || "").localeCompare(
        String(a.lastUsedAt || a.createdAt || ""),
      ),
    )[0];
  }

  public static hasPlatformLink(
    item: Zotero.Item,
    platform: WebSummaryPlatform,
  ): boolean {
    return !!this.getLatestLink(item, platform);
  }

  public static async saveLatestLink(
    item: Zotero.Item,
    link: WebSummaryItemChatLink,
  ): Promise<void> {
    const existing = this.getLinks(item).filter(
      (entry) => entry.platform !== link.platform,
    );
    const next = [...existing, link].map(encodeChatLinkToRelationValue);
    const relations = {
      ...(item.getRelations() as _ZoteroTypes.ObjectRelations),
      [WEB_AI_RELATION_PREDICATE]: next,
    } as _ZoteroTypes.ObjectRelations;
    item.setRelations(relations);
    await item.saveTx();
  }
}
