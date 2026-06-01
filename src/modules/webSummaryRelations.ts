import {
  decodeChatLinkFromRelationValue,
  WEB_AI_RELATION_PREDICATE,
  WEB_AI_RELATION_PREFIX,
} from "./webSummaryConversation";
import {
  WebSummaryItemChatLink,
  WebSummaryPlatform,
} from "./webSummaryTypes";

const EXTRA_BLOCK_START = "[AiNoteWebSummaryLinks]";
const EXTRA_BLOCK_END = "[/AiNoteWebSummaryLinks]";

export class WebSummaryRelationStore {
  private static compareLinkFreshness(
    a: WebSummaryItemChatLink,
    b: WebSummaryItemChatLink,
  ): number {
    const aHasUrl = !!String(a.conversationUrl || "").trim();
    const bHasUrl = !!String(b.conversationUrl || "").trim();
    if (aHasUrl !== bHasUrl) {
      return aHasUrl ? -1 : 1;
    }
    const aLast = String(a.lastUsedAt || "");
    const bLast = String(b.lastUsedAt || "");
    if (aLast !== bLast) {
      return bLast.localeCompare(aLast);
    }
    const aCreated = String(a.createdAt || "");
    const bCreated = String(b.createdAt || "");
    if (aCreated !== bCreated) {
      return bCreated.localeCompare(aCreated);
    }
    return 0;
  }

  private static normalizeLinks(
    links: WebSummaryItemChatLink[],
  ): WebSummaryItemChatLink[] {
    const grouped = new Map<string, WebSummaryItemChatLink[]>();
    for (const entry of links) {
      if (!entry?.platform) {
        continue;
      }
      const list = grouped.get(entry.platform) || [];
      list.push(entry);
      grouped.set(entry.platform, list);
    }

    const normalized: WebSummaryItemChatLink[] = [];
    for (const list of grouped.values()) {
      const best = list.slice().sort((a, b) => this.compareLinkFreshness(a, b))[0];
      if (best) {
        normalized.push(best);
      }
    }
    return normalized;
  }

  private static hasLegacyRelations(item: Zotero.Item): boolean {
    const values = item.getRelationsByPredicate(WEB_AI_RELATION_PREDICATE);
    return values.some((value) => String(value).startsWith(WEB_AI_RELATION_PREFIX));
  }

  private static readLinksFromExtra(item: Zotero.Item): WebSummaryItemChatLink[] {
    const extra = String(item.getField("extra") || "");
    const start = extra.indexOf(EXTRA_BLOCK_START);
    const end = extra.indexOf(EXTRA_BLOCK_END);
    if (start < 0 || end < 0 || end <= start) {
      return [];
    }
    const raw = extra
      .slice(start + EXTRA_BLOCK_START.length, end)
      .trim();
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.filter((entry) => entry && typeof entry.platform === "string");
    } catch {
      return [];
    }
  }

  private static writeLinksToExtra(
    item: Zotero.Item,
    links: WebSummaryItemChatLink[],
  ): void {
    const extra = String(item.getField("extra") || "");
    const block = `${EXTRA_BLOCK_START}\n${JSON.stringify(links)}\n${EXTRA_BLOCK_END}`;
    const start = extra.indexOf(EXTRA_BLOCK_START);
    const end = extra.indexOf(EXTRA_BLOCK_END);

    if (start >= 0 && end > start) {
      const before = extra.slice(0, start).trimEnd();
      const after = extra.slice(end + EXTRA_BLOCK_END.length).trimStart();
      const next = [before, block, after].filter(Boolean).join("\n\n").trim();
      item.setField("extra", next);
      return;
    }
    const next = [extra.trim(), block].filter(Boolean).join("\n\n");
    item.setField("extra", next);
  }

  private static readLinksFromLegacyRelations(
    item: Zotero.Item,
  ): WebSummaryItemChatLink[] {
    const values = item
      .getRelationsByPredicate(WEB_AI_RELATION_PREDICATE)
      .filter((value) => value.startsWith(WEB_AI_RELATION_PREFIX));
    return values
      .map((value) => decodeChatLinkFromRelationValue(value))
      .filter((value): value is WebSummaryItemChatLink => !!value);
  }

  private static removeLegacyRelations(item: Zotero.Item): void {
    const relations = (item.getRelations() || {}) as _ZoteroTypes.ObjectRelations;
    const rawValues = relations[WEB_AI_RELATION_PREDICATE];
    const values = Array.isArray(rawValues) ? rawValues : rawValues ? [rawValues] : [];
    const kept = values.filter((value) => !String(value).startsWith(WEB_AI_RELATION_PREFIX));
    if (kept.length) {
      relations[WEB_AI_RELATION_PREDICATE] = kept;
    } else {
      delete relations[WEB_AI_RELATION_PREDICATE];
    }
    item.setRelations(relations);
  }

  public static getLinks(item: Zotero.Item): WebSummaryItemChatLink[] {
    const extraLinks = this.readLinksFromExtra(item);
    if (extraLinks.length) {
      return this.normalizeLinks(extraLinks);
    }
    return this.normalizeLinks(this.readLinksFromLegacyRelations(item));
  }

  public static getLatestLink(
    item: Zotero.Item,
    platform: WebSummaryPlatform,
  ): WebSummaryItemChatLink | null {
    const links = this.getLinks(item).filter((link) => link.platform === platform);
    if (!links.length) {
      return null;
    }
    return links.sort((a, b) => this.compareLinkFreshness(a, b))[0];
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
    const existing = this.normalizeLinks(this.getLinks(item)).filter(
      (entry) => entry.platform !== link.platform,
    );
    const next = this.normalizeLinks([...existing, link]);
    this.writeLinksToExtra(item, next);
    this.removeLegacyRelations(item);
    await item.saveTx();
  }

  public static async migrateLegacyRelations(): Promise<number> {
    let migrated = 0;
    let itemIDs: number[] = [];
    try {
      const rows = (await Zotero.DB.queryAsync(
        `SELECT DISTINCT ir.itemID AS itemID
         FROM itemRelations ir
         JOIN relationPredicates rp ON rp.predicateID = ir.predicateID
         WHERE rp.predicate = ? AND ir.object LIKE ?`,
        [WEB_AI_RELATION_PREDICATE, `${WEB_AI_RELATION_PREFIX}%`],
      )) as Array<{ itemID: number }> | null;
      itemIDs = (rows || [])
        .map((row) => Number(row.itemID))
        .filter((id) => Number.isFinite(id) && id > 0);
    } catch (error) {
      ztoolkit.log("[AiNote][WebSummaryRelations] Legacy relation query failed", error);
      return 0;
    }

    if (!itemIDs.length) {
      return 0;
    }

    for (const itemID of itemIDs) {
      try {
        const item = await Zotero.Items.getAsync(itemID);
        if (!item || !this.hasLegacyRelations(item)) {
          continue;
        }
        const extraLinks = this.readLinksFromExtra(item);
        const legacyLinks = this.readLinksFromLegacyRelations(item);
        const normalized = this.normalizeLinks([...extraLinks, ...legacyLinks]);
        this.writeLinksToExtra(item, normalized);
        this.removeLegacyRelations(item);
        await item.saveTx();
        migrated += 1;
      } catch (error) {
        ztoolkit.log("[AiNote][WebSummaryRelations] Failed to migrate legacy relation", {
          itemID,
          error,
        });
      }
    }

    if (migrated > 0) {
      ztoolkit.log("[AiNote][WebSummaryRelations] Legacy relation migration completed", {
        migratedItems: migrated,
      });
    }
    return migrated;
  }
}
