import {
  BridgeErrorCode,
  CreateTaskRequest,
  ReportTaskEventRequest,
  ReportTaskFailureRequest,
  ReportTaskResultRequest,
  WebSummaryConversationMeta,
  WebSummaryTask,
  WebSummaryTaskStage,
  WEB_SUMMARY_LEASE_DURATION_MS,
  WEB_SUMMARY_TASK_STAGES,
} from "./webSummaryTypes";
import { debugWebSummaryLog, errorWebSummaryLog } from "./webSummaryDebug";

type TaskListener = (task: WebSummaryTask) => void;
type GlobalTaskListener = (task: WebSummaryTask) => void;

export interface WebSummaryTaskStoreOptions {
  now?: () => number;
  randomId?: () => string;
  leaseDurationMs?: number;
}

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);
const MAX_PROCESSED_REQUESTS_PER_TASK = 32;
const STAGE_INDEX = new Map<WebSummaryTaskStage, number>(
  WEB_SUMMARY_TASK_STAGES.map((stage, index) => [stage, index]),
);
const PROMPT_SENT_INDEX = STAGE_INDEX.get("prompt_sent") || 4;

function cloneTask(task: WebSummaryTask): WebSummaryTask {
  return JSON.parse(JSON.stringify(task)) as WebSummaryTask;
}

function createBridgeError(
  code: BridgeErrorCode,
  message: string,
): Error & {
  bridgeCode?: BridgeErrorCode;
} {
  const error = new Error(message) as Error & { bridgeCode?: BridgeErrorCode };
  error.bridgeCode = code;
  return error;
}

function applyConversationMeta(
  task: WebSummaryTask,
  meta: WebSummaryConversationMeta,
  updateExistingConversation = true,
): void {
  task.conversationMeta = {
    ...(task.conversationMeta || {}),
    ...Object.fromEntries(
      Object.entries(meta).filter(([, value]) => value !== undefined),
    ),
  };
  if (updateExistingConversation) {
    if (meta.conversationId) task.existingConversationId = meta.conversationId;
    if (meta.conversationUrl)
      task.existingConversationUrl = meta.conversationUrl;
    if (meta.conversationTitle) task.conversationTitle = meta.conversationTitle;
  }
}

export class WebSummaryTaskStore {
  private readonly tasks = new Map<string, WebSummaryTask>();
  private readonly nextTaskWaiters = new Set<() => void>();
  private readonly taskListeners = new Map<string, Set<TaskListener>>();
  private readonly globalListeners = new Set<GlobalTaskListener>();
  private readonly processedRequests = new Map<
    string,
    Map<string, WebSummaryTask>
  >();
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly leaseDurationMs: number;

  constructor(options: WebSummaryTaskStoreOptions = {}) {
    this.now = options.now || (() => Date.now());
    this.randomId = options.randomId || (() => crypto.randomUUID());
    this.leaseDurationMs = Math.max(
      1_000,
      options.leaseDurationMs || WEB_SUMMARY_LEASE_DURATION_MS,
    );
  }

  public createTask(request: CreateTaskRequest): WebSummaryTask {
    const now = this.isoNow();
    const task: WebSummaryTask = {
      taskId: this.randomId(),
      itemId: request.itemId,
      libraryId: request.libraryId,
      title: request.title,
      pdfPath: request.pdfPath,
      pdfFileName: request.pdfFileName,
      prompt: request.prompt,
      responseTimeoutMs: request.responseTimeoutMs,
      createdAt: now,
      updatedAt: now,
      status: "queued",
      sendState: "not_sent",
      platform: request.platform,
      actionType: request.actionType,
      projectUrl: request.projectUrl,
      conversationTitle: request.conversationTitle,
      existingConversationId: request.existingConversationId,
      existingConversationUrl: request.existingConversationUrl,
      conversationMeta: {
        conversationId: request.existingConversationId,
        conversationUrl: request.existingConversationUrl,
        conversationTitle: request.conversationTitle,
        createdAt: now,
        lastUsedAt: now,
      },
    };
    this.tasks.set(task.taskId, task);
    debugWebSummaryLog("TaskStore", "task created", {
      taskId: task.taskId,
      itemId: task.itemId,
      actionType: task.actionType,
    });
    this.notifyTaskAvailable();
    return this.emitTaskChanged(task);
  }

  public getTask(taskId: string): WebSummaryTask | null {
    this.expireLeases();
    const task = this.tasks.get(taskId);
    return task ? cloneTask(task) : null;
  }

  public hasActiveTaskForItem(itemId: number): boolean {
    this.expireLeases();
    return Array.from(this.tasks.values()).some(
      (task) =>
        task.itemId === itemId &&
        (task.status === "queued" || task.status === "leased"),
    );
  }

  public subscribeTask(taskId: string, listener: TaskListener): () => void {
    const listeners = this.taskListeners.get(taskId) || new Set<TaskListener>();
    listeners.add(listener);
    this.taskListeners.set(taskId, listeners);
    return () => {
      const current = this.taskListeners.get(taskId);
      current?.delete(listener);
      if (current?.size === 0) this.taskListeners.delete(taskId);
    };
  }

  public subscribeAll(listener: GlobalTaskListener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  public claimNextTask(executorInstallId: string): WebSummaryTask | null {
    this.expireLeases();
    if (
      Array.from(this.tasks.values()).some((entry) => entry.status === "leased")
    ) {
      return null;
    }
    const task = Array.from(this.tasks.values()).find(
      (entry) => entry.status === "queued",
    );
    if (!task) return null;

    const claimedAtMs = this.now();
    task.status = "leased";
    task.stage = "claimed";
    task.lease = {
      leaseId: this.randomId(),
      executorInstallId,
      claimedAt: new Date(claimedAtMs).toISOString(),
      expiresAt: new Date(claimedAtMs + this.leaseDurationMs).toISOString(),
    };
    task.updatedAt = task.lease.claimedAt;
    debugWebSummaryLog("TaskStore", "task leased", {
      taskId: task.taskId,
      executorInstallId,
      stage: task.stage,
    });
    return this.emitTaskChanged(task);
  }

  public async claimNextTaskOrWait(
    waitMs: number,
    executorInstallId: string,
  ): Promise<WebSummaryTask | null> {
    const immediate = this.claimNextTask(executorInstallId);
    if (immediate) return immediate;
    const timeout = Number.isFinite(waitMs)
      ? Math.max(0, Math.floor(waitMs))
      : 0;
    if (timeout <= 0) return null;

    return new Promise<WebSummaryTask | null>((resolve) => {
      let settled = false;
      const done = (task: WebSummaryTask | null) => {
        if (settled) return;
        settled = true;
        this.nextTaskWaiters.delete(onTaskReady);
        clearTimeout(timer);
        resolve(task);
      };
      const onTaskReady = () => done(this.claimNextTask(executorInstallId));
      const timer = setTimeout(() => done(null), timeout);
      this.nextTaskWaiters.add(onTaskReady);
    });
  }

  public reportEvent(
    taskId: string,
    request: ReportTaskEventRequest,
    executorInstallId: string,
  ): WebSummaryTask {
    const cached = this.getProcessedRequest(taskId, request.requestId);
    if (cached) return cached;
    const task = this.mustGetTask(taskId);
    if (TERMINAL_STATUSES.has(task.status)) return cloneTask(task);
    this.assertLease(task, request.leaseId, executorInstallId);
    this.assertForwardStage(task.stage, request.stage);

    task.stage = request.stage;
    const now = this.isoNow();
    task.updatedAt = now;
    if ((STAGE_INDEX.get(request.stage) || 0) >= PROMPT_SENT_INDEX) {
      task.sendState = "sent";
      task.sentAt ||= now;
    }
    if (request.debugMessage) task.debugMessage = request.debugMessage;
    debugWebSummaryLog("TaskStore", "task stage", {
      taskId,
      stage: task.stage,
      sendState: task.sendState,
      debugMessage: request.debugMessage,
    });
    applyConversationMeta(
      task,
      {
        conversationId: request.conversationId,
        conversationUrl: request.conversationUrl,
        conversationTitle: request.conversationTitle,
        lastUsedAt: now,
      },
      (STAGE_INDEX.get(request.stage) || 0) >= PROMPT_SENT_INDEX,
    );
    this.renewLease(task);
    return this.rememberProcessedRequest(task, request.requestId);
  }

  public completeTask(
    taskId: string,
    request: ReportTaskResultRequest,
    executorInstallId: string,
  ): WebSummaryTask {
    const cached = this.getProcessedRequest(taskId, request.requestId);
    if (cached) return cached;
    const task = this.mustGetTask(taskId);
    if (TERMINAL_STATUSES.has(task.status)) return cloneTask(task);
    this.assertLease(task, request.leaseId, executorInstallId);
    if (task.actionType === "summarize" && task.sendState !== "sent") {
      throw createBridgeError(
        "INVALID_STATUS_TRANSITION",
        "Summary result cannot be accepted before the prompt is sent",
      );
    }

    const now = this.isoNow();
    task.status = "succeeded";
    task.lease = undefined;
    task.resultMarkdown = request.resultMarkdown;
    task.resultSource = request.resultSource;
    task.resultDebugInfo = request.resultDebugInfo;
    task.updatedAt = now;
    applyConversationMeta(task, {
      conversationId: request.conversationId,
      conversationUrl: request.conversationUrl,
      conversationTitle: request.conversationTitle,
      createdAt: task.conversationMeta?.createdAt || task.createdAt,
      lastUsedAt: now,
    });
    return this.rememberProcessedRequest(task, request.requestId);
  }

  public failTask(
    taskId: string,
    request: ReportTaskFailureRequest,
    executorInstallId: string,
  ): WebSummaryTask {
    const cached = this.getProcessedRequest(taskId, request.requestId);
    if (cached) return cached;
    const task = this.mustGetTask(taskId);
    if (TERMINAL_STATUSES.has(task.status)) return cloneTask(task);
    this.assertLease(task, request.leaseId, executorInstallId);

    const now = this.isoNow();
    task.status = "failed";
    task.lease = undefined;
    task.errorCode = request.errorCode;
    task.errorMessage = request.errorMessage;
    task.sendState = request.sendState || task.sendState;
    if (request.debugMessage) task.debugMessage = request.debugMessage;
    task.updatedAt = now;
    errorWebSummaryLog("TaskStore", "task failed", {
      taskId,
      stage: task.stage,
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
      sendState: task.sendState,
      debugMessage: request.debugMessage,
    });
    applyConversationMeta(
      task,
      {
        conversationId: request.conversationId,
        conversationUrl: request.conversationUrl,
        conversationTitle: request.conversationTitle,
        lastUsedAt: now,
      },
      request.sendState !== "not_sent",
    );
    return this.rememberProcessedRequest(task, request.requestId);
  }

  public requestCancel(taskId: string, reason?: string): WebSummaryTask {
    const task = this.mustGetTask(taskId);
    if (TERMINAL_STATUSES.has(task.status)) return cloneTask(task);
    const now = this.isoNow();
    task.status = "canceled";
    task.lease = undefined;
    task.cancelRequestedAt = now;
    task.cancelReason = reason || "已停止当前条目的AI总结";
    task.errorMessage = task.cancelReason;
    task.updatedAt = now;
    return this.emitTaskChanged(task);
  }

  public validateLease(
    taskId: string,
    leaseId: string,
    executorInstallId: string,
  ): WebSummaryTask {
    const task = this.mustGetTask(taskId);
    this.assertLease(task, leaseId, executorInstallId);
    return cloneTask(task);
  }

  public removeTask(taskId: string): WebSummaryTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    const removed = TERMINAL_STATUSES.has(task.status)
      ? cloneTask(task)
      : this.requestCancel(taskId, "网页总结任务已从活动列表移除");
    this.tasks.delete(taskId);
    this.processedRequests.delete(taskId);
    this.emitTaskChanged(removed);
    return removed;
  }

  public expireLeases(): void {
    const now = this.now();
    let taskRequeued = false;
    for (const task of this.tasks.values()) {
      if (
        task.status !== "leased" ||
        !task.lease ||
        Date.parse(task.lease.expiresAt) > now
      ) {
        continue;
      }
      task.lease = undefined;
      task.updatedAt = new Date(now).toISOString();
      if (task.sendState === "not_sent") {
        task.status = "queued";
        task.stage = undefined;
        task.debugMessage = "执行租约在发送提示词前失效，任务已重新排队";
        taskRequeued = true;
      } else {
        task.status = "failed";
        task.sendState = "unknown";
        task.errorCode = "SEND_STATE_UNKNOWN";
        task.errorMessage =
          "浏览器执行中断，无法确认提示词发送结果；请从任务窗口重试";
      }
      this.emitTaskChanged(task);
    }
    if (taskRequeued) this.notifyTaskAvailable();
  }

  private assertForwardStage(
    current: WebSummaryTaskStage | undefined,
    next: WebSummaryTaskStage,
  ): void {
    const currentIndex = current ? STAGE_INDEX.get(current) : -1;
    const nextIndex = STAGE_INDEX.get(next);
    if (
      nextIndex === undefined ||
      (currentIndex !== undefined && nextIndex < currentIndex)
    ) {
      throw createBridgeError(
        "INVALID_STATUS_TRANSITION",
        `Invalid task stage transition: ${current || "none"} -> ${next}`,
      );
    }
  }

  private assertLease(
    task: WebSummaryTask,
    leaseId: string,
    executorInstallId: string,
  ): void {
    if (!task.lease || task.status !== "leased") {
      throw createBridgeError("LEASE_EXPIRED", "Task lease is not active");
    }
    if (Date.parse(task.lease.expiresAt) <= this.now()) {
      this.expireLeases();
      throw createBridgeError("LEASE_EXPIRED", "Task lease has expired");
    }
    if (
      task.lease.leaseId !== leaseId ||
      task.lease.executorInstallId !== executorInstallId
    ) {
      throw createBridgeError("LEASE_MISMATCH", "Task lease does not match");
    }
  }

  private renewLease(task: WebSummaryTask): void {
    if (!task.lease) return;
    task.lease.expiresAt = new Date(
      this.now() + this.leaseDurationMs,
    ).toISOString();
  }

  private mustGetTask(taskId: string): WebSummaryTask {
    const task = this.tasks.get(taskId);
    if (!task) throw createBridgeError("TASK_NOT_FOUND", "Task not found");
    return task;
  }

  private getProcessedRequest(
    taskId: string,
    requestId: string,
  ): WebSummaryTask | null {
    const task = this.processedRequests.get(taskId)?.get(requestId);
    return task ? cloneTask(task) : null;
  }

  private rememberProcessedRequest(
    task: WebSummaryTask,
    requestId: string,
  ): WebSummaryTask {
    const snapshot = this.emitTaskChanged(task);
    const requests =
      this.processedRequests.get(task.taskId) ||
      new Map<string, WebSummaryTask>();
    requests.set(requestId, cloneTask(snapshot));
    while (requests.size > MAX_PROCESSED_REQUESTS_PER_TASK) {
      const oldest = requests.keys().next().value as string | undefined;
      if (!oldest) break;
      requests.delete(oldest);
    }
    this.processedRequests.set(task.taskId, requests);
    return snapshot;
  }

  private notifyTaskAvailable(): void {
    if (!this.nextTaskWaiters.size) return;
    const waiters = Array.from(this.nextTaskWaiters);
    this.nextTaskWaiters.clear();
    for (const waiter of waiters) {
      try {
        waiter();
      } catch {
        // Listener failures must not stop task dispatch.
      }
    }
  }

  private emitTaskChanged(task: WebSummaryTask): WebSummaryTask {
    const snapshot = cloneTask(task);
    for (const listener of this.taskListeners.get(task.taskId) || []) {
      try {
        listener(snapshot);
      } catch {
        // Listener failures must not change task state.
      }
    }
    for (const listener of this.globalListeners) {
      try {
        listener(snapshot);
      } catch {
        // Listener failures must not change task state.
      }
    }
    return snapshot;
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }
}
