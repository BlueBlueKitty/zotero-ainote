import { assert } from "chai";
import {
  buildConversationTitleFromItem,
  decodeChatLinkFromRelationValue,
  encodeChatLinkToRelationValue,
  extractYear,
} from "../src/modules/webSummaryConversation";
import { WebSummaryRelationStore } from "../src/modules/webSummaryRelations";

type FakeRelations = Record<string, string[]>;

class FakeItem {
  private fields: Record<string, string> = { extra: "" };
  private relations: FakeRelations = {};

  public getField(field: string): string {
    return this.fields[field] || "";
  }

  public setField(field: string, value: string): void {
    this.fields[field] = value;
  }

  public getRelationsByPredicate(predicate: string): string[] {
    return this.relations[predicate] || [];
  }

  public getRelations(): FakeRelations {
    return this.relations;
  }

  public setRelations(relations: FakeRelations): void {
    this.relations = relations;
  }

  public async saveTx(): Promise<void> {
    return;
  }
}

describe("webSummaryConversation", function () {
  it("should extract publication year from date text", function () {
    assert.equal(extractYear("2024-03-12"), "2024");
    assert.equal(extractYear("March 2023"), "2023");
    assert.equal(extractYear("n.d."), "");
  });

  it("should build a fallback-safe conversation title", function () {
    const item = {
      firstCreator: "Smith",
      getField(field: string) {
        if (field === "date") return "2024-01-01";
        if (field === "title") return "A Study on Web AI Summaries";
        return "";
      },
    } as unknown as Zotero.Item;

    assert.equal(
      buildConversationTitleFromItem(item),
      "Smith-2024-A Study on Web AI Summaries",
    );
  });

  it("should round-trip chat link relation values", function () {
    const value = encodeChatLinkToRelationValue({
      platform: "chatgpt",
      conversationId: "abc123",
      conversationUrl: "https://chatgpt.com/c/abc123",
      conversationTitle: "Smith-2024-Paper",
      folderName: "文献总结",
      createdAt: "2026-05-11T00:00:00.000Z",
      lastUsedAt: "2026-05-11T00:00:00.000Z",
    });

    const decoded = decodeChatLinkFromRelationValue(value);
    assert.isNotNull(decoded);
    assert.equal(decoded?.conversationId, "abc123");
    assert.equal(decoded?.platform, "chatgpt");
  });

  it("should pick freshest chatgpt link from dirty extra array", function () {
    const item = new FakeItem();
    item.setField(
      "extra",
      [
        "[AiNoteWebSummaryLinks]",
        JSON.stringify([
          {
            platform: "chatgpt",
            conversationId: "old",
            conversationUrl: "https://chatgpt.com/c/old",
            lastUsedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            platform: "chatgpt",
            conversationId: "new",
            conversationUrl: "https://chatgpt.com/c/new",
            lastUsedAt: "2026-02-01T00:00:00.000Z",
          },
        ]),
        "[/AiNoteWebSummaryLinks]",
      ].join("\n"),
    );

    const latest = WebSummaryRelationStore.getLatestLink(
      item as unknown as Zotero.Item,
      "chatgpt",
    );
    assert.equal(latest?.conversationId, "new");
  });

  it("should prefer a usable conversation URL over a newer empty link", function () {
    const item = new FakeItem();
    item.setField(
      "extra",
      [
        "[AiNoteWebSummaryLinks]",
        JSON.stringify([
          {
            platform: "chatgpt",
            conversationId: "missing-url",
            lastUsedAt: "2026-03-01T00:00:00.000Z",
          },
          {
            platform: "chatgpt",
            conversationId: "usable",
            conversationUrl: "https://chatgpt.com/c/usable",
            lastUsedAt: "2026-02-01T00:00:00.000Z",
          },
        ]),
        "[/AiNoteWebSummaryLinks]",
      ].join("\n"),
    );

    const latest = WebSummaryRelationStore.getLatestLink(
      item as unknown as Zotero.Item,
      "chatgpt",
    );
    assert.equal(latest?.conversationId, "usable");
  });

  it("saveLatestLink should keep one link per platform", async function () {
    const item = new FakeItem();
    item.setField(
      "extra",
      [
        "[AiNoteWebSummaryLinks]",
        JSON.stringify([
          {
            platform: "chatgpt",
            conversationId: "old",
            conversationUrl: "https://chatgpt.com/c/old",
            lastUsedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            platform: "other",
            conversationId: "x",
            conversationUrl: "https://example.com/x",
            lastUsedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
        "[/AiNoteWebSummaryLinks]",
      ].join("\n"),
    );

    await WebSummaryRelationStore.saveLatestLink(
      item as unknown as Zotero.Item,
      {
        platform: "chatgpt",
        conversationId: "new",
        conversationUrl: "https://chatgpt.com/c/new",
        lastUsedAt: "2026-03-01T00:00:00.000Z",
      },
    );

    const links = WebSummaryRelationStore.getLinks(item as unknown as Zotero.Item);
    assert.equal(links.filter((entry) => entry.platform === "chatgpt").length, 1);
    assert.equal(links.filter((entry) => entry.platform === "other").length, 1);
    assert.equal(
      WebSummaryRelationStore.getLatestLink(item as unknown as Zotero.Item, "chatgpt")
        ?.conversationId,
      "new",
    );
  });
});
