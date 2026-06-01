import { getPref } from "../utils/prefs";
import { parseProfiles } from "./llmProfiles";
import { SummaryHistoryStore } from "./summaryHistoryStore";
import {
  SummaryTask,
  SummaryTaskRuntime,
  SummaryTaskSnapshot,
  isTerminalStatus,
} from "./summaryTaskTypes";
import { isActiveTask, isHistoryTask } from "./summaryTaskPartition";
import { SummaryRunner } from "./summaryRunner";
import { getString } from "../utils/locale";
import { HistorySyncStore } from "./historySyncStore";

export interface EnqueueTarget {
  item: Zotero.Item;
  preferredPdfAttachment?: Zotero.Item;
  templateId?: string;
}

type Listener = (snapshot: SummaryTaskSnapshot) => void;

function now() {
  return Date.now();
}

function makeTaskId() {
  return crypto.randomUUID();
}

function getActiveProfile() {
  const profiles = parseProfiles(getPref("profiles" as any));
  const activeId = String(getPref("activeProfileId" as any) || "").trim();
  return profiles.find((profile) => profile.id === activeId) || profiles[0] || null;
}

export class SummaryTaskManager {
  private static _instance: SummaryTaskManager | null = null;

  public static getInstance(): SummaryTaskManager {
    if (!this._instance) {
      this._instance = new SummaryTaskManager();
    }
    return this._instance;
  }

  private tasks: SummaryTask[] = [];
  private runtimes = new Map<string, SummaryTaskRuntime>();
  private selectedTaskId: string | undefined;
  private listeners = new Set<Listener>();
  private runningTaskId: string | undefined;
  private loaded = false;
  private stopRequested = false;

  public async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const history = await SummaryHistoryStore.load();
    try {
      await HistorySyncStore.importFromLegacyCompletedTasks(
        history.tasks.filter((task) => task.status === "completed"),
      );
    } catch (error) {
      ztoolkit.log("[AiNote][SummaryTaskManager] legacy history import failed", error);
    }
    this.tasks = history.tasks.filter((task) => task.status !== "completed");
    this.selectedTaskId = history.selectedTaskId || this.tasks.at(-1)?.id;
    this.loaded = true;
    this.emit();
    await this.persist();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  public getSnapshot(): SummaryTaskSnapshot {
    return {
      tasks: this.tasks.filter((task) => task.status !== "completed"),
      selectedTaskId: this.selectedTaskId,
    };
  }

  public getTaskById(taskId?: string): SummaryTask | undefined {
    if (!taskId) return undefined;
    return this.tasks.find((task) => task.id === taskId);
  }

  public setSelected(taskId?: string): void {
    this.selectedTaskId = taskId;
    this.emit();
    void this.persist();
  }

  public enqueue(targets: EnqueueTarget[]): { created: SummaryTask[]; focused?: SummaryTask } {
    const activeProfile = getActiveProfile();
    if (!activeProfile || !activeProfile.enabled) {
      throw new Error("请先在设置中创建并激活模型配置");
    }
    if (activeProfile.providerType !== "chatgpt_web" && !activeProfile.apiKey) {
      throw new Error("请先配置有效的 API Key");
    }

    const created: SummaryTask[] = [];
    let focused: SummaryTask | undefined;

    for (const target of targets) {
      const dedup = this.tasks.find(
        (task) =>
          task.itemID === target.item.id &&
          (task.status === "pending" || task.status === "running"),
      );
      if (dedup) {
        focused = dedup;
        continue;
      }

      const itemTitle = String(target.item.getField("title") || "Untitled");
      const kind = activeProfile.providerType === "chatgpt_web" ? "web" : "api";
      const task: SummaryTask = {
        id: makeTaskId(),
        kind,
        itemID: target.item.id,
        itemKey: target.item.key,
        title: itemTitle,
        status: "pending",
        progress: 0,
        stage: getString("summary-manager-status-pending" as any),
        content: "",
        createdAt: now(),
        updatedAt: now(),
        model: activeProfile.model,
        promptVersion: String(getPref("promptTemplatesVersion" as any) || ""),
        templateId: target.templateId,
        preferredPdfAttachmentID: target.preferredPdfAttachment?.id,
      };
      this.tasks.push(task);
      created.push(task);
      focused = task;
    }

    if (focused) {
      this.selectedTaskId = focused.id;
    }

    this.stopRequested = false;
    this.emit();
    void this.persist();
    void this.schedule();
    return { created, focused };
  }

  public stopTask(taskId: string): boolean {
    const task = this.getTaskById(taskId);
    if (!task || task.status !== "running") return false;
    const runtime = this.runtimes.get(taskId);
    runtime?.cancel?.();
    return true;
  }

  public retryTask(taskId: string): SummaryTask | null {
    const task = this.getTaskById(taskId);
    if (!task) return null;

    if (
      task.status !== "running" &&
      task.status !== "pending" &&
      !isTerminalStatus(task.status)
    ) {
      return null;
    }

    const activeProfile = getActiveProfile();
    if (!activeProfile || !activeProfile.enabled) {
      throw new Error("请先在设置中创建并激活模型配置");
    }
    if (activeProfile.providerType !== "chatgpt_web" && !activeProfile.apiKey) {
      throw new Error("请先配置有效的 API Key");
    }

    if (task.status === "running") {
      const runtime = this.runtimes.get(task.id);
      runtime?.cancel?.();
      if (this.runningTaskId === task.id) {
        this.runningTaskId = undefined;
      }
    }

    const resetAt = now();
    task.status = "pending";
    task.progress = 0;
    task.stage = getString("summary-manager-status-pending" as any);
    task.content = "";
    task.error = undefined;
    task.updatedAt = resetAt;
    task.startedAt = undefined;
    task.finishedAt = undefined;
    task.attempt = (task.attempt || 0) + 1;
    task.kind = activeProfile.providerType === "chatgpt_web" ? "web" : "api";
    task.model = activeProfile.model;
    task.templateId =
      String(getPref("activePromptTemplateId" as any) || "").trim() || undefined;
    task.promptVersion = String(getPref("promptTemplatesVersion" as any) || "");
    this.stopRequested = false;
    this.selectedTaskId = task.id;
    this.emit();
    void this.persist();
    void this.schedule();
    return task;
  }

  public removeTask(taskId: string): boolean {
    const task = this.getTaskById(taskId);
    if (!task) return false;

    if (task.status === "running") {
      const runtime = this.runtimes.get(task.id);
      runtime?.cancel?.();
    }

    this.tasks = this.tasks.filter((entry) => entry.id !== taskId);
    if (this.selectedTaskId === taskId) {
      this.selectedTaskId = this.tasks.at(-1)?.id;
    }
    this.emit();
    void this.persist();
    return true;
  }

  public stopActiveTasks(): void {
    this.stopRequested = true;
    const nowAt = now();

    if (this.runningTaskId) {
      const runtime = this.runtimes.get(this.runningTaskId);
      runtime?.cancel?.();
    }

    this.tasks.forEach((task) => {
      if (task.status === "pending") {
        task.status = "cancelled";
        task.stage = getString("summary-manager-status-cancelled" as any);
        task.error = getString("summary-stop-next" as any);
        task.finishedAt = nowAt;
        task.updatedAt = nowAt;
      }
    });

    this.emit();
    void this.persist();
  }

  public retryActiveTasks(): SummaryTask[] {
    const activeTaskIds = this.tasks
      .filter((task) => task.status === "failed" || task.status === "cancelled")
      .map((task) => task.id);

    const created: SummaryTask[] = [];
    activeTaskIds.forEach((taskId) => {
      const newTask = this.retryTask(taskId);
      if (newTask) created.push(newTask);
    });

    return created;
  }

  public removeActiveTasks(): number {
    const activeTaskIds = this.tasks
      .filter((task) => isActiveTask(task))
      .map((task) => task.id);

    activeTaskIds.forEach((taskId) => {
      this.removeTask(taskId);
    });

    return activeTaskIds.length;
  }

  // Backward-compatible aliases
  public removePending(taskId: string): boolean {
    return this.removeTask(taskId);
  }

  public cancelRunning(taskId: string): boolean {
    return this.stopTask(taskId);
  }

  public retry(taskId: string): SummaryTask | null {
    return this.retryTask(taskId);
  }

  public async continuePending(): Promise<void> {
    this.stopRequested = false;
    await this.schedule();
  }

  // Backward-compatible alias
  public stopAll(): void {
    this.stopActiveTasks();
  }

  public async clearHistory(): Promise<void> {
    this.tasks = this.tasks.filter((task) => !isHistoryTask(task));
    this.selectedTaskId = this.tasks.at(-1)?.id;
    this.emit();
    await this.persist();
  }

  private async schedule(): Promise<void> {
    if (this.stopRequested) return;
    if (this.runningTaskId) return;
    const next = this.tasks.find((task) => task.status === "pending");
    if (!next) return;
    await this.runTask(next);
  }

  private async runTask(task: SummaryTask): Promise<void> {
    const attempt = (task.attempt || 0) + 1;
    task.attempt = attempt;
    this.runningTaskId = task.id;
    task.status = "running";
    task.startedAt = now();
    task.updatedAt = now();
    task.progress = 5;
    task.stage = getString("summary-manager-stage-preparing" as any);
    this.runtimes.set(task.id, {});
    this.emit();
    await this.persist();

    try {
      const result = await SummaryRunner.run(task, {
        onStage: (stage, progress) => {
          const current = this.getTaskById(task.id);
          if (
            !current ||
            current.status !== "running" ||
            current.attempt !== attempt
          ) {
            return;
          }
          current.stage = stage;
          if (typeof progress === "number") {
            current.progress = progress;
          }
          current.updatedAt = now();
          this.emit();
        },
        onChunk: (chunk) => {
          const current = this.getTaskById(task.id);
          if (
            !current ||
            current.status !== "running" ||
            current.attempt !== attempt
          ) {
            return;
          }
          current.content += chunk;
          current.updatedAt = now();
          this.emit();
        },
        onCancelReady: (cancelFn) => {
          const runtime = this.runtimes.get(task.id);
          if (runtime) runtime.cancel = cancelFn;
        },
      });

      const current = this.getTaskById(task.id);
      if (!current || current.attempt !== attempt) {
        return;
      }
      task.status = "completed";
      task.progress = 100;
      task.stage = getString("summary-manager-status-completed" as any);
      task.noteID = result.noteID;
      task.webConversationId = result.webConversationId;
      task.webConversationUrl = result.webConversationUrl;
      task.webConversationTitle = result.webConversationTitle;
      task.model = result.model || task.model;
      task.promptVersion = result.promptVersion || task.promptVersion;
      if (result.content && !task.content) {
        task.content = result.content;
      }
      task.finishedAt = now();
      task.updatedAt = now();
      try {
        await HistorySyncStore.recordCompleted(task);
      } catch (error) {
        ztoolkit.log("[AiNote][SummaryTaskManager] failed to sync completed history", error);
      }
      // Completed tasks are synced via notes/extra history and no longer kept
      // in local active-task storage.
      this.tasks = this.tasks.filter((entry) => entry.id !== task.id);
      if (this.selectedTaskId === task.id) {
        this.selectedTaskId = task.id;
      }
    } catch (error: any) {
      const current = this.getTaskById(task.id);
      if (!current || current.attempt !== attempt) {
        return;
      }
      if (SummaryRunner.isCanceledError(error)) {
        task.status = "cancelled";
        task.stage = getString("summary-manager-status-cancelled" as any);
      } else {
        task.status = "failed";
        task.stage = getString("summary-manager-status-failed" as any);
      }
      task.error = error?.message || String(error);
      task.finishedAt = now();
      task.updatedAt = now();
    } finally {
      this.runtimes.delete(task.id);
      if (this.runningTaskId === task.id) {
        this.runningTaskId = undefined;
      }
      this.emit();
      await this.persist();
      void this.schedule();
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // ignore listener errors
      }
    }
  }

  private async persist(): Promise<void> {
    await SummaryHistoryStore.save(this.tasks, this.selectedTaskId);
  }
}
