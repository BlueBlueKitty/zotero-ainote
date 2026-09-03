import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import {
  buildSummaryHeading,
  ensurePromptTemplateState,
  getActivePromptTemplate,
  PromptTemplate,
  stripLeadingSummaryHeading,
} from "../utils/prompts";
import { PDFExtractor } from "./pdfExtractor";
import { buildNoteHtmlFromMarkdown } from "./noteHtmlBuilder";
import { OutputWindowManager } from "./outputWindowManager";
import { WebSummaryBridgeClient } from "./webSummaryBridgeClient";
import { isSupportedProjectUrl } from "./webSummaryPageContract";
import {
  buildConversationTitleFromItem,
  normalizeConversationUrl,
} from "./webSummaryConversation";
import { debugWebSummaryLog, errorWebSummaryLog } from "./webSummaryDebug";
import { WebSummaryRelationStore } from "./webSummaryRelations";
import {
  BridgeErrorCode,
  CreateTaskRequest,
  WebSummaryConversationMeta,
  WebSummaryPlatform,
  WebSummaryTask,
  WebSummaryTaskStage,
  WEB_SUMMARY_DEFAULT_RESPONSE_TIMEOUT_MINUTES,
} from "./webSummaryTypes";

export interface WebSummaryTarget {
  item: Zotero.Item;
  preferredPdfAttachment?: Zotero.Item;
  templateId?: string;
}

export interface WebSummaryRunResult {
  successCount: number;
  failedCount: number;
  canceledCount: number;
  stopped: boolean;
}

export interface WebSummarySingleRunHooks {
  onStage?: (stage: string, progress?: number) => void;
  onContent?: (content: string) => void;
  onCancelReady?: (cancelFn: () => void) => void;
  onTaskCreated?: (task: WebSummaryTask) => void;
}

const WEB_SUMMARY_MODEL_LABEL = "ChatGPT Web";
const EXTENSION_CLAIM_TIMEOUT_MS = 90_000;
const WAIT_GRACE_MS = 120_000;

class WebSummaryCanceledError extends Error {
  constructor(message = getString("summary-canceled-unsaved" as any)) {
    super(message);
    this.name = "WebSummaryCanceledError";
  }
}

function getWebSummaryCanceledMessage(): string {
  return getString("summary-canceled-unsaved" as any);
}

export function throwIfWebSummaryCanceled(canceled: boolean): void {
  if (canceled) throw new WebSummaryCanceledError();
}

export function getWebSummaryModelLabel(): string {
  return WEB_SUMMARY_MODEL_LABEL;
}

function getPromptTemplate(templateId?: string): PromptTemplate {
  const fallback = getActivePromptTemplate(
    getPref("promptTemplates" as any),
    getPref("activePromptTemplateId" as any),
    getPref("promptTemplatesVersion" as any),
  );
  if (!templateId) return fallback;
  return (
    ensurePromptTemplateState(
      getPref("promptTemplates" as any),
      getPref("activePromptTemplateId" as any),
      getPref("promptTemplatesVersion" as any),
    ).templates.find((template) => template.id === templateId) || fallback
  );
}

function getProjectUrl(): string {
  const raw = String(
    getPref("webSummaryChatGPTProjectUrl" as any) || "",
  ).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("请在 AiNote 设置中填写完整的 ChatGPT Project 链接");
  }
  if (!isSupportedProjectUrl(url.toString())) {
    throw new Error("ChatGPT Project 链接无效，请复制项目页面的完整链接");
  }
  return normalizeConversationUrl(url.toString());
}

function getResponseTimeoutMs(): number {
  const value = Number.parseInt(
    String(
      getPref("webSummaryResponseTimeoutMinutes" as any) ||
        WEB_SUMMARY_DEFAULT_RESPONSE_TIMEOUT_MINUTES,
    ),
    10,
  );
  const minutes = Number.isFinite(value)
    ? Math.max(5, Math.min(60, value))
    : WEB_SUMMARY_DEFAULT_RESPONSE_TIMEOUT_MINUTES;
  return minutes * 60_000;
}

function createNote(
  item: Zotero.Item,
  initialContent: string,
): Promise<Zotero.Item> {
  const note = new Zotero.Item("note");
  note.parentID = item.id;
  note.setNote(initialContent);
  note.addTag("AI-Generated");
  return note.saveTx().then(() => note);
}

function toChatLink(
  platform: WebSummaryPlatform,
  meta: WebSummaryConversationMeta,
) {
  const now = new Date().toISOString();
  return {
    platform,
    conversationId: meta.conversationId,
    conversationUrl: normalizeConversationUrl(meta.conversationUrl || ""),
    conversationTitle: meta.conversationTitle,
    folderName: meta.folderName,
    folderResolved: meta.folderResolved,
    createdAt: meta.createdAt || now,
    lastUsedAt: meta.lastUsedAt || now,
  };
}

function resolvePdfUploadFileName(
  attachment: Zotero.Item,
  pdfPath: string,
): string {
  const attachmentFileName = String(
    (attachment as any).attachmentFilename || "",
  ).trim();
  const pathFileName = String(PathUtils.filename(pdfPath) || "").trim();
  const title = String(attachment.getField("title") || "").trim();
  const value = attachmentFileName || pathFileName || title || "paper.pdf";
  return value.toLowerCase().endsWith(".pdf") ? value : `${value}.pdf`;
}

function buildAttemptPdfFileName(
  attachment: Zotero.Item,
  pdfPath: string,
  itemId: number,
): string {
  const fileName = resolvePdfUploadFileName(attachment, pdfPath);
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : ".pdf";
  return `${stem}__ainote_${itemId}_${Date.now().toString(36)}${extension}`;
}

async function resolveInputPdf(target: WebSummaryTarget): Promise<{
  path: string;
  fileName: string;
}> {
  const attachment = await PDFExtractor.resolvePdfAttachment(
    target.item,
    target.preferredPdfAttachment,
  );
  const path = String((await attachment.getFilePathAsync()) || "").trim();
  if (!path || !(await IOUtils.exists(path))) {
    throw new Error("所选 PDF 文件不存在或不是本地附件");
  }
  try {
    const stat = await IOUtils.stat(path);
    if (!stat.size) throw new Error("PDF 文件为空");
  } catch (error) {
    if (String((error as Error)?.message || error).includes("PDF 文件为空")) {
      throw error;
    }
    throw new Error("无法读取所选 PDF 文件");
  }
  return {
    path,
    fileName: buildAttemptPdfFileName(attachment, path, target.item.id),
  };
}

function buildSummarizePayload(params: {
  target: WebSummaryTarget;
  pdfPath: string;
  pdfFileName: string;
  prompt: string;
  projectUrl: string;
  existingConversationId?: string;
  existingConversationUrl?: string;
}): CreateTaskRequest {
  return {
    itemId: params.target.item.id,
    libraryId: params.target.item.libraryID,
    title: String(params.target.item.getField("title") || ""),
    pdfPath: params.pdfPath,
    pdfFileName: params.pdfFileName,
    prompt: params.prompt,
    responseTimeoutMs: getResponseTimeoutMs(),
    platform: "chatgpt",
    actionType: "summarize",
    projectUrl: params.projectUrl,
    conversationTitle: buildConversationTitleFromItem(params.target.item),
    existingConversationId: params.existingConversationId,
    existingConversationUrl: normalizeConversationUrl(
      params.existingConversationUrl || "",
    ),
  };
}

const STAGE_MESSAGES: Record<WebSummaryTaskStage, [string, number]> = {
  claimed: ["扩展已领取任务", 10],
  preparing_page: ["正在准备 ChatGPT 页面", 20],
  uploading_pdf: ["正在上传 PDF", 35],
  ready_to_send: ["PDF 已就绪，准备发送提示词", 50],
  prompt_sent: ["提示词已发送", 60],
  waiting_response: ["正在等待 ChatGPT 完成总结", 75],
  extracting_result: ["正在取得并格式化最终总结", 90],
};

function reportTaskToHooks(
  task: WebSummaryTask,
  hooks?: WebSummarySingleRunHooks,
): void {
  if (task.stage) {
    const [message, progress] = STAGE_MESSAGES[task.stage];
    hooks?.onStage?.(message, progress);
  }
  if (task.status === "succeeded" && task.resultMarkdown) {
    hooks?.onContent?.(task.resultMarkdown);
  }
}

function errorFromTask(task: WebSummaryTask): Error & {
  bridgeCode?: BridgeErrorCode;
} {
  const error = new Error(
    task.errorMessage || getString("web-summary-error-generic" as any),
  ) as Error & { bridgeCode?: BridgeErrorCode };
  error.bridgeCode = task.errorCode;
  return error;
}

export function shouldFallbackToNewConversation(error: unknown): boolean {
  return (
    String((error as any)?.bridgeCode || "") === "CONVERSATION_UNAVAILABLE"
  );
}

async function waitForTaskTerminalState(
  task: WebSummaryTask,
  hooks?: WebSummarySingleRunHooks,
): Promise<WebSummaryTask> {
  return new Promise<WebSummaryTask>((resolve, reject) => {
    let latest = task;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(claimTimer);
      clearTimeout(totalTimer);
      unsubscribe();
      callback();
    };
    const handle = (next: WebSummaryTask) => {
      latest = next;
      reportTaskToHooks(next, hooks);
      if (next.status === "succeeded") {
        finish(() => resolve(next));
      } else if (next.status === "canceled") {
        finish(() => reject(new WebSummaryCanceledError(next.errorMessage)));
      } else if (next.status === "failed") {
        finish(() => reject(errorFromTask(next)));
      }
    };
    const unsubscribe = WebSummaryBridgeClient.subscribeTask(
      task.taskId,
      handle,
    );
    const claimTimer = setTimeout(() => {
      if (latest.status !== "queued") return;
      void WebSummaryBridgeClient.cancelTask(
        task.taskId,
        "浏览器扩展未在限定时间内领取任务",
      );
      finish(() =>
        reject(
          new Error(
            "未检测到已配对的浏览器扩展，请确认浏览器已打开且扩展已启用",
          ),
        ),
      );
    }, EXTENSION_CLAIM_TIMEOUT_MS);
    const totalTimer = setTimeout(() => {
      void WebSummaryBridgeClient.cancelTask(task.taskId, "网页总结等待超时");
      finish(() => reject(new Error("网页总结等待超时，请从任务窗口重试")));
    }, getResponseTimeoutMs() + WAIT_GRACE_MS);
    handle(task);
  });
}

async function discardBridgeTask(
  taskId: string,
  reason: string,
): Promise<void> {
  try {
    const task = await WebSummaryBridgeClient.getTask(taskId).catch(() => null);
    if (task && (task.status === "queued" || task.status === "leased")) {
      await WebSummaryBridgeClient.cancelTask(taskId, reason);
    }
    await WebSummaryBridgeClient.removeTask(taskId);
  } catch (error) {
    errorWebSummaryLog("Workflow", "bridge task cleanup failed", {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export class WebSummaryWorkflow {
  public static async summarizeSingleTarget(
    target: WebSummaryTarget,
    hooks?: WebSummarySingleRunHooks,
  ): Promise<{
    content: string;
    noteID: number;
    webConversationId?: string;
    webConversationUrl?: string;
    webConversationTitle?: string;
  }> {
    const projectUrl = getProjectUrl();
    const promptTemplate = getPromptTemplate(target.templateId);
    const pdf = await resolveInputPdf(target);
    const latestLink = WebSummaryRelationStore.getLatestLink(
      target.item,
      "chatgpt",
    );
    let canceled = false;
    let activeTaskId = "";
    hooks?.onCancelReady?.(() => {
      canceled = true;
      if (activeTaskId) {
        void WebSummaryBridgeClient.cancelTask(
          activeTaskId,
          getWebSummaryCanceledMessage(),
        );
      }
    });
    throwIfWebSummaryCanceled(canceled);

    const attempts: CreateTaskRequest[] = [];
    if (latestLink?.conversationUrl) {
      attempts.push(
        buildSummarizePayload({
          target,
          pdfPath: pdf.path,
          pdfFileName: pdf.fileName,
          prompt: promptTemplate.content,
          projectUrl,
          existingConversationId: latestLink.conversationId,
          existingConversationUrl: latestLink.conversationUrl,
        }),
      );
    }
    attempts.push(
      buildSummarizePayload({
        target,
        pdfPath: pdf.path,
        pdfFileName: pdf.fileName,
        prompt: promptTemplate.content,
        projectUrl,
      }),
    );

    let latestTask: WebSummaryTask | null = null;
    for (let index = 0; index < attempts.length; index += 1) {
      const payload = attempts[index];
      throwIfWebSummaryCanceled(canceled);
      hooks?.onStage?.("正在提交网页总结任务", 5);
      try {
        const created = await WebSummaryBridgeClient.createTask(payload);
        activeTaskId = created.task.taskId;
        hooks?.onTaskCreated?.(created.task);
        latestTask = await waitForTaskTerminalState(created.task, hooks);
        await discardBridgeTask(activeTaskId, "网页总结任务已完成并清理");
        activeTaskId = "";
        break;
      } catch (error) {
        if (activeTaskId) {
          await discardBridgeTask(activeTaskId, "网页总结尝试结束并清理");
          activeTaskId = "";
        }
        if (canceled || error instanceof WebSummaryCanceledError) {
          throw new WebSummaryCanceledError();
        }
        const hasExplicitInvalidConversation =
          !!payload.existingConversationUrl &&
          index < attempts.length - 1 &&
          shouldFallbackToNewConversation(error);
        if (hasExplicitInvalidConversation) {
          debugWebSummaryLog(
            "Workflow",
            "stored conversation is explicitly unavailable; creating a new project conversation",
            { itemId: target.item.id },
          );
          continue;
        }
        throw error;
      }
    }

    if (!latestTask?.resultMarkdown) {
      throw new Error(getString("web-summary-error-generic" as any));
    }
    const itemTitle = String(target.item.getField("title") || "");
    const summaryHeading = buildSummaryHeading(promptTemplate.name, itemTitle);
    const noteBody = stripLeadingSummaryHeading(
      latestTask.resultMarkdown,
      summaryHeading,
    );
    const noteHtml = buildNoteHtmlFromMarkdown(
      summaryHeading,
      WEB_SUMMARY_MODEL_LABEL,
      latestTask.resultMarkdown,
    );
    hooks?.onStage?.("正在保存 Zotero 笔记", 95);
    const note = await createNote(target.item, noteHtml);
    if (latestTask.conversationMeta?.conversationUrl) {
      await WebSummaryRelationStore.saveLatestLink(
        target.item,
        toChatLink("chatgpt", latestTask.conversationMeta),
      );
    }
    hooks?.onStage?.("完成", 100);
    return {
      content: noteBody || latestTask.resultMarkdown,
      noteID: note.id,
      webConversationId: latestTask.conversationMeta?.conversationId,
      webConversationUrl: latestTask.conversationMeta?.conversationUrl,
      webConversationTitle: latestTask.conversationMeta?.conversationTitle,
    };
  }

  public static async summarizeItems(
    targets: WebSummaryTarget[],
    progressCallback?: (
      current: number,
      total: number,
      progress: number,
      message: string,
    ) => void,
  ): Promise<WebSummaryRunResult> {
    let successCount = 0;
    let failedCount = 0;
    let canceledCount = 0;
    let stopped = false;
    const outputWindow = await OutputWindowManager.startBatch(
      "web-summary",
      targets.length,
    );
    OutputWindowManager.setOnStop(() => {
      stopped = true;
    });
    for (let index = 0; index < targets.length && !stopped; index += 1) {
      try {
        await this.summarizeSingleTarget(targets[index], {
          onStage: (message, progress = 0) => {
            progressCallback?.(index + 1, targets.length, progress, message);
            outputWindow.updateCurrentStatus(message);
          },
          onContent: (content) => outputWindow.replaceCurrentContent(content),
        });
        successCount += 1;
      } catch (error) {
        if (error instanceof WebSummaryCanceledError) canceledCount += 1;
        else failedCount += 1;
      }
    }
    OutputWindowManager.endBatch();
    return { successCount, failedCount, canceledCount, stopped };
  }

  public static async openConversationForItem(
    item: Zotero.Item,
  ): Promise<void> {
    const link = WebSummaryRelationStore.getLatestLink(item, "chatgpt");
    if (!link?.conversationUrl) {
      throw new Error("当前文献还没有可继续对话的 ChatGPT 会话记录");
    }
    if (WebSummaryBridgeClient.hasActiveTaskForItem(item.id)) {
      throw new Error("当前文献正在执行网页总结，请完成后再继续对话");
    }
    const { task } = await WebSummaryBridgeClient.createTask({
      itemId: item.id,
      libraryId: item.libraryID,
      title: String(item.getField("title") || ""),
      platform: "chatgpt",
      actionType: "open_conversation",
      existingConversationId: link.conversationId,
      existingConversationUrl: link.conversationUrl,
    });
    try {
      await waitForTaskTerminalState(task);
    } finally {
      await discardBridgeTask(task.taskId, "继续对话命令已结束");
    }
  }
}
