import { getPref, setPref } from "../utils/prefs";
import { SummaryTask, SummaryTaskStatus } from "./summaryTaskTypes";

const HISTORY_FILE_NAME = "summary-history.json";
const DEFAULT_LIMIT = 100;

interface SummaryHistoryFile {
  version: number;
  tasks: SummaryTask[];
  selectedTaskId?: string;
}

function now() {
  return Date.now();
}

function getHistoryFilePath(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, HISTORY_FILE_NAME);
}

function normalizeTask(task: SummaryTask): SummaryTask {
  const rawStatus = String((task as any).status || "");
  let normalizedStatus = rawStatus;
  if (rawStatus === "interrupted") {
    normalizedStatus = "cancelled";
  }
  if (rawStatus === "running") {
    normalizedStatus = "cancelled";
  }

  const normalized: SummaryTask = {
    ...task,
    status: normalizedStatus as SummaryTask["status"],
    progress: typeof task.progress === "number" ? task.progress : undefined,
    stage: task.stage || "",
    content: task.content || "",
    error: task.error || undefined,
    updatedAt: task.updatedAt || now(),
    createdAt: task.createdAt || now(),
  };
  if (rawStatus === "running" || rawStatus === "interrupted") {
    normalized.error = normalized.error || "插件重启导致任务停止";
    normalized.stage = normalized.stage || "已停止";
    normalized.finishedAt = normalized.finishedAt || now();
    normalized.updatedAt = now();
  }
  return normalized;
}

function canPrune(status: SummaryTaskStatus): boolean {
  return status === "completed";
}

function getHistoryLimit(): number {
  const raw = Number(getPref("maxSummaryHistoryRecords" as any));
  if (!Number.isFinite(raw)) return DEFAULT_LIMIT;
  if (raw < 0) return DEFAULT_LIMIT;
  return raw;
}

export class SummaryHistoryStore {
  public static getLimit(): number {
    return getHistoryLimit();
  }

  public static setLimit(limit: number): void {
    const value = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : DEFAULT_LIMIT;
    setPref("maxSummaryHistoryRecords" as any, value as any);
  }

  public static async load(): Promise<SummaryHistoryFile> {
    const filePath = getHistoryFilePath();
    try {
      const exists = await IOUtils.exists(filePath);
      if (!exists) {
        return { version: 1, tasks: [] };
      }
      const bytes = await IOUtils.read(filePath);
      const text = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(text) as SummaryHistoryFile;
      const tasks = Array.isArray(parsed.tasks)
        ? parsed.tasks.map(normalizeTask).sort((a, b) => a.createdAt - b.createdAt)
        : [];
      return {
        version: 1,
        tasks,
        selectedTaskId: parsed.selectedTaskId,
      };
    } catch (error) {
      ztoolkit.log("[AiNote][SummaryHistoryStore] Failed to load history", error);
      return { version: 1, tasks: [] };
    }
  }

  public static async save(tasks: SummaryTask[], selectedTaskId?: string): Promise<void> {
    const limit = getHistoryLimit();
    const normalized = tasks.map(normalizeTask);
    const pruned = this.prune(normalized, limit);
    const data: SummaryHistoryFile = {
      version: 1,
      tasks: pruned,
      selectedTaskId,
    };
    const filePath = getHistoryFilePath();
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    try {
      await IOUtils.write(filePath, bytes);
    } catch (error) {
      ztoolkit.log("[AiNote][SummaryHistoryStore] Failed to save history", error);
    }
  }

  public static async clear(tasksToKeep: SummaryTask[] = [], selectedTaskId?: string): Promise<void> {
    await this.save(tasksToKeep, selectedTaskId);
  }

  public static prune(tasks: SummaryTask[], limit: number): SummaryTask[] {
    if (limit === 0) return tasks;
    if (tasks.length <= limit) return tasks;

    const removable = tasks
      .filter((task) => canPrune(task.status))
      .sort((a, b) => a.updatedAt - b.updatedAt);

    const keep = new Set(tasks.map((task) => task.id));
    let overflow = tasks.length - limit;
    for (const task of removable) {
      if (overflow <= 0) break;
      if (keep.has(task.id)) {
        keep.delete(task.id);
        overflow -= 1;
      }
    }

    return tasks.filter((task) => keep.has(task.id));
  }
}
