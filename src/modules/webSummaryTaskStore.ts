import {
  BridgeErrorCode,
  CreateTaskRequest,
  ReportTaskFailureRequest,
  ReportTaskResultRequest,
  ReportTaskStatusRequest,
  WebSummaryConversationMeta,
  WebSummaryTask,
  WebSummaryTaskStatus,
} from "./webSummaryTypes";

const TRANSITIONS: Record<WebSummaryTaskStatus, WebSummaryTaskStatus[]> = {
  queued: [
    "claimed",
    "opening_chat",
    "locating_folder",
    "creating_conversation",
    "downloading_pdf",
    "failed",
    "canceled",
  ],
  claimed: [
    "opening_chat",
    "locating_folder",
    "creating_conversation",
    "downloading_pdf",
    "awaiting_user_send",
    "running",
    "failed",
    "canceled",
  ],
  opening_chat: [
    "locating_folder",
    "creating_conversation",
    "downloading_pdf",
    "awaiting_user_send",
    "running",
    "failed",
    "canceled",
  ],
  locating_folder: [
    "creating_conversation",
    "downloading_pdf",
    "awaiting_user_send",
    "running",
    "failed",
    "canceled",
  ],
  creating_conversation: [
    "downloading_pdf",
    "awaiting_user_send",
    "running",
    "failed",
    "canceled",
  ],
  downloading_pdf: ["awaiting_user_send", "running", "failed", "canceled"],
  awaiting_user_send: ["running", "failed", "canceled"],
  running: ["succeeded", "failed", "canceled"],
  succeeded: [],
  failed: [],
  canceled: [],
};

function cloneTask(task: WebSummaryTask): WebSummaryTask {
  return JSON.parse(JSON.stringify(task)) as WebSummaryTask;
}

function canTransition(
  current: WebSummaryTaskStatus,
  next: WebSummaryTaskStatus,
): boolean {
  return current === next || TRANSITIONS[current].includes(next);
}

function applyConversationMeta(
  task: WebSummaryTask,
  meta: WebSummaryConversationMeta,
): void {
  task.conversationMeta = {
    ...(task.conversationMeta || {}),
    ...meta,
  };

  if (meta.conversationId) {
    task.existingConversationId = meta.conversationId;
  }
  if (meta.conversationUrl) {
    task.existingConversationUrl = meta.conversationUrl;
  }
  if (meta.conversationTitle) {
    task.conversationTitle = meta.conversationTitle;
  }
}

export class WebSummaryTaskStore {
  private readonly tasks = new Map<string, WebSummaryTask>();

  public createTask(request: CreateTaskRequest): WebSummaryTask {
    const now = new Date().toISOString();
    const task: WebSummaryTask = {
      taskId: crypto.randomUUID(),
      itemId: request.itemId,
      libraryId: request.libraryId,
      title: request.title,
      pdfPath: request.pdfPath,
      pdfFileName: request.pdfFileName,
      prompt: request.prompt,
      createdAt: now,
      updatedAt: now,
      status: "queued",
      platform: request.platform,
      actionType: request.actionType,
      conversationMode: request.conversationMode,
      projectUrl: request.projectUrl,
      chatgptMode: request.chatgptMode,
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
    return cloneTask(task);
  }

  public getTask(taskId: string): WebSummaryTask | null {
    const task = this.tasks.get(taskId);
    return task ? cloneTask(task) : null;
  }

  public claimNextTask(): WebSummaryTask | null {
    const task = Array.from(this.tasks.values()).find(
      (entry) => entry.status === "queued",
    );
    if (!task) {
      return null;
    }
    task.status = "claimed";
    task.updatedAt = new Date().toISOString();
    return cloneTask(task);
  }

  public requestCancel(taskId: string, reason?: string): WebSummaryTask {
    const task = this.mustGetTask(taskId);
    const now = new Date().toISOString();
    task.cancelRequestedAt = now;
    task.cancelReason = reason || "已停止当前条目的AI总结";
    task.updatedAt = now;

    if (task.status === "queued" || task.status === "claimed") {
      task.status = "canceled";
      task.errorCode = "INTERNAL_ERROR";
      task.errorMessage = task.cancelReason;
    }

    return cloneTask(task);
  }

  public updateStatus(
    taskId: string,
    request: ReportTaskStatusRequest,
  ): WebSummaryTask {
    const task = this.mustGetTask(taskId);
    if (!canTransition(task.status, request.status)) {
      throw this.createTransitionError(task.status, request.status);
    }
    task.status = request.status;
    task.updatedAt = new Date().toISOString();
    applyConversationMeta(task, {
      conversationId: request.conversationId,
      conversationUrl: request.conversationUrl,
      conversationTitle: request.conversationTitle,
      folderName: request.folderName,
      folderResolved: request.folderResolved,
      lastUsedAt: task.updatedAt,
    });
    if (request.errorCode) {
      task.errorCode = request.errorCode;
    }
    if (request.errorMessage) {
      task.errorMessage = request.errorMessage;
    }
    return cloneTask(task);
  }

  public completeTask(
    taskId: string,
    request: ReportTaskResultRequest,
  ): WebSummaryTask {
    const task = this.mustGetTask(taskId);
    if (!canTransition(task.status, "succeeded")) {
      throw this.createTransitionError(task.status, "succeeded");
    }
    task.status = "succeeded";
    task.resultMarkdown = request.resultMarkdown;
    task.updatedAt = new Date().toISOString();
    applyConversationMeta(task, {
      conversationId: request.conversationId,
      conversationUrl: request.conversationUrl,
      conversationTitle: request.conversationTitle,
      folderName: request.folderName,
      folderResolved: request.folderResolved,
      createdAt: task.conversationMeta?.createdAt || task.createdAt,
      lastUsedAt: task.updatedAt,
    });
    return cloneTask(task);
  }

  public failTask(
    taskId: string,
    request: ReportTaskFailureRequest,
  ): WebSummaryTask {
    const task = this.mustGetTask(taskId);
    if (!canTransition(task.status, "failed")) {
      throw this.createTransitionError(task.status, "failed");
    }
    task.status = "failed";
    task.errorCode = request.errorCode;
    task.errorMessage = request.errorMessage;
    task.updatedAt = new Date().toISOString();
    applyConversationMeta(task, {
      conversationId: request.conversationId,
      conversationUrl: request.conversationUrl,
      conversationTitle: request.conversationTitle,
      folderName: request.folderName,
      folderResolved: request.folderResolved,
      lastUsedAt: task.updatedAt,
    });
    return cloneTask(task);
  }

  private mustGetTask(taskId: string): WebSummaryTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      const error = new Error("Task not found") as Error & {
        bridgeCode?: BridgeErrorCode;
      };
      error.bridgeCode = "TASK_NOT_FOUND";
      throw error;
    }
    return task;
  }

  private createTransitionError(
    current: WebSummaryTaskStatus,
    next: WebSummaryTaskStatus,
  ): Error & { bridgeCode?: BridgeErrorCode } {
    const error = new Error(
      `Invalid task status transition: ${current} -> ${next}`,
    ) as Error & {
      bridgeCode?: BridgeErrorCode;
    };
    error.bridgeCode = "INVALID_STATUS_TRANSITION";
    return error;
  }
}
