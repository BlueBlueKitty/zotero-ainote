import { SummaryTask } from "./summaryTaskTypes";
import { NoteSchemaExtractor } from "./noteSchemaExtractor";
import { WebSummaryRelationStore } from "./webSummaryRelations";

const EXTRA_BLOCK_START = "[AiNoteSummaryHistory]";
const EXTRA_BLOCK_END = "[/AiNoteSummaryHistory]";
const HISTORY_VERSION = 1;
const PER_ITEM_HISTORY_LIMIT = 20;

export interface AiNoteHistoryEntry {
  taskId: string;
  version: number;
  completedAt: number;
  kind?: "api" | "web";
  model?: string;
  templateId?: string;
  titleSnapshot: string;
  noteId?: number;
  noteKey?: string;
  webConversationId?: string;
  webConversationUrl?: string;
  webConversationTitle?: string;
  contentHash: string;
  source: "ainote";
}

export interface HistoryRecord {
  task: SummaryTask;
  searchText: string;
  warnings: string[];
  features: string[];
}

function trimText(value: unknown): string {
  return String(value || "").trim();
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function readEntriesFromExtra(item: Zotero.Item): AiNoteHistoryEntry[] {
  const extra = String(item.getField("extra") || "");
  const start = extra.indexOf(EXTRA_BLOCK_START);
  const end = extra.indexOf(EXTRA_BLOCK_END);
  if (start < 0 || end < 0 || end <= start) return [];
  const raw = extra.slice(start + EXTRA_BLOCK_START.length, end).trim();
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((entry) => entry && typeof entry.taskId === "string")
      .map((entry) => ({
        taskId: trimText(entry.taskId),
        version: Number(entry.version) || HISTORY_VERSION,
        completedAt: Number(entry.completedAt) || 0,
        kind: trimText(entry.kind) === "web" ? "web" : "api",
        model: trimText(entry.model) || undefined,
        templateId: trimText(entry.templateId) || undefined,
        titleSnapshot: trimText(entry.titleSnapshot) || "Untitled",
        noteId: Number.isFinite(Number(entry.noteId)) ? Number(entry.noteId) : undefined,
        noteKey: trimText(entry.noteKey) || undefined,
        webConversationId: trimText(entry.webConversationId) || undefined,
        webConversationUrl: trimText(entry.webConversationUrl) || undefined,
        webConversationTitle: trimText(entry.webConversationTitle) || undefined,
        contentHash: trimText(entry.contentHash),
        source: "ainote" as const,
      }));
  } catch {
    return [];
  }
}

function writeEntriesToExtra(item: Zotero.Item, entries: AiNoteHistoryEntry[]): void {
  const extra = String(item.getField("extra") || "");
  const block = `${EXTRA_BLOCK_START}\n${JSON.stringify(entries)}\n${EXTRA_BLOCK_END}`;
  const start = extra.indexOf(EXTRA_BLOCK_START);
  const end = extra.indexOf(EXTRA_BLOCK_END);
  if (start >= 0 && end > start) {
    const before = extra.slice(0, start).trimEnd();
    const after = extra.slice(end + EXTRA_BLOCK_END.length).trimStart();
    const next = [before, block, after].filter(Boolean).join("\n\n").trim();
    item.setField("extra", next);
    return;
  }
  item.setField("extra", [extra.trim(), block].filter(Boolean).join("\n\n"));
}

export class HistorySyncStore {
  private static readonly contentCache = new Map<
    string,
    {
      contentHash: string;
      record: HistoryRecord;
    }
  >();

  public static async recordCompleted(task: SummaryTask): Promise<void> {
    if (!task.itemID || !task.noteID || task.status !== "completed") return;
    const item = Zotero.Items.get(task.itemID);
    const note = Zotero.Items.get(task.noteID);
    if (!item || !note) return;
    const noteHTML = String(note.getNote?.() || note.note || "");
    const extracted = NoteSchemaExtractor.extract(noteHTML);
    const contentHash = hashText(extracted.displayContent || noteHTML);
    const entry: AiNoteHistoryEntry = {
      taskId: task.id,
      version: HISTORY_VERSION,
      completedAt: task.finishedAt || task.updatedAt || Date.now(),
      kind: task.kind,
      model: task.model,
      templateId: String(task.templateId || "").trim() || undefined,
      titleSnapshot: task.title || "Untitled",
      noteId: note.id,
      noteKey: note.key,
      webConversationId: task.webConversationId,
      webConversationUrl: task.webConversationUrl,
      webConversationTitle: task.webConversationTitle,
      contentHash,
      source: "ainote",
    };
    const previous = readEntriesFromExtra(item).filter((x) => x.taskId !== task.id);
    const next = [entry, ...previous]
      .sort((a, b) => b.completedAt - a.completedAt || a.taskId.localeCompare(b.taskId))
      .slice(0, PER_ITEM_HISTORY_LIMIT);
    writeEntriesToExtra(item, next);
    await item.saveTx();
    this.contentCache.set(task.id, {
      contentHash,
      record: {
        task: {
          ...task,
          content: extracted.displayContent || task.content || "",
        },
        searchText: extracted.searchText,
        warnings: extracted.warnings,
        features: extracted.features,
      },
    });
  }

  public static async importFromLegacyCompletedTasks(
    tasks: SummaryTask[],
  ): Promise<number> {
    const completed = tasks.filter(
      (task) => task.status === "completed" && task.itemID && task.noteID,
    );
    if (!completed.length) return 0;
    let imported = 0;
    for (const task of completed) {
      try {
        await this.recordCompleted(task);
        imported += 1;
      } catch (error) {
        ztoolkit.log("[AiNote][HistorySyncStore] import legacy task failed", {
          taskId: task.id,
          error,
        });
      }
    }
    return imported;
  }

  public static async queryAll(): Promise<HistoryRecord[]> {
    const search = new Zotero.Search();
    try {
      search.addCondition("libraryID", "is", String(Zotero.Libraries.userLibraryID));
    } catch {
      // fallback for environments without libraryID condition support
    }
    search.addCondition("itemType", "isNot", "note");
    const ids = await search.search();
    const records: HistoryRecord[] = [];
    for (const id of ids) {
      const item = Zotero.Items.get(id);
      if (!item) continue;
      const entries = readEntriesFromExtra(item);
      for (const entry of entries) {
        const record = await this.resolveEntry(item, entry);
        if (record) records.push(record);
      }
    }
    records.sort(
      (a, b) =>
        (b.task.finishedAt || b.task.updatedAt || 0) -
          (a.task.finishedAt || a.task.updatedAt || 0) ||
        a.task.id.localeCompare(b.task.id),
    );
    return records;
  }

  public static async resolveContent(taskId: string): Promise<HistoryRecord | null> {
    const search = new Zotero.Search();
    try {
      search.addCondition("libraryID", "is", String(Zotero.Libraries.userLibraryID));
    } catch {
      // fallback
    }
    search.addCondition("itemType", "isNot", "note");
    const ids = await search.search();
    for (const id of ids) {
      const item = Zotero.Items.get(id);
      if (!item) continue;
      const entries = readEntriesFromExtra(item);
      const entry = entries.find((x) => x.taskId === taskId);
      if (!entry) continue;
      return this.resolveEntry(item, entry, true);
    }
    return null;
  }

  private static async resolveEntry(
    item: Zotero.Item,
    entry: AiNoteHistoryEntry,
    forceRefresh = false,
  ): Promise<HistoryRecord | null> {
    try {
      let note: Zotero.Item | undefined;
      if (entry.noteId) {
        note = Zotero.Items.get(entry.noteId);
      }
      if (!note && entry.noteKey) {
        const found = await Zotero.Items.getByLibraryAndKeyAsync(item.libraryID, entry.noteKey);
        if (found && found.isNote?.()) {
          note = found as Zotero.Item;
        }
      }
      if (!note) {
        const guessedKind =
          entry.kind || (String(entry.model || "").includes("ChatGPT Web") ? "web" : "api");
        const fallbackLink =
          guessedKind === "web"
            ? WebSummaryRelationStore.getLatestLink(item, "chatgpt")
            : null;
        return {
          task: {
            id: entry.taskId,
            kind: guessedKind,
            itemID: item.id,
            itemKey: item.key,
            title: entry.titleSnapshot || String(item.getField("title") || "Untitled"),
            status: "completed",
            content: "",
            createdAt: entry.completedAt,
            updatedAt: entry.completedAt,
            finishedAt: entry.completedAt,
            model: entry.model,
            templateId: entry.templateId,
            noteID: entry.noteId,
            webConversationId:
              entry.webConversationId || fallbackLink?.conversationId,
            webConversationUrl:
              entry.webConversationUrl || fallbackLink?.conversationUrl,
            webConversationTitle:
              entry.webConversationTitle || fallbackLink?.conversationTitle,
          },
          searchText: "",
          warnings: ["note-missing"],
          features: [],
        };
      }
      const cache = this.contentCache.get(entry.taskId);
      if (!forceRefresh && cache && cache.contentHash === entry.contentHash) {
        return cache.record;
      }
      const noteHTML = String(note.getNote?.() || note.note || "");
      const extracted = NoteSchemaExtractor.extract(noteHTML);
      const guessedKind =
        entry.kind || (String(entry.model || "").includes("ChatGPT Web") ? "web" : "api");
      const fallbackLink =
        guessedKind === "web"
          ? WebSummaryRelationStore.getLatestLink(item, "chatgpt")
          : null;
      const task: SummaryTask = {
        id: entry.taskId,
        kind: guessedKind,
        itemID: item.id,
        itemKey: item.key,
        title: entry.titleSnapshot || String(item.getField("title") || "Untitled"),
        status: "completed",
        content: extracted.displayContent,
        createdAt: entry.completedAt,
        updatedAt: entry.completedAt,
        finishedAt: entry.completedAt,
        model: entry.model,
        templateId: entry.templateId,
        noteID: note.id,
        webConversationId: entry.webConversationId || fallbackLink?.conversationId,
        webConversationUrl: entry.webConversationUrl || fallbackLink?.conversationUrl,
        webConversationTitle: entry.webConversationTitle || fallbackLink?.conversationTitle,
      };
      const record: HistoryRecord = {
        task,
        searchText: extracted.searchText,
        warnings: extracted.warnings,
        features: extracted.features,
      };
      const liveContentHash = hashText(extracted.displayContent || noteHTML);
      this.contentCache.set(entry.taskId, {
        contentHash: liveContentHash,
        record,
      });
      return record;
    } catch {
      return null;
    }
  }

  public static async clearAll(): Promise<number> {
    const search = new Zotero.Search();
    try {
      search.addCondition("libraryID", "is", String(Zotero.Libraries.userLibraryID));
    } catch {
      // fallback for environments without libraryID condition support
    }
    search.addCondition("itemType", "isNot", "note");
    const ids = await search.search();
    let changed = 0;
    for (const id of ids) {
      const item = Zotero.Items.get(id);
      if (!item) continue;
      const extra = String(item.getField("extra") || "");
      const start = extra.indexOf(EXTRA_BLOCK_START);
      const end = extra.indexOf(EXTRA_BLOCK_END);
      if (start < 0 || end <= start) continue;
      const before = extra.slice(0, start).trimEnd();
      const after = extra.slice(end + EXTRA_BLOCK_END.length).trimStart();
      const next = [before, after].filter(Boolean).join("\n\n").trim();
      item.setField("extra", next);
      await item.saveTx();
      changed += 1;
    }
    this.contentCache.clear();
    return changed;
  }

  public static async removeTask(taskId: string): Promise<boolean> {
    const search = new Zotero.Search();
    try {
      search.addCondition("libraryID", "is", String(Zotero.Libraries.userLibraryID));
    } catch {
      // fallback
    }
    search.addCondition("itemType", "isNot", "note");
    const ids = await search.search();
    for (const id of ids) {
      const item = Zotero.Items.get(id);
      if (!item) continue;
      const entries = readEntriesFromExtra(item);
      if (!entries.length) continue;
      const next = entries.filter((entry) => entry.taskId !== taskId);
      if (next.length === entries.length) continue;
      writeEntriesToExtra(item, next);
      await item.saveTx();
      this.contentCache.delete(taskId);
      return true;
    }
    this.contentCache.delete(taskId);
    return false;
  }
}
